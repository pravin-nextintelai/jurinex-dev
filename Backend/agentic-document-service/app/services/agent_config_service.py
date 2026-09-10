"""
Per-agent configuration loader from public.agent_prompts.

Schema expected in DB:
  id            int / bigint
  name          text          (e.g. "Drafter Agent")
  prompt        text          (system prompt)
  model_ids     int[]         (FK to public.llm_models.id)
  temperature   numeric       (top-level column; llm_parameters.temperature takes precedence)
  agent_type    text          (e.g. "drafting", "intake", "retrieval")
  created_at    timestamptz
  updated_at    timestamptz
  llm_parameters jsonb        (full generation config blob)

Resolution order for every agent call:
  1. In-memory cache (TTL = CACHE_TTL_SECONDS)
  2. DB: agent_prompts — match agent_type first, then name ILIKE keyword
  3. Hardcoded defaults (caller supplies default_prompt; model from settings.adk_model)

Console output (logger.info / logger.warning) shows:
  - source (db | default)
  - agent name, db row id, agent_type
  - resolved model name, temperature
  - DB updated_at timestamp
"""
from __future__ import annotations

import json
import logging
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger("agentic_document_service.agent_config")

# ── Constants ──────────────────────────────────────────────────────────────────
CACHE_TTL_SECONDS: float = 120.0
_DEFAULT_MODEL: str = "gemini-2.5-pro"
_DEFAULT_TEMPERATURE: float = 0.7

# Maps internal agent name → agent_type values to search in DB (first match wins).
# Do NOT add broad types like "summarization" here without a name guard — multiple agents share it.
_AGENT_TYPE_SEARCH: dict[str, list[str]] = {
    "legal_case_management_root": ["orchestration", "root", "legal_case_management_root"],
    "form_population_agent":      ["intake", "form_population", "form population"],
    "document_processing_agent":  ["document_processing", "document processing", "processing"],
    "grounded_retrieval_agent":   ["retrieval", "grounded_retrieval", "grounded retrieval", "qa"],
    "preset_execution_agent":     ["preset", "preset_execution", "preset execution"],
    "learning_mode_agent":        ["learning", "learning_mode", "learning mode", "socratic"],
}

# Fallback: search by ILIKE on name when agent_type has no match (more specific phrases first).
_AGENT_NAME_KEYWORDS: dict[str, list[str]] = {
    "legal_case_management_root": ["legal case management root", "orchestrator", "case management root"],
    "form_population_agent":      ["form population", "intake"],
    "document_processing_agent":  ["document processing", "classification"],
    "grounded_retrieval_agent":   ["grounded_retrieval", "grounded retrieval", "grounded", "retrieval"],
    "preset_execution_agent":     ["preset"],
    "learning_mode_agent":        ["learning mode", "socratic", "learning"],
}


# ── Data class ─────────────────────────────────────────────────────────────────
@dataclass
class AgentConfig:
    agent_name: str
    prompt: str
    model_name: str
    temperature: float
    llm_parameters: dict[str, Any]
    agent_type: str
    source: str                        # "db" | "default"
    db_id: int | None = None
    db_updated_at: Any = None


# ── Cache ──────────────────────────────────────────────────────────────────────
_cache_lock = threading.Lock()
_cache: dict[str, tuple[AgentConfig, float]] = {}   # agent_name → (config, expires_at)

# Set to True the first time we confirm the table is missing so we stop hitting DB
_table_missing: bool = False
_table_missing_logged: bool = False   # log the notice only once


def _mono() -> float:
    return time.monotonic()


# ── DB helpers ─────────────────────────────────────────────────────────────────
def _coerce_model_id_list(raw: Any) -> list[int]:
    """
    Normalize agent_prompts.model_ids from PostgreSQL / dashboards into a list of ints.

    Handles: int[], tuple, JSON string "[1,2]", PostgreSQL literal "{1,2}", single int.
    """
    if raw is None:
        return []
    if isinstance(raw, bool):
        return []
    if isinstance(raw, int):
        return [raw]
    if isinstance(raw, (list, tuple)):
        out: list[int] = []
        for x in raw:
            if x is None:
                continue
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
        except Exception:
            pass
        # PostgreSQL array text: {1,2,3} or {}
        if s.startswith("{") and s.endswith("}"):
            inner = s[1:-1].strip()
            if not inner:
                return []
            parts = [p.strip() for p in inner.split(",") if p.strip()]
            out = []
            for p in parts:
                try:
                    out.append(int(p))
                except ValueError:
                    continue
            return out
    return []


