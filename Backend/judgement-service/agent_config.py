"""Per-agent LLM configuration from the admin console (public.agent_prompts).

Every LLM agent in this service asks this module for its model, system
prompt and generation parameters. The admin console is the authority: when
a row exists for the agent, the DB decides. When it does not, the agent
keeps the hardcoded prompt and the model from settings — the service must
never stop working because the admin DB is empty or unreachable.

Where the data lives
    public.agent_prompts   Draft_DB   (DRAFT_DB_URL)
        id, name, prompt, model_ids, temperature, agent_type,
        llm_parameters, created_at, updated_at
    public.llm_models      Document_DB (DOC_DB_URL)
        id, name        — model_ids entries resolve to name (an API model id
                          such as 'gemini-2.5-flash' or 'claude-sonnet-5')

Matching is by NAME, never by a broad agent_type: several services share
this table and types like 'citation' or 'summarization' are reused across
them, so a type match would hand this service another service's row. Each
agent accepts a small, ordered list of names — the service-scoped one
first (see ACCEPTED_DB_NAMES) — and the first row found wins.

Resolution order per agent:
    1. in-process cache (CACHE_TTL_SECONDS)
    2. agent_prompts row matched by name
    3. hardcoded defaults (caller's prompt + settings model)

Console output: one [AgentConfig] line per resolution saying source=DB
(with row id, model, temperature, updated_at) or source=DEFAULT (with the
names that were looked for), so it is always visible which side is in use.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable

from config import get_settings

logger = logging.getLogger("judgement.agent_config")

# How long a resolved config (DB row or default) is reused before the admin
# DB is consulted again — an admin edit takes effect within this window.
CACHE_TTL_SECONDS: float = 120.0

_DEFAULT_TEMPERATURE: float = 0.1


# ─── Agent registry ──────────────────────────────────────────────────────────

def _gemini() -> str:
    return get_settings().gemini_model


def _gemini_fallback() -> str:
    return get_settings().gemini_fallback_model


def _gemini_keyword() -> str:
    return get_settings().gemini_keyword_fallback_model


def _claude() -> str:
    return get_settings().active_claude_model


@dataclass(frozen=True)
class AgentDefaults:
    """What an agent uses when the admin console has no row for it: the
    model from settings (env-tunable, as before) and the temperature the
    code was written with."""
    temperature: float
    model: Callable[[], str]


# Every LLM agent this service runs. The key is the agent's internal name —
# the same name the ADK agent is built with — and is what an admin row's
# `name` column should carry (see ACCEPTED_DB_NAMES for the exact strings).
AGENT_DEFAULTS: dict[str, AgentDefaults] = {
    "doc_classify":       AgentDefaults(0.1, _gemini),
    "context_extract":    AgentDefaults(0.1, _gemini),
    "issue_split":        AgentDefaults(0.25, _gemini_fallback),
    "keyword_extract":    AgentDefaults(0.25, _gemini_keyword),
    "judgment_verifier":  AgentDefaults(0.1, _gemini),
    "citation_analysis":  AgentDefaults(0.1, _gemini),
    "case_summary":       AgentDefaults(0.1, _gemini),
    "grounds_extract":    AgentDefaults(0.1, _gemini_fallback),
    "fresh_extract":      AgentDefaults(0.1, _gemini_fallback),
    "good_law_check":     AgentDefaults(0.0, _gemini),
    # Claude-path agents: these run through claude_llm, so their row's
    # prompt applies and a claude-* model in it is used as-is.
    "issue_spotter":      AgentDefaults(0.1, _claude),
    "query_generation":   AgentDefaults(0.1, _claude),
    "custom_issue_enrich": AgentDefaults(0.1, _claude),
}


def accepted_db_names(agent_name: str) -> list[str]:
    """The agent_prompts.name values this agent answers to, most specific
    first. The judgement_* forms let an admin scope a row to THIS service
    when another service already owns the bare name."""
    base = agent_name.strip().lower()
    names = [
        f"judgement_{base}_agent",
        f"judgement_{base}",
        f"{base}_agent",
        base,
    ]
    out: list[str] = []
    for n in names:
        if n and n not in out:
            out.append(n)
    return out


# ─── Config object ───────────────────────────────────────────────────────────

@dataclass
class AgentConfig:
    """One agent's resolved configuration. `source` says which side won."""
    agent_name: str
    prompt: str
    model_name: str
    temperature: float
    llm_parameters: dict[str, Any] = field(default_factory=dict)
    agent_type: str = ""
    source: str = "default"          # "db" | "default"
    db_id: int | None = None
    db_updated_at: Any = None

    @property
    def from_db(self) -> bool:
        return self.source == "db"


