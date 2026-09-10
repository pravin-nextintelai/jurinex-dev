"""Controlled memory system for JuriNex case chat (JRNX-ENG-2026-008).

Four context layers, assembled per generation in a fixed order:

    0. platform guardrails          (existing PERMANENT_SYSTEM_PROMPT)
    1. profile + preferences        (profile: authservice; preferences: this package)
    2. case instructions            (this package, human-written, per case)
    3. case memory                  (this package, pipeline-written, per case)
    4. preset                       (existing secret_manager / preset_prompts)
    5. retrieved documents          (existing RAG)
    6. the user's message           (highest precedence)

Isolation between cases is a data-layer property: every read and every write in
`repository` carries a `case_key`, resolved by `scope.resolve_case_scope`.

Module map
    scope       — resolve folder_name + user -> CaseScope (case_key, access ids)
    repository  — the ONLY SQL; version-token writes, purge, rebind
    validator   — what may be stored: tags, caps, PII, inference language, dedupe
    schemas     — pydantic contracts shared by the router and the extractor
    assembly    — (phase 2) build the prompt blocks from the layers
    recall      — (phase 4) past-session retrieval
    writer      — (phase 5) post-turn extraction into memory
    seed        — (phase 3) [extracted] lines from intake output
    export      — (phase 3) portable export/import
"""
from __future__ import annotations

from app.services.memory.schemas import (  # noqa: F401
    MemoryLine,
    MemoryOp,
    MemoryOps,
    MemoryProposal,
    MemorySettings,
    SECTIONS,
    TAGS,
)

__all__ = [
    "MemoryLine",
    "MemoryOp",
    "MemoryOps",
    "MemoryProposal",
    "MemorySettings",
    "SECTIONS",
    "TAGS",
]