@contextmanager
def _get_agent_prompts_connection():
    """
    Connection used specifically for public.agent_prompts lookup.

    Default: same DATABASE_URL as the service.
    Optional override: AGENT_PROMPTS_DATABASE_URL / DRAFT_DATABASE_URL
    (useful when agent prompts are stored in Draft_DB).
    """
    from app.core.config import get_settings
    from app.services.db import get_db_connection

    settings = get_settings()
    override_url = str(getattr(settings, "agent_prompts_database_url", "") or "").strip()
    default_url = str(getattr(settings, "database_url", "") or "").strip()

    # No override (or same URL): keep existing DB path.
    if not override_url or override_url == default_url:
        with get_db_connection() as conn:
            yield conn
        return

    try:
        import psycopg
        from psycopg.rows import dict_row
    except Exception:
        logger.warning(
            "[AgentConfig] AGENT_PROMPTS_DATABASE_URL set but psycopg is unavailable; "
            "falling back to DATABASE_URL"
        )
        with get_db_connection() as conn:
            yield conn
        return

    conn = psycopg.connect(override_url, row_factory=dict_row, connect_timeout=8)
    try:
        yield conn
    finally:
        conn.close()


def _resolve_model_ids(model_ids: Any) -> str | None:
    """
    Resolve first model_id in the array to a model name string by querying llm_models.
    Returns None when the DB is unavailable or the row doesn't exist.
    """
    ids = _coerce_model_id_list(model_ids)

    if not ids:
        return None

    def _query(connection_factory) -> str | None:
        with connection_factory() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT TRIM(name::text) AS name
                FROM public.llm_models
                WHERE id = ANY(%s) AND name IS NOT NULL AND TRIM(name::text) <> ''
                ORDER BY id
                LIMIT 1
                """,
                (ids,),
            )
            row = cur.fetchone()
            if row:
                name = str(row.get("name") or "").strip()
                return name if name else None
        return None

    try:
        resolved = _query(_get_agent_prompts_connection)
        if resolved:
            return resolved
    except Exception as exc:
        logger.debug("[AgentConfig] model_ids=%s not in agent-prompts DB: %s", ids, exc)
    try:
        from app.services.db import get_db_connection

        return _query(get_db_connection)
    except Exception as exc:
        logger.warning("[AgentConfig] model_ids=%s resolve error: %s", ids, exc)
    return None


def _model_name_from_llm_parameters(llm_params: dict[str, Any]) -> str | None:
    """
    Some dashboards store the API model id only in llm_parameters (model / model_name / llm_model).
    Use when model_ids is empty or could not be resolved.
    """
    if not llm_params:
        return None
    for key in ("model", "model_name", "llm_model", "llm_model_name", "chat_model"):
        v = llm_params.get(key)
        if v is None:
            continue
        s = str(v).strip()
        if not s:
            continue
        low = s.lower()
        if low.startswith(("claude", "gemini", "gemma", "deepseek", "kimi", "moonshot")) or "/" in s:
            return s
    return None


def _resolve_model_from_llm_parameters_model_id(llm_params: dict[str, Any]) -> str | None:
    """Resolve llm_parameters.model_id (single int FK) via llm_models."""
    raw = llm_params.get("model_id") or llm_params.get("llm_model_id")
    if raw is None:
        return None
    try:
        mid = int(raw)
    except (TypeError, ValueError):
        return None
    if mid <= 0:
        return None
    def _query(connection_factory) -> str | None:
        with connection_factory() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT TRIM(name::text) AS name
                FROM public.llm_models
                WHERE id = %s AND name IS NOT NULL AND TRIM(name::text) <> ''
                LIMIT 1
                """,
                (mid,),
            )
            row = cur.fetchone()
            if row:
                name = str(row.get("name") or "").strip()
                return name if name else None
        return None

    try:
        resolved = _query(_get_agent_prompts_connection)
        if resolved:
            return resolved
    except Exception as exc:
        logger.debug("[AgentConfig] model_id=%s not in agent-prompts DB: %s", raw, exc)
    try:
        from app.services.db import get_db_connection

        return _query(get_db_connection)
    except Exception as exc:
        logger.warning("[AgentConfig] llm_parameters model_id=%s resolve error: %s", raw, exc)
    return None