# ─── Cache ───────────────────────────────────────────────────────────────────

_cache_lock = threading.Lock()
_cache: dict[str, tuple[AgentConfig, float]] = {}
_models_cache: tuple[dict[int, str], float] | None = None
# Set when agent_prompts is unreachable/missing so the warning is printed
# once rather than per agent build.
_db_unavailable_logged = False


def invalidate(agent_name: str | None = None) -> None:
    """Drop cached configs so the next call re-reads the admin DB."""
    global _models_cache
    with _cache_lock:
        if agent_name:
            _cache.pop(agent_name, None)
        else:
            _cache.clear()
            _models_cache = None
    logger.info("[AgentConfig] cache invalidated — agent=%s", agent_name or "ALL")


# ─── DB plumbing ─────────────────────────────────────────────────────────────

def _connect(url: str | None):
    """One short-lived psycopg2 connection, or None. Never raises."""
    if not url:
        return None
    try:
        import psycopg2
        return psycopg2.connect(url, connect_timeout=5)
    except Exception as exc:
        logger.debug("[AgentConfig] connect failed (%s)", exc)
        return None


def _coerce_model_ids(raw: Any) -> list[int]:
    """model_ids as the admin console may store it: jsonb array ([27]),
    PostgreSQL int[] literal ({27}), a bare int, or a JSON string."""
    if raw is None or isinstance(raw, bool):
        return []
    if isinstance(raw, int):
        return [raw]
    if isinstance(raw, (list, tuple)):
        out = []
        for x in raw:
            try:
                out.append(int(x))
            except (TypeError, ValueError):
                continue
        return out
    if isinstance(raw, str):
        s = raw.strip()
        if not s:
            return []
        try:
            parsed = json.loads(s)
            if isinstance(parsed, list):
                return [int(x) for x in parsed if x is not None]
            if isinstance(parsed, int):
                return [parsed]
        except Exception:
            pass
        if s.startswith("{") and s.endswith("}"):
            out = []
            for part in s[1:-1].split(","):
                part = part.strip()
                if part:
                    try:
                        out.append(int(part))
                    except ValueError:
                        continue
            return out
    return []


def _parse_json_object(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
    return {}


def _llm_models_map() -> dict[int, str]:
    """id → model name from public.llm_models. Document_DB holds the
    catalogue; Draft_DB and the service DB are tried after it so a
    single-database deployment still resolves."""
    global _models_cache
    now = time.monotonic()
    with _cache_lock:
        if _models_cache and now < _models_cache[1]:
            return _models_cache[0]

    settings = get_settings()
    mapping: dict[int, str] = {}
    for url in (settings.doc_db_url, settings.draft_db_url, settings.db_url):
        conn = _connect(url)
        if conn is None:
            continue
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, TRIM(name::text) FROM public.llm_models "
                    "WHERE name IS NOT NULL AND TRIM(name::text) <> ''")
                mapping = {int(r[0]): str(r[1]) for r in cur.fetchall()
                           if r[0] is not None}
        except Exception as exc:
            logger.debug("[AgentConfig] llm_models unreadable (%s)", exc)
        finally:
            conn.close()
        if mapping:
            break

    with _cache_lock:
        _models_cache = (mapping, now + CACHE_TTL_SECONDS)
    return mapping


