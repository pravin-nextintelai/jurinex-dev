"""Pydantic contracts shared by the memory router, the repository and the extractor.

`MemoryOps` is passed to Gemini as `response_schema`, so it must stay small,
flat and free of unions that the structured-output encoder cannot express.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


# The seven memory sections. Order matters: it is the order used when rendering
# the section index into the prompt.
SECTIONS: tuple[str, ...] = (
    "summary",
    "facts",
    "parties",
    "documents",
    "drafting_log",
    "decisions",
    "dates",
)

# Line origin tags. `inferred` is deliberately absent: a model conclusion is
# never written as a fact — it is surfaced as a proposal instead.
TAGS: tuple[str, ...] = ("stated", "extracted", "status")

# Ops the repository accepts. Exactly five, as specified in the guide.
OPS: tuple[str, ...] = (
    "create_section",
    "rewrite_section",
    "append_line",
    "replace_line",
    "delete_section",
)

SectionName = Literal["summary", "facts", "parties", "documents", "drafting_log", "decisions", "dates"]
TagName = Literal["stated", "extracted", "status"]
OpName = Literal["create_section", "rewrite_section", "append_line", "replace_line", "delete_section"]

# Hard caps. The validator enforces these; the DB enforces the line length too.
MAX_LINE_CHARS = 300
MAX_SUMMARY_LINES = 12
MAX_SUMMARY_CHARS = 1500
MAX_SECTION_LINES = 60
MAX_CASE_CHARS = 40_000
MAX_INSTRUCTIONS_CHARS = 4_000
MAX_PREFERENCES_CHARS = 2_000
MAX_PREFERENCES_WORDS = 300
MAX_OPS_PER_TURN = 8

# Instructions are stored one per item so each can be switched on and off. The
# per-scope character caps above still bound the whole set: case instructions at
# MAX_INSTRUCTIONS_CHARS, the advocate's universal ones at MAX_PREFERENCES_CHARS.
MAX_INSTRUCTION_ITEM_CHARS = 400
MAX_INSTRUCTION_ITEMS = 40

# Where an instruction set lives: "user" applies in every case the advocate
# works on; "case" applies in one case only.
INSTRUCTION_SCOPES: tuple[str, ...] = ("user", "case")
InstructionScope = Literal["user", "case"]

# Where an instruction item came from. "chat": the writer saved a rule the
# advocate stated in so many words. "learned": accepted from a suggestion.
INSTRUCTION_ORIGINS: tuple[str, ...] = ("user", "chat", "learned", "import", "migrated")

# An override switches one item off (or on) for one case or one chat session
# without changing the item itself.
OVERRIDE_TYPES: tuple[str, ...] = ("case", "session")
OverrideType = Literal["case", "session"]


class MemoryLine(BaseModel):
    """One fact line."""

    tag: TagName
    text: str = Field(max_length=MAX_LINE_CHARS)
    # Where the fact came from. "document" requires `document` to name an
    # uploaded file that exists in this case.
    source: Literal["user", "document"] = "user"
    document: str | None = None
    # True when this line supersedes an earlier one (history is kept in-line).
    changed: bool = False
    # Health, financial, family or criminal-record detail. Dropped by the writer
    # when the advocate has turned sensitive details off.
    sensitive: bool = False


class MemoryOp(BaseModel):
    """A single memory mutation."""

    op: OpName
    section: SectionName
    reason: str = Field(default="", max_length=120)
    # append_line / replace_line
    line: MemoryLine | None = None
    # replace_line: the existing line being superseded (matched by text or id)
    match_text: str | None = None
    line_id: str | None = None
    # create_section / rewrite_section
    lines: list[MemoryLine] = Field(default_factory=list)


class MemoryProposal(BaseModel):
    """A standing instruction or preference the model noticed.

    The writer counts how often the advocate asks for it and saves it only after
    repeated requests (see writer._handle_proposals).
    """

    kind: Literal["instruction", "preference"]
    text: str = Field(max_length=MAX_LINE_CHARS)
    # The id of a rule already noticed that this message asks for again, if any.
    repeats: str | None = Field(default=None, max_length=64)


class MemoryOps(BaseModel):
    """The extractor's whole output for one conversation turn."""

    ops: list[MemoryOp] = Field(default_factory=list)
    proposals: list[MemoryProposal] = Field(default_factory=list)
    nothing_durable: bool = False


class MemorySettings(BaseModel):
    """The five memory toggles, at one scope or resolved across scopes."""

    enabled: bool = True
    write_enabled: bool = True
    recall_enabled: bool = True
    instructions_enabled: bool = True
    sensitive_enabled: bool = True

    def merged_with(self, other: "MemorySettings") -> "MemorySettings":
        """AND every flag. Used to fold firm -> user -> case settings."""
        return MemorySettings(
            enabled=self.enabled and other.enabled,
            write_enabled=self.write_enabled and other.write_enabled,
            recall_enabled=self.recall_enabled and other.recall_enabled,
            instructions_enabled=self.instructions_enabled and other.instructions_enabled,
            sensitive_enabled=self.sensitive_enabled and other.sensitive_enabled,
        )


# Field names of MemorySettings, in UI order. Kept outside the model so it does
# not become a pydantic field.
SETTINGS_FLAGS: tuple[str, ...] = (
    "enabled",
    "write_enabled",
    "recall_enabled",
    "instructions_enabled",
    "sensitive_enabled",
)