def _is_table_missing_error(exc: Exception) -> bool:
    """Return True when the exception means the agent_prompts table doesn't exist."""
    msg = str(exc).lower()
    return (
        "relation" in msg and "does not exist" in msg
        or "undefined_table" in type(exc).__name__.lower()
        or "undefinedtable" in type(exc).__name__.lower()
    )


def _normalize_name_text(value: Any) -> str:
    return str(value or "").strip().lower()


def _pick_row_from_agents_payload(agents: list[dict[str, Any]], name_variants: list[str]) -> dict[str, Any] | None:
    if not agents:
        return None
    if not name_variants:
        return dict(agents[0])
    wanted = {_normalize_name_text(x) for x in name_variants if str(x or "").strip()}
    for row in agents:
        if _normalize_name_text(row.get("name")) in wanted:
            return dict(row)
    return None


def _fetch_agent_row_via_http(
    *,
    agent_name: str,
    name_variants: list[str],
    agent_types: list[str],
) -> dict[str, Any] | None:
    """
    Fallback path: read agent rows from agent-draft-service API.
    Useful when this service cannot directly access Draft_DB.
    """
    try:
        import httpx
        from app.core.config import get_settings
    except Exception:
        return None

    settings = get_settings()
    base = str(getattr(settings, "agent_draft_service_url", "") or "").strip().rstrip("/")
    if not base:
        return None

    # Try likely buckets first. Summarization is where grounded_retrieval_agent is commonly stored.
    type_candidates: list[str] = []
    for t in ["summarization", "summary", *agent_types]:
        v = str(t or "").strip().lower()
        if v and v not in type_candidates:
            type_candidates.append(v)

    with httpx.Client(timeout=3.0) as client:
        for atype in type_candidates:
            try:
                resp = client.get(
                    f"{base}/api/agents/list",
                    params={"agent_type": atype},
                )
                if resp.status_code != 200:
                    continue
                payload = resp.json() if resp.content else {}
                agents = payload.get("agents")
                if not isinstance(agents, list):
                    continue
                row = _pick_row_from_agents_payload(agents, name_variants)
                if row:
                    logger.info(
                        "[AgentConfig] fallback source=HTTP  agent=%s  via=%s/api/agents/list  "
                        "agent_type=%s  id=%s  name=%s",
                        agent_name,
                        base,
                        atype,
                        row.get("id"),
                        row.get("name"),
                    )
                    return row
            except Exception:
                continue
    return None


def _internal_name_variants(agent_name: str) -> list[str]:
    """
    DB rows may use internal ids (grounded_retrieval_agent) or omit the _agent suffix.
    Admin "Summarization" agents still use the name column for the internal id in most setups.
    """
    s = (agent_name or "").strip().lower()
    if not s:
        return []
    out: list[str] = []
    seen: set[str] = set()
    for cand in (s, s.replace(" ", "_")):
        if cand and cand not in seen:
            seen.add(cand)
            out.append(cand)
    if s.endswith("_agent") and len(s) > 6:
        base = s[:-6].rstrip("_")
        if base and base not in seen:
            seen.add(base)
            out.append(base)
    return out