def _model_from_row(row: dict[str, Any], llm_params: dict[str, Any]) -> str | None:
    """The model the admin picked: model_ids[0] resolved through
    llm_models, else an id or name carried in llm_parameters."""
    ids = _coerce_model_ids(row.get("model_ids"))
    if ids:
        catalogue = _llm_models_map()
        for mid in ids:
            name = (catalogue.get(mid) or "").strip()
            if name:
                return name
        logger.warning(
            "[AgentConfig] agent=%s model_ids=%s not found in public.llm_models "
            "— falling back to the hardcoded model",
            row.get("name"), ids)

    raw_id = llm_params.get("model_id") or llm_params.get("llm_model_id")
    if raw_id is not None:
        try:
            name = (_llm_models_map().get(int(raw_id)) or "").strip()
            if name:
                return name
        except (TypeError, ValueError):
            pass

    for key in ("model", "model_name", "llm_model", "chat_model"):
        value = str(llm_params.get(key) or "").strip()
        if value:
            return value
    return None


def _fetch_row(agent_name: str) -> dict[str, Any] | None:
    """The agent_prompts row for this agent, matched by name. None when
    there is no row, no DB, or no table — every one of which means
    'use the hardcoded defaults'."""
    global _db_unavailable_logged
    names = accepted_db_names(agent_name)
    conn = _connect(get_settings().draft_db_url)
    if conn is None:
        if not _db_unavailable_logged:
            _db_unavailable_logged = True
            logger.warning(
                "[AgentConfig] Draft_DB not reachable (DRAFT_DB_URL) — every agent "
                "runs on its hardcoded prompt and model until it is available.")
        return None
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, name, prompt, model_ids, temperature, agent_type,
                       llm_parameters, updated_at
                FROM public.agent_prompts
                WHERE LOWER(TRIM(name::text)) = ANY(%s)
                ORDER BY ARRAY_POSITION(%s, LOWER(TRIM(name::text))),
                         updated_at DESC NULLS LAST, id DESC
                LIMIT 1
                """,
                (names, names),
            )
            row = cur.fetchone()
            if not row:
                return None
            cols = [d[0] for d in cur.description]
            return dict(zip(cols, row))
    except Exception as exc:
        if not _db_unavailable_logged:
            _db_unavailable_logged = True
            logger.warning(
                "[AgentConfig] public.agent_prompts unreadable (%s) — every agent "
                "runs on its hardcoded prompt and model.", exc)
        return None
    finally:
        conn.close()


# ─── Public API ──────────────────────────────────────────────────────────────

def get_agent_config(agent_name: str, *, default_prompt: str = "",
                     default_model: str | None = None,
                     default_temperature: float | None = None) -> AgentConfig:
    """Resolve one agent's model, prompt and parameters — admin DB first,
    hardcoded defaults when the DB has nothing for it."""
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(agent_name)
        if hit and now < hit[1]:
            cached = hit[0]
            # The prompt default can differ per call (e.g. keyword_extract's
            # two query styles), so a cached DEFAULT keeps this call's prompt.
            if cached.from_db:
                return cached
            return AgentConfig(
                agent_name=cached.agent_name,
                prompt=default_prompt or cached.prompt,
                model_name=cached.model_name,
                temperature=cached.temperature,
                llm_parameters=dict(cached.llm_parameters),
                agent_type=cached.agent_type,
                source="default",
            )

    defaults = AGENT_DEFAULTS.get(agent_name)
    fallback_model = (default_model
                      or (defaults.model() if defaults else _gemini()))
    fallback_temperature = (default_temperature
                            if default_temperature is not None
                            else (defaults.temperature if defaults
                                  else _DEFAULT_TEMPERATURE))

    try:
        row = _fetch_row(agent_name)
    except Exception as exc:
        # Belt and braces: nothing about the admin DB may reach the agent —
        # a failure here means "no row", never a broken build.
        logger.warning("[AgentConfig] agent=%s: admin lookup failed (%s) — "
                       "using the hardcoded prompt and model", agent_name, exc)
        row = None
    if row:
        llm_params = _parse_json_object(row.get("llm_parameters"))

        # temperature: llm_parameters wins over the column, as the admin UI
        # writes the live value into the parameter blob.
        temperature = fallback_temperature
        for candidate in (llm_params.get("temperature"), row.get("temperature")):
            if candidate is not None:
                try:
                    temperature = float(candidate)
                    break
                except (TypeError, ValueError):
                    continue

        model_name = _model_from_row(row, llm_params) or fallback_model

        prompt = str(row.get("prompt") or "").strip()
        extra = str(llm_params.get("system_instructions") or "").strip()
        if extra:
            prompt = f"{prompt}\n\n{extra}".strip() if prompt else extra
        if not prompt:
            # A row with an empty prompt configures the MODEL only — the
            # agent keeps its hardcoded instruction rather than losing it.
            prompt = default_prompt
            logger.info("[AgentConfig] agent=%s: DB row %s has no prompt — "
                        "keeping the hardcoded instruction", agent_name, row.get("id"))
        elif len(prompt) < 20 and default_prompt:
            logger.warning("[AgentConfig] agent=%s: DB prompt is only %d characters "
                           "(%r) — using it as given", agent_name, len(prompt), prompt)

        cfg = AgentConfig(
            agent_name=agent_name,
            prompt=prompt,
            model_name=model_name,
            temperature=temperature,
            llm_parameters=llm_params,
            agent_type=str(row.get("agent_type") or "").strip(),
            source="db",
            db_id=row.get("id"),
            db_updated_at=row.get("updated_at"),
        )
        logger.info(
            "[AgentConfig] source=DB       agent=%-18s row=%-4s name=%-28r "
            "model=%-22s temp=%.2f prompt=%d chars updated=%s",
            agent_name, cfg.db_id, str(row.get("name") or ""), cfg.model_name,
            cfg.temperature, len(cfg.prompt), cfg.db_updated_at)
    else:
        cfg = AgentConfig(
            agent_name=agent_name,
            prompt=default_prompt,
            model_name=fallback_model,
            temperature=fallback_temperature,
            llm_parameters={},
            agent_type="",
            source="default",
        )
        logger.info(
            "[AgentConfig] source=DEFAULT  agent=%-18s model=%-22s temp=%.2f "
            "— no public.agent_prompts row named any of %s",
            agent_name, cfg.model_name, cfg.temperature,
            accepted_db_names(agent_name))

    with _cache_lock:
        _cache[agent_name] = (cfg, now + CACHE_TTL_SECONDS)
    return cfg


def describe_agents() -> list[dict[str, Any]]:
    """Every agent with the configuration currently in force — powers the
    /health/agents endpoint so the admin can see which side won."""
    out: list[dict[str, Any]] = []
    for name in AGENT_DEFAULTS:
        cfg = get_agent_config(name)
        out.append({
            "agent": name,
            "source": cfg.source,
            "model": cfg.model_name,
            "temperature": cfg.temperature,
            # The hardcoded prompt lives at the call site, so its length is
            # only known there — report where the prompt comes from instead
            # of a misleading 0.
            "promptFrom": "admin" if cfg.from_db else "code",
            "promptChars": len(cfg.prompt) if cfg.from_db else None,
            "dbId": cfg.db_id,
            "dbUpdatedAt": cfg.db_updated_at.isoformat() if hasattr(
                cfg.db_updated_at, "isoformat") else cfg.db_updated_at,
            "acceptedDbNames": accepted_db_names(name),
        })
    return out
