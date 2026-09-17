"""Learning about the advocate from all of their cases, not one chat at a time.

What JuriNex knows about an advocate grew only from sentences they typed about
themselves ("I mostly appear before the Aurangabad Bench"). Most advocates never type
one, yet their cases already say it, and the rules they keep in one case are often the
rules they want in every case.

So, at most once a day and whenever the advocate asks, this looks across their own cases
and **suggests** two things. It never saves either: both are inferences, and an
inference about a person is theirs to accept.

* **Their practice**, counted from the cases table with no model: the court level, the
  kind of matter and the place they handle most ("Mostly handles Writ Petition matters
  (8 of 12 cases)"). A value is suggested only when it covers at least half of the cases
  that record it, and at least two of them.
* **Their ways of working**, from the rules kept in each case. A model groups rules that
  say the same thing in different words ("give detailed answers", "explain in depth");
  a rule is suggested for every case only when two or more *different* cases hold it,
  checked without the model on the words that say how to write.
"""
from __future__ import annotations

import json
import logging
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Sequence

from app.core.config import get_settings

logger = logging.getLogger("agentic_document_service.memory.profile")

MIN_CASES = 3
MIN_SHARE = 0.5
MIN_COUNT = 2
MAX_RULES_SHOWN = 120
TIMEOUT_MS = 45_000
PROFILE_ACTOR = "memory-profile"

# Places renamed in official records, so one court's cases are counted together.
PLACE_ALIASES: dict[str, str] = {
    "chhatrapati sambhajinagar": "aurangabad",
    "sambhajinagar": "aurangabad",
    "dharashiv": "osmanabad",
    "ahilyanagar": "ahmednagar",
    "bombay": "mumbai",
    "madras": "chennai",
    "calcutta": "kolkata",
}


@dataclass(frozen=True)
class PracticeFact:
    field: str
    text: str
    count: int
    total: int


@dataclass(frozen=True)
class SharedRule:
    text: str
    case_keys: tuple[str, ...]


@dataclass
class LearnReport:
    ran: bool = False
    skipped_reason: str | None = None
    practice_suggested: list[str] = field(default_factory=list)
    rules_suggested: list[str] = field(default_factory=list)
    refused: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "ran": self.ran,
            "skipped_reason": self.skipped_reason,
            "practice_suggested": list(self.practice_suggested),
            "rules_suggested": list(self.rules_suggested),
            "refused": list(self.refused),
        }


# ── Settings ─────────────────────────────────────────────────────────────────

def _setting(name: str, default: Any) -> Any:
    try:
        return getattr(get_settings(), name, default)
    except Exception:  # noqa: BLE001
        return default


def enabled() -> bool:
    return bool(_setting("memory_profile_enabled", True))


def interval_hours() -> float:
    try:
        return max(1.0, float(_setting("memory_profile_interval_hours", 24) or 24))
    except (TypeError, ValueError):
        return 24.0


def due(last_run: datetime | None, *, now: datetime | None = None) -> bool:
    if not enabled():
        return False
    if last_run is None:
        return True
    moment = now or datetime.now(timezone.utc)
    when = last_run if last_run.tzinfo else last_run.replace(tzinfo=timezone.utc)
    return moment - when >= timedelta(hours=interval_hours())


# ── Practice, counted from the cases ─────────────────────────────────────────

def _normalise_place(value: str) -> str:
    key = " ".join(value.lower().replace("bench", " ").split())
    return PLACE_ALIASES.get(key, key)


def practice_facts(cases: Sequence[dict[str, Any]]) -> list[PracticeFact]:
    """What most of the advocate's cases have in common, as plain facts about them."""
    if len(cases) < MIN_CASES:
        return []

    facts: list[PracticeFact] = []

    def dominant(field_name: str, *, normalise=lambda value: value.lower()) -> tuple[str, int, int] | None:
        values = [str(case.get(field_name) or "").strip() for case in cases]
        values = [value for value in values if value]
        if len(values) < MIN_COUNT:
            return None
        groups: dict[str, list[str]] = {}
        for value in values:
            groups.setdefault(normalise(value), []).append(value)
        key, members = max(groups.items(), key=lambda item: len(item[1]))
        count = len(members)
        if count < MIN_COUNT or count / len(values) < MIN_SHARE:
            return None
        # Shown in the spelling the cases use most.
        label = Counter(members).most_common(1)[0][0]
        return label, count, len(values)

    court = dominant("court_level")
    if court:
        facts.append(PracticeFact("court_level", f"Practises mainly before the {court[0]} ({court[1]} of {court[2]} cases)", court[1], court[2]))
    kind = dominant("case_type")
    if kind:
        facts.append(PracticeFact("case_type", f"Mostly handles {kind[0]} matters ({kind[1]} of {kind[2]} cases)", kind[1], kind[2]))
    area = dominant("primary_category")
    if area:
        facts.append(PracticeFact("primary_category", f"Mostly works in {area[0]} matters ({area[1]} of {area[2]} cases)", area[1], area[2]))
    place = dominant("jurisdiction", normalise=_normalise_place)
    if place:
        facts.append(PracticeFact("jurisdiction", f"Most cases are at {place[0]} ({place[1]} of {place[2]} cases)", place[1], place[2]))
    return facts