def _fetch_agent_row(agent_name: str) -> dict[str, Any] | None:
    """
    Query agent_prompts for the best matching row.

    Lookup priority:
      1. Exact name match        — WHERE name = '<agent_name>'           (most reliable)
      2. Exact agent_type match  — WHERE agent_type IN (<candidates>)
      3. ILIKE name keyword      — WHERE name ILIKE '%<keyword>%'

    The name column in the DB stores the internal agent names directly
    (e.g. 'form_population_agent'), so pass 1 handles all standard rows.
    """
    global _table_missing, _table_missing_logged
    from app.services.db import is_db_available

    if _table_missing:
        # DB table missing in this service context; try HTTP fallback.
        row = _fetch_agent_row_via_http(
            agent_name=agent_name,
            name_variants=_internal_name_variants(agent_name),
            agent_types=_AGENT_TYPE_SEARCH.get(agent_name, []),
        )
        if row:
            return row
        return None

    if not is_db_available():
        row = _fetch_agent_row_via_http(
            agent_name=agent_name,
            name_variants=_internal_name_variants(agent_name),
            agent_types=_AGENT_TYPE_SEARCH.get(agent_name, []),
        )
        if row:
            return row
        return None

    agent_types = _AGENT_TYPE_SEARCH.get(agent_name, [])
    name_keywords = _AGENT_NAME_KEYWORDS.get(agent_name, [])
    name_variants = _internal_name_variants(agent_name)

    try:
        with _get_agent_prompts_connection() as conn, conn.cursor() as cur:
            # ── Pass 1: exact name match (internal id + common variants) ─────
            if name_variants:
                cur.execute(
                    """
                    SELECT *
                    FROM public.agent_prompts
                    WHERE LOWER(TRIM(name::text)) = ANY(%s)
                    ORDER BY updated_at DESC NULLS LAST, id DESC
                    LIMIT 1
                    """,
                    (name_variants,),
                )
                row = cur.fetchone()
                if row:
                    logger.debug(
                        "[AgentConfig] found by name IN %s id=%s",
                        name_variants,
                        row.get("id"),
                    )
                    return dict(row)

            # ── Pass 1b: Admin UI "Summarization" type + same name variants ──
            # Many deployments store all case-chat agents under agent_type = summarization.
            if name_variants:
                cur.execute(
                    """
                    SELECT *
                    FROM public.agent_prompts
                    WHERE LOWER(TRIM(agent_type::text)) IN ('summarization', 'summary')
                      AND LOWER(TRIM(name::text)) = ANY(%s)
                    ORDER BY updated_at DESC NULLS LAST, id DESC
                    LIMIT 1
                    """,
                    (name_variants,),
                )
                row = cur.fetchone()
                if row:
                    logger.debug(
                        "[AgentConfig] found by summarization+name id=%s name=%s",
                        row.get("id"),
                        row.get("name"),
                    )
                    return dict(row)

            # ── Pass 2: exact agent_type match ───────────────────────────────
            for atype in agent_types:
                cur.execute(
                    """
                    SELECT *
                    FROM public.agent_prompts
                    WHERE LOWER(TRIM(agent_type::text)) = %s
                    ORDER BY updated_at DESC NULLS LAST, id DESC
                    LIMIT 1
                    """,
                    (atype.lower(),),
                )
                row = cur.fetchone()
                if row:
                    logger.debug("[AgentConfig] found by agent_type=%s id=%s", atype, row.get("id"))
                    return dict(row)

            # ── Pass 3: ILIKE name keyword ────────────────────────────────────
            for keyword in name_keywords:
                cur.execute(
                    """
                    SELECT *
                    FROM public.agent_prompts
                    WHERE LOWER(name) LIKE %s
                    ORDER BY updated_at DESC NULLS LAST, id DESC
                    LIMIT 1
                    """,
                    (f"%{keyword.lower()}%",),
                )
                row = cur.fetchone()
                if row:
                    logger.debug("[AgentConfig] found by name keyword=%s id=%s", keyword, row.get("id"))
                    return dict(row)

    except Exception as exc:
        if _is_table_missing_error(exc):
            _table_missing = True
            if not _table_missing_logged:
                _table_missing_logged = True
                logger.info(
                    "[AgentConfig] agent_prompts table not found — "
                    "all agents will use hardcoded default prompts and settings.adk_model. "
                    "Create the table and add rows to enable per-agent DB config."
                )
        else:
            logger.warning("[AgentConfig] DB lookup failed for agent=%s: %s", agent_name, exc)

    # Final fallback: query agent-draft-service over HTTP.
    row = _fetch_agent_row_via_http(
        agent_name=agent_name,
        name_variants=name_variants,
        agent_types=agent_types,
    )
    if row:
        return row

    return None


