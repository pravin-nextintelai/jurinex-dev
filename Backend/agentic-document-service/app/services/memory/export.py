"""Portable export and import of one case's memory.

An export carries what JuriNex knows about a case — every memory section and its
lines, the case instructions, and the case-level memory settings — as a
self-describing JSON document. It deliberately leaves out:

* the assembly log, because an audit trail belongs to the deployment that
  produced it;
* pending proposals, which are suggestions nobody accepted;
* the internal case key, which means nothing outside this database.

Import treats the file as untrusted input. Every line goes back through the same
validator the extractor and the UI use, so an edited file cannot smuggle in an
`[inferred]` fact, a personal identifier, or instructions that switch off
verification. An `[extracted]` line survives only if the target case holds the
document it names, which also stops one case's document facts being imported
into another.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Sequence

from app.services.memory import repository
from app.services.memory.schemas import SECTIONS, SETTINGS_FLAGS
from app.services.memory.scope import CaseScope
from app.services.memory.seed import dedupe_threshold
from app.services.memory.validator import (
    find_duplicate,
    normalize_for_compare,
    strip_tag_prefix,
    validate_instructions,
    validate_line,
)

logger = logging.getLogger("agentic_document_service.memory.export")

EXPORT_SCHEMA = "jurinex.case_memory"
EXPORT_SCHEMA_VERSION = 1

# Provenance kept on export and accepted on import. Anything else in a line's
# source_ref is dropped, so an edited file cannot park arbitrary JSON in memory.
_SOURCE_REF_KEYS = ("kind", "imported_kind", "source", "document", "page", "session_id", "chat_id")
_SOURCE_REF_MAX_CHARS = 200


@dataclass
class ParsedImport:
    """A validated import, before anything is written."""

    lines: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    rejected: list[dict[str, Any]] = field(default_factory=list)
    instructions: str | None = None
    settings: dict[str, bool] | None = None

    @property
    def line_count(self) -> int:
        return sum(len(lines) for lines in self.lines.values())


def _clean_ref(ref: Any, *, imported: bool = False) -> dict[str, Any]:
    source = ref if isinstance(ref, dict) else {}
    out: dict[str, Any] = {}
    for key in _SOURCE_REF_KEYS:
        value = source.get(key)
        if value in (None, ""):
            continue
        out[key] = str(value)[:_SOURCE_REF_MAX_CHARS]
    if imported:
        original = out.get("kind")
        out["kind"] = "import"
        if original and original != "import":
            out["imported_kind"] = original
    return out


# ── Export ───────────────────────────────────────────────────────────────────

def export_case(scope: CaseScope) -> dict[str, Any]:
    """Everything JuriNex knows about one case, in a portable document."""
    key = scope.case_key
    stored = repository.get_sections(key)
    instructions = repository.get_instructions(key) or {}
    settings = repository.get_settings("case", key)

    sections: list[dict[str, Any]] = []
    for name in SECTIONS:
        data = stored.get(name)
        if not data:
            continue
        lines = [
            {
                "tag": str(line.get("tag") or "stated"),
                "text": str(line.get("text") or ""),
                "source_ref": _clean_ref(line.get("source_ref")),
            }
            for line in data.get("lines") or []
            if str(line.get("text") or "").strip()
        ]
        sections.append({"section": name, "version": data.get("version"), "lines": lines})

    return {
        "schema": EXPORT_SCHEMA,
        "schema_version": EXPORT_SCHEMA_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "case": {"folder_name": scope.folder_name, "case_id": scope.case_id},
        "instructions": {
            "content": str(instructions.get("content") or ""),
            "version": instructions.get("version"),
        },
        "settings": (
            {flag: bool(settings.get(flag, True)) for flag in SETTINGS_FLAGS} if settings else None
        ),
        "sections": sections,
    }


# ── Import ───────────────────────────────────────────────────────────────────

def parse_import(payload: Any, *, doc_names: Sequence[str] | None = None) -> ParsedImport:
    """Validate an export document. Pure: touches no database.

    Raises `ValueError` when the payload is not a readable export at all; a
    readable export with some bad lines parses, with those lines listed in
    `rejected`.
    """
    if not isinstance(payload, dict) or payload.get("schema") != EXPORT_SCHEMA:
        raise ValueError("This file is not a JuriNex case memory export.")
    try:
        version = int(payload.get("schema_version"))
    except (TypeError, ValueError):
        raise ValueError("This export has no readable schema version.") from None
    if version < 1 or version > EXPORT_SCHEMA_VERSION:
        raise ValueError(
            f"This export uses schema version {version}, which this version of JuriNex cannot read."
        )

    raw_sections = payload.get("sections") or []
    if not isinstance(raw_sections, list):
        raise ValueError("This export's sections are malformed.")

    parsed = ParsedImport()
    for block in raw_sections:
        if not isinstance(block, dict):
            continue
        name = str(block.get("section") or "").strip()
        if name not in SECTIONS:
            parsed.rejected.append(
                {
                    "section": name,
                    "text": "",
                    "code": "unknown_section",
                    "message": f"'{name}' is not a memory section.",
                }
            )
            continue

        kept = parsed.lines.setdefault(name, [])
        raw_lines = block.get("lines")
        for raw in raw_lines if isinstance(raw_lines, list) else []:
            if not isinstance(raw, dict):
                continue
            tag = str(raw.get("tag") or "").strip().lower()
            text = strip_tag_prefix(str(raw.get("text") or ""))
            ref = raw.get("source_ref") if isinstance(raw.get("source_ref"), dict) else {}
            problem = validate_line(
                tag,
                text,
                section=name,
                doc_names=doc_names,
                source="document" if tag == "extracted" else "user",
                document=str(ref.get("document") or "").strip() or None,
            )
            if problem is not None:
                parsed.rejected.append(
                    {"section": name, "text": text[:120], "code": problem.code, "message": problem.detail}
                )
                continue
            if any(normalize_for_compare(line["text"]) == normalize_for_compare(text) for line in kept):
                continue
            kept.append({"tag": tag, "text": text, "source_ref": _clean_ref(ref, imported=True)})

    parsed.lines = {name: lines for name, lines in parsed.lines.items() if lines}

    raw_instructions = payload.get("instructions")
    content = ""
    if isinstance(raw_instructions, dict):
        content = str(raw_instructions.get("content") or "").strip()
    if content:
        problems = validate_instructions(content)
        if problems:
            for problem in problems:
                parsed.rejected.append(
                    {
                        "section": "instructions",
                        "text": content[:120],
                        "code": problem.code,
                        "message": problem.detail,
                    }
                )
        else:
            parsed.instructions = content

    raw_settings = payload.get("settings")
    if isinstance(raw_settings, dict):
        parsed.settings = {flag: bool(raw_settings.get(flag, True)) for flag in SETTINGS_FLAGS}

    return parsed


def import_case(
    scope: CaseScope,
    payload: Any,
    *,
    actor: str | None = None,
    replace: bool = False,
    doc_names: Sequence[str] | None = None,
) -> dict[str, Any]:
    """Write a validated export into one case.

    `replace=False` (the default) merges: incoming lines that duplicate what the
    case already holds are skipped, and existing instructions are kept.
    `replace=True` swaps the case's memory sections, instructions and case-level
    settings for the file's; the assembly log and proposals are never touched.
    """
    parsed = parse_import(payload, doc_names=doc_names)
    key = scope.case_key
    written: dict[str, int] = {}
    duplicates = 0

    if replace:
        written = repository.replace_case_memory(
            key, parsed.lines, actor=actor, folder_name=scope.folder_name
        )
    else:
        stored = repository.get_sections(key)
        for name in SECTIONS:
            incoming = parsed.lines.get(name)
            if not incoming:
                continue
            current = list((stored.get(name) or {}).get("lines") or [])
            fresh: list[dict[str, Any]] = []
            for line in incoming:
                if find_duplicate(line["text"], current + fresh, dedupe_threshold(name)) is not None:
                    duplicates += 1
                    continue
                fresh.append(line)
            if fresh:
                result = repository.append_lines(key, name, fresh, actor=actor, folder_name=scope.folder_name)
                written[name] = int(result.get("added") or 0)

    instructions_imported = False
    if parsed.instructions is not None:
        current = repository.get_instructions(key) or {}
        if replace or not str(current.get("content") or "").strip():
            repository.put_instructions(
                key,
                parsed.instructions,
                current.get("version"),
                updated_by=actor,
                folder_name=scope.folder_name,
            )
            instructions_imported = True

    settings_imported = False
    if replace and parsed.settings is not None:
        repository.put_settings("case", key, parsed.settings, updated_by=actor)
        settings_imported = True

    logger.info(
        "[Memory] import case_key=%s replace=%s written=%s duplicates=%s rejected=%s",
        key,
        replace,
        written,
        duplicates,
        len(parsed.rejected),
    )
    return {
        "case_key": key,
        "replaced": replace,
        "written": written,
        "lines_written": sum(written.values()),
        "duplicates_skipped": duplicates,
        "rejected": parsed.rejected,
        "instructions_imported": instructions_imported,
        "settings_imported": settings_imported,
    }