# ── Ways of working shared by several cases ──────────────────────────────────

PROMPT = """\
You look at the standing rules one advocate keeps in each of their cases, and find the
ways of working they want in more than one case, so each can be offered once as a rule
for all their cases.

A way of working says HOW answers should be written: depth ("in detail"), plainness
("in simple language"), format (tables, bullet points), language, citation style, forms of
address. A rule about ONE case's content (its parties, facts, grounds or documents) is
never shared, even if two cases have one.

Group rules that mean the same thing in different words. Report a group only when rules
from at least two DIFFERENT cases belong to it. Write each as one short instruction that
works in any case, with no case detail, and list the case ids its rules came from.
Skip anything ALREADY FOR ALL CASES already says.

Return JSON only: {"shared": [{"text": "Give detailed answers", "cases": ["273", "301"]}]}
If nothing is shared, return {"shared": []}.
"""

_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)


def build_request(rules: Sequence[dict[str, Any]], universal: Sequence[str]) -> str:
    parts = ["ALREADY FOR ALL CASES:"]
    parts.extend([f"- {text}" for text in universal] or ["(none)"])
    parts += ["", "RULES BY CASE:"]
    for rule in rules[:MAX_RULES_SHOWN]:
        parts.append(f"- case {rule.get('case_key')}: {str(rule.get('text') or '').strip()}")
    return "\n".join(parts)


def parse_shared(payload: Any, case_keys: Sequence[str]) -> list[SharedRule]:
    text = payload.decode("utf-8", "replace") if isinstance(payload, bytes) else str(payload or "")
    text = _FENCE_RE.sub("", text).strip()
    if not text:
        raise ValueError("The model returned nothing.")
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            raise ValueError("The model did not return JSON.") from None
        data = json.loads(match.group(0))
    rows = data.get("shared") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        raise ValueError("The model returned no list.")
    known = set(case_keys)
    shared: list[SharedRule] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        body = " ".join(str(row.get("text") or "").split()).strip()
        cited = tuple(dict.fromkeys(str(key) for key in row.get("cases") or [] if str(key) in known))
        if body and len(cited) >= 2:
            shared.append(SharedRule(text=body[:300], case_keys=cited))
    return shared[:5]


def ask_model(request: str, case_keys: Sequence[str]) -> list[SharedRule]:
    from google.genai import types

    from app.services.adapters.document_ai import _build_gemini_config, _gemini_client

    model = str(_setting("memory_profile_model", "") or "").strip() or "gemini-3.7-flash"
    level = str(_setting("memory_profile_thinking_level", "") or "").strip().lower() or "medium"
    if "gemini-3.7" in model and level == "minimal":
        level = "low"
    client = _gemini_client(model)
    if client is None:
        raise RuntimeError("No Gemini client is configured for learning across cases.")
    config = _build_gemini_config({"temperature": 0.1, "max_output_tokens": 2_048}, {"thinking_level": level}, model_name=model)
    try:
        config.system_instruction = PROMPT
        config.response_mime_type = "application/json"
        config.http_options = types.HttpOptions(timeout=TIMEOUT_MS)
    except Exception:  # noqa: BLE001
        pass
    response = client.models.generate_content(model=model, contents=request, config=config)
    return parse_shared(getattr(response, "text", "") or "", case_keys)


# ── Putting it together ──────────────────────────────────────────────────────

def _already_offered(text: str, rows: Sequence[dict[str, Any]], *, target: str | None) -> bool:
    """Suggested before under this key, in any state: pending, accepted or dismissed."""
    from app.services.memory.validator import find_duplicate

    same_kind = [
        row
        for row in rows
        if ((row.get("source_ref") or {}).get("target") if isinstance(row.get("source_ref"), dict) else None) == target
    ]
    return find_duplicate(text, same_kind) is not None