def _parse_llm_parameters(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
    return {}


def _default_model_from_settings() -> str:
    try:
        from app.core.config import get_settings
        name = (get_settings().adk_model or "").strip()
        return name if name else _DEFAULT_MODEL
    except Exception:
        return _DEFAULT_MODEL


# ── Public API ─────────────────────────────────────────────────────────────────
def get_agent_config(agent_name: str, *, default_prompt: str = "") -> AgentConfig:
    """
    Return AgentConfig for the given internal agent name.

    Cache TTL = CACHE_TTL_SECONDS (default 120 s).

    Console logging:
      ✅  source=DB      — shows db_id, agent_type, model, temperature, updated_at
      ⚠️  source=DEFAULT — shown when no DB row found; uses settings.adk_model + default_prompt
    """
    now = _mono()

    # ── Cache hit ──────────────────────────────────────────────────────────────
    with _cache_lock:
        hit = _cache.get(agent_name)
        if hit and now < hit[1]:
            cfg = hit[0]
            logger.debug(
                "[AgentConfig] cache-hit  agent=%s  source=%s  model=%s",
                agent_name, cfg.source, cfg.model_name,
            )
            return cfg

    # ── DB lookup ──────────────────────────────────────────────────────────────
    row = _fetch_agent_row(agent_name)

    if row:
        llm_params = _parse_llm_parameters(row.get("llm_parameters"))

        # temperature: llm_parameters.temperature > top-level column > default
        if "temperature" in llm_params and llm_params["temperature"] is not None:
            temperature = float(llm_params["temperature"])
        elif row.get("temperature") is not None:
            temperature = float(row["temperature"])
        else:
            temperature = _DEFAULT_TEMPERATURE

        # model: model_ids → llm_models.name; else llm_parameters model_id FK; else model string; else ADK default
        resolved_model = _resolve_model_ids(row.get("model_ids"))
        if not resolved_model:
            resolved_model = _resolve_model_from_llm_parameters_model_id(llm_params)
        if not resolved_model:
            # HTTP fallback rows from agent-draft-service may already include a resolved model string.
            v = str(row.get("resolved_model") or "").strip()
            resolved_model = v or None
        if not resolved_model:
            names = row.get("model_names")
            if isinstance(names, list) and names:
                v = str(names[0] or "").strip()
                resolved_model = v or None
        if not resolved_model:
            resolved_model = _model_name_from_llm_parameters(llm_params)

        if resolved_model:
            from app.services.llm_models_catalog import resolve_chat_llm_model

            model_name = resolve_chat_llm_model(resolved_model, resolved_model)
        else:
            model_name = _default_model_from_settings()
            logger.warning(
                "[AgentConfig] DB row id=%s agent=%s: could not resolve model — model_ids=%r "
                "and no claude/gemini id in llm_parameters. Using ADK default (often Gemini): %s",
                row.get("id"),
                agent_name,
                row.get("model_ids"),
                model_name,
            )

        prompt = str(row.get("prompt") or default_prompt).strip() or default_prompt
        agent_type = str(row.get("agent_type") or "").strip()
        db_id = row.get("id")
        db_updated_at = row.get("updated_at")

        cfg = AgentConfig(
            agent_name=agent_name,
            prompt=prompt,
            model_name=model_name,
            temperature=temperature,
            llm_parameters=llm_params,
            agent_type=agent_type,
            source="db",
            db_id=db_id,
            db_updated_at=db_updated_at,
        )

        logger.info(
            "[AgentConfig] ✅  source=DB  agent=%-35s  db_id=%-4s  agent_type=%-25s  "
            "model=%-30s  temperature=%.2f  updated_at=%s",
            agent_name, db_id, agent_type, model_name, temperature, db_updated_at,
        )

    else:
        model_name = _default_model_from_settings()
        cfg = AgentConfig(
            agent_name=agent_name,
            prompt=default_prompt,
            model_name=model_name,
            temperature=_DEFAULT_TEMPERATURE,
            llm_parameters={},
            agent_type=agent_name,
            source="default",
        )

        logger.warning(
            "[AgentConfig] source=DEFAULT  agent=%s  model=%s  temperature=%.2f  — "
            "no matching row in public.agent_prompts (check name e.g. grounded_retrieval_agent, "
            "agent_type summarization vs retrieval, and that DATABASE_URL matches the admin DB).",
            agent_name,
            model_name,
            _DEFAULT_TEMPERATURE,
        )

    with _cache_lock:
        _cache[agent_name] = (cfg, now + CACHE_TTL_SECONDS)

    return cfg


def invalidate_agent_config_cache(agent_name: str | None = None) -> None:
    """Flush cache for one agent or all agents."""
    with _cache_lock:
        if agent_name:
            _cache.pop(agent_name, None)
        else:
            _cache.clear()
    logger.info("[AgentConfig] cache invalidated  agent=%s", agent_name or "ALL")
