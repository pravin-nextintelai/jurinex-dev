"""Polish: tidy an instruction the advocate typed, without changing what it asks.

One small model call, on request only. The result is a suggestion the advocate
sees next to their own wording and chooses or discards; nothing is saved here.
Whatever comes back goes through the same checks as a typed instruction, so
polishing cannot smuggle in a rule that switches off verification, and cannot
put a case detail into a universal instruction.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Iterable

from app.core.config import get_settings
from app.services.memory.schemas import MAX_INSTRUCTION_ITEM_CHARS
from app.services.memory.validator import normalize_for_compare, validate_instruction_item

logger = logging.getLogger("agentic_document_service.memory.polish")

POLISH_TIMEOUT_MS = 12_000
POLISH_MAX_OUTPUT_TOKENS = 400
POLISH_TARGET_CHARS = 300

POLISH_PROMPT = """\
You tidy one standing instruction that an advocate wrote for JuriNex, a legal
research and drafting assistant. Rewrite it as one clear directive in the
advocate's own voice.

- Keep the meaning and every specific: languages, courts, citation styles,
  forms of address, things to avoid.
- Imperative mood, present tense, plain text, one or two sentences, at most
  300 characters.
- Remove filler; fix grammar and spelling. Turn a bare phrase into a directive:
  "tables" becomes "Present lists of events as tables."
- Add nothing that was not asked: no new requirements, examples, reasons or
  caveats.
- SCOPE "user" means the instruction applies in every case the advocate
  handles: keep it general and never add a case detail. SCOPE "case" applies
  to one case: keep the case details the advocate wrote.
- If it is already clear, return it unchanged.

Return JSON only: {"polished": "<the instruction>"}
"""

_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)


@dataclass
class PolishResult:
    original: str
    polished: str
    changed: bool = False
    problems: list[dict[str, str]] = field(default_factory=list)
    error: str | None = None
    model: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "original": self.original,
            "polished": self.polished,
            "changed": self.changed,
            "problems": list(self.problems),
            "error": self.error,
            "model": self.model,
        }


def parse_polished(payload: Any) -> str:
    """The polished text from the model's output. Raises ValueError when there is none."""
    text = payload.decode("utf-8", "replace") if isinstance(payload, bytes) else str(payload or "")
    text = _FENCE_RE.sub("", text).strip()
    if not text:
        raise ValueError("The model returned nothing.")
    data: Any = None
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            try:
                data = json.loads(match.group(0))
            except json.JSONDecodeError:
                data = None
    if isinstance(data, dict):
        polished = " ".join(str(data.get("polished") or "").split())
        if polished:
            return polished
        raise ValueError("The model returned no polished text.")
    raise ValueError("The model did not return JSON.")


def _client(model: str) -> Any:
    from app.services.adapters.document_ai import _gemini_client

    return _gemini_client(model)


def _config(model: str) -> Any:
    from google.genai import types

    kwargs: dict[str, Any] = {
        "system_instruction": POLISH_PROMPT,
        "temperature": 0.2,
        "max_output_tokens": POLISH_MAX_OUTPUT_TOKENS,
        "response_mime_type": "application/json",
    }
    try:
        return types.GenerateContentConfig(**kwargs, http_options=types.HttpOptions(timeout=POLISH_TIMEOUT_MS))
    except Exception:  # noqa: BLE001 — older SDKs have no per-request http_options
        return types.GenerateContentConfig(**kwargs)


def _ask_model(text: str, scope_type: str) -> tuple[str, str]:
    """(polished text, model name). Raises when the model is unavailable or unusable."""
    model = str(get_settings().memory_polish_model or "gemini-3.1-flash-lite")
    client = _client(model)
    if client is None:
        raise RuntimeError("No Gemini client is configured for polishing.")
    response = client.models.generate_content(
        model=model,
        contents=f"SCOPE: {scope_type}\nINSTRUCTION:\n<<<\n{text}\n>>>",
        config=_config(model),
    )
    return parse_polished(getattr(response, "text", "") or ""), model


def polish_instruction(
    text: str,
    *,
    scope_type: str,
    party_names: Iterable[str] = (),
) -> PolishResult:
    """Tidy one instruction. Never raises: on any failure the original comes back unchanged."""
    original = " ".join(str(text or "").split())
    if not original:
        return PolishResult(original="", polished="", problems=[{"code": "empty", "message": "Type an instruction first."}])

    problems = validate_instruction_item(original, scope_type=scope_type, party_names=party_names)
    if problems:
        # The advocate's own text breaks a rule; polishing cannot fix that.
        return PolishResult(
            original=original,
            polished=original,
            problems=[{"code": p.code, "message": p.detail} for p in problems],
        )

    try:
        polished, model = _ask_model(original, scope_type)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Memory] polish unavailable: %s", exc)
        return PolishResult(original=original, polished=original, error="unavailable")

    polished = polished[:MAX_INSTRUCTION_ITEM_CHARS].strip()
    after = validate_instruction_item(polished, scope_type=scope_type, party_names=party_names)
    if after:
        logger.info("[Memory] polish result refused: %s", [p.code for p in after])
        return PolishResult(
            original=original,
            polished=original,
            model=model,
            problems=[{"code": p.code, "message": f"The polished version was set aside: {p.detail}"} for p in after],
        )

    changed = normalize_for_compare(polished) != normalize_for_compare(original)
    return PolishResult(original=original, polished=polished if changed else original, changed=changed, model=model)