def learn(user_id: str, *, force: bool = False, now: datetime | None = None) -> LearnReport:
    """Look across the advocate's own cases and record suggestions. Never raises.

    `force` runs it now whatever the interval, as when the advocate presses the button.
    """
    from app.services.memory import repository
    from app.services.memory.instructions import user_proposal_key
    from app.services.memory.parties import party_names_for_user
    from app.services.memory.synthesis import is_manner
    from app.services.memory.validator import find_duplicate, validate_advocate_line, validate_instruction_item

    report = LearnReport()
    uid = str(user_id or "").strip()
    try:
        if not enabled():
            report.skipped_reason = "disabled"
            return report
        if not uid.isdigit():
            report.skipped_reason = "no_user"
            return report
        settings = repository.effective_settings(user_id=uid)
        if not settings.enabled or not settings.write_enabled:
            report.skipped_reason = "disabled_by_user"
            return report
        if not force and not due(repository.get_learned_at(uid), now=now):
            report.skipped_reason = "not_due"
            return report

        cases = repository.list_own_cases(uid)
        key = user_proposal_key(uid)
        offered = repository.list_proposals(key, None, include_hidden=True)
        party_names = tuple(party_names_for_user(uid))

        # Their practice, counted: suggested for "What JuriNex knows about you".
        if settings.advocate_enabled:
            advocate = repository.get_advocate_memory(uid)
            known = list(advocate.get("lines") or [])
            forgotten = [{"text": text} for text in advocate.get("forgotten") or []]
            for fact in practice_facts(cases):
                if validate_advocate_line(fact.text, category="practice", party_names=party_names) is not None:
                    report.refused.append(fact.text)
                    continue
                if find_duplicate(fact.text, known) or find_duplicate(fact.text, forgotten):
                    continue
                if _already_offered(fact.text, offered, target="advocate"):
                    continue
                ref = {
                    "kind": "profile", "target": "advocate", "category": "practice", "field": fact.field,
                    "count": fact.count, "total": fact.total, "hidden": False,
                }
                if repository.add_proposal(key, uid, "preference", fact.text, ref):
                    report.practice_suggested.append(fact.text)
                    offered.append({"text": fact.text, "source_ref": ref})

        # Their ways of working, where two or more cases keep the same rule.
        if settings.instructions_enabled:
            case_keys = [str(case.get("case_key")) for case in cases if case.get("case_key")]
            rules = repository.list_case_rules(case_keys)
            rules += [
                {"case_key": row.get("case_key"), "text": row.get("text")}
                for row in repository.list_user_proposals(uid)
                if str(row.get("kind") or "") == "instruction" and str(row.get("case_key") or "") in case_keys
            ]
            if len({str(rule.get("case_key")) for rule in rules}) >= 2:
                universal = [
                    str(item.get("text") or "")
                    for item in (repository.get_instruction_set("user", uid) or {}).get("items") or []
                ]
                try:
                    shared = ask_model(build_request(rules, universal), case_keys)
                except Exception as exc:  # noqa: BLE001
                    logger.warning("[Memory] learning across cases unavailable user_id=%s: %s", uid, exc)
                    shared = []
                    report.refused.append("model_unavailable")
                for rule in shared:
                    backing = cases_backing(rule, rules)
                    if len(backing) < 2 or not is_manner(rule.text):
                        report.refused.append(rule.text)
                        continue
                    if validate_instruction_item(rule.text, scope_type="user", party_names=party_names):
                        report.refused.append(rule.text)
                        continue
                    if find_duplicate(rule.text, [{"text": text} for text in universal]) is not None:
                        continue
                    if _already_offered(rule.text, offered, target=None):
                        continue
                    ref: dict[str, Any] = {"kind": "cross_case", "learned_from": sorted(backing), "hidden": False}
                    polished = _polish(rule.text, party_names)
                    if polished:
                        ref["polished"] = polished
                    if repository.add_proposal(key, uid, "preference", rule.text, ref):
                        report.rules_suggested.append(polished or rule.text)
                        offered.append({"text": rule.text, "source_ref": ref})

        repository.mark_learned(uid)
        report.ran = True
        if report.practice_suggested or report.rules_suggested:
            logger.info(
                "[Memory] learned across cases user_id=%s practice=%s rules=%s",
                uid, len(report.practice_suggested), len(report.rules_suggested),
            )
    except Exception as exc:  # noqa: BLE001 — never fails a chat or a settings page
        logger.warning("[Memory] learning across cases failed user_id=%s: %s", uid, exc)
        report.skipped_reason = report.skipped_reason or "error"
    return report


def _polish(text: str, party_names: Sequence[str]) -> str | None:
    try:
        from app.services.memory.polish import polish_instruction

        result = polish_instruction(text, scope_type="user", party_names=party_names)
    except Exception:  # noqa: BLE001
        return None
    if result.problems or result.error or not result.changed:
        return None
    return result.polished or None


def cases_backing(rule: SharedRule, rules: Sequence[dict[str, Any]]) -> set[str]:
    """The cases whose own rules ask for the same way of writing. Checked without a model."""
    from app.services.memory.synthesis import _manner_terms

    wanted = _manner_terms(rule.text)
    if not wanted:
        return set()
    return {
        str(item.get("case_key"))
        for item in rules
        if str(item.get("case_key")) in rule.case_keys and wanted & _manner_terms(str(item.get("text") or ""))
    }
