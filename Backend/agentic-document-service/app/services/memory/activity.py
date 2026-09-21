"""What memory did with each chat turn, in words an advocate can read.

Every turn writes one row to `memory_assembly_log`: why the writer skipped the message,
or what it saved, suggested, counted and refused. Those rows were only codes
("write:nothing_durable", "proposal_not_a_way_of_working"), so an advocate who chatted
all day and found an empty memory panel had no way to tell a working system from a
broken one. This turns each row into a headline, the items it changed, and the reasons
anything was left out.

Pure functions over log rows: no database, no model, nothing that can fail a request.
"""
from __future__ import annotations

from typing import Any, Iterable, Sequence

from app.core.config import get_settings

QUESTION_CHARS = 240

# Why the writer did not look for anything in a message. Keys are the writer's
# `skipped_reason` codes, without their "write:" prefix.
SKIP_REASONS: dict[str, tuple[str, str]] = {
    "nothing_durable": ("nothing", "Nothing to keep: no fact, decision or rule in your message"),
    "greeting": ("nothing", "A greeting, so nothing to remember"),
    "too_short": ("nothing", "Too short to learn from"),
    "no_message": ("nothing", "No message to learn from"),
    "saved_prompt": ("skipped", "A saved prompt, not your own words, so nothing was learned"),
    "mode_learning": ("skipped", "Learning mode does not use memory"),
    "mode_deep_research": ("skipped", "Deep research does not use memory"),
    "disabled_by_user": ("off", "Generating memory from chats is switched off"),
    "disabled_globally": ("off", "Memory is switched off for this service"),
    "no_scope": ("skipped", "This chat is not linked to a case"),
    "db_unavailable": ("error", "The memory store was unavailable, so this turn was not checked"),
    "extractor_error": ("error", "The memory model was unavailable, so this turn was not checked"),
    "writer_error": ("error", "Something went wrong while checking this turn"),
}

# What each skip means in practice, shown under the headline.
HINTS: dict[str, str] = {
    "nothing_durable": (
        "JuriNex keeps what you state, such as “the hearing is on 14 October”, "
        "“we will not press the alibi” or “always answer in Marathi”. "
        "Questions and requests for an answer are not kept."
    ),
    "saved_prompt": "Memory learns only from what you type yourself.",
    "disabled_by_user": "Turn it on in this panel's Settings tab, or in Settings → Memory.",
}

# Why a proposed change was refused, by rejection code. Codes not listed are grouped
# under a generic line rather than shown raw.
REJECTIONS: dict[str, str] = {
    "proposal_not_a_way_of_working": (
        "A request about what this one answer should contain was not kept as a rule"
    ),
    "proposal_not_in_advocate_message": "A suggested rule was not in your own words, so it was dropped",
    "proposal_dismissed_before": "You dismissed this rule before, so it was not suggested again",
    "proposal_pii": "A suggested rule contained personal identifiers, so it was dropped",
    "proposal_invalid": "A suggested rule broke a memory rule, so it was dropped",
    "not_in_advocate_message": "A fact was not in your own words, so it was dropped",
    "extracted_from_chat": "A fact came from JuriNex's answer rather than from you, so it was dropped",
    "case_full": "This case's memory is full",
    "advocate_full": "What JuriNex knows about you is full",
    "answer_fact_known": "A fact in the answer is already in memory in other words, so it was not added again",
    "answer_fact_not_merged": (
        "A fact in the answer repeats one in memory, but the two could not be combined safely, so it was not added"
    ),
    "reread_keeps_newer": "Memory already holds something newer, so this earlier message did not change it",
    "reread_written_before": (
        "This was in memory before and was deleted or replaced since, so the earlier message did not bring it back"
    ),
    "advocate_sensitive": "A personal detail about you was not kept",
    "advocate_not_in_advocate_message": "Something about you was not in your own words, so it was dropped",
    "advocate_forgotten_before": "You asked JuriNex to forget this about you before",
    "answer_fact_not_in_document": (
        "A fact in the answer was not found in the document it cited, so it was not kept"
    ),
    "answer_fact_unchecked": "A fact in the answer could not be checked against its document, so it was not kept",
    "answer_facts_unavailable": "The answer could not be read for facts this time",
    "review_unavailable": "Your recent messages could not be reviewed this time",
    "review_summary_not_grounded": (
        "A summary line named something you did not write and memory does not hold, so it was not kept"
    ),
    "review_decision_not_in_advocate_messages": "A decision was not in your own words, so it was not kept",
    "review_preference_not_a_pattern": "A way of working was not asked for often enough to suggest",
}
GENERIC_REJECTION = "A change could not be saved"

SECTION_LABELS = {
    "summary": "Summary",
    "facts": "Facts",
    "parties": "Parties",
    "documents": "Documents",
    "drafting_log": "Drafting log",
    "decisions": "Decisions",
    "dates": "Dates",
}


def _plural(count: int, word: str) -> str:
    return f"{count} {word}{'' if count == 1 else 's'}"


def _suggest_after() -> int:
    try:
        return max(1, int(getattr(get_settings(), "memory_rule_suggest_after", 2) or 2))
    except Exception:  # noqa: BLE001
        return 2


def write_reason(skipped_reason: str | None) -> str | None:
    """The writer's own reason from a log row's combined "read:…; write:…" field."""
    for part in str(skipped_reason or "").split(";"):
        part = part.strip()
        if part.startswith("write:"):
            return part[len("write:"):].strip() or None
    return None


def _details(row: dict[str, Any]) -> dict[str, Any]:
    value = row.get("details")
    return value if isinstance(value, dict) else {}


def _items(details: dict[str, Any], needed: int) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for line in details.get("lines") or []:
        item = {
            "kind": "fact",
            "section": line.get("section"),
            "section_label": SECTION_LABELS.get(str(line.get("section") or ""), "Memory"),
            "text": line.get("text"),
            "updated": bool(line.get("updated")),
        }
        if line.get("document"):
            # Read out of a cited document by the answer, and found there.
            item.update({"document": line.get("document"), "page": line.get("page")})
        if line.get("merged_from"):
            # The same fact was already in memory in other words; the two became one line.
            item["merged_from"] = line.get("merged_from")
        items.append(item)
    # Memory tidied of facts it held more than once (app/services/memory/same_fact.py).
    for merge in details.get("merged") or []:
        sources = [str(text) for text in merge.get("from") or [] if str(text or "").strip()]
        items.append(
            {
                "kind": "merged",
                "section_label": SECTION_LABELS.get(str(merge.get("section") or ""), "Memory"),
                "text": merge.get("text"),
                "count": len(sources),
            }
        )
    for repeat in details.get("removed") or []:
        items.append({"kind": "removed_repeat", "text": repeat.get("text"), "kept": repeat.get("kept")})
    for move in details.get("moved") or []:
        items.append(
            {"kind": "moved", "text": move.get("text"), "to_label": SECTION_LABELS.get(str(move.get("to") or ""), "Memory")}
        )
    for rule in details.get("instructions") or []:
        items.append({"kind": "instruction", "scope": rule.get("scope") or "case", "text": rule.get("text")})
    # A rule that was shown is logged twice under one id: under "requests" in the
    # advocate's words (the count), and under "suggestions" as it was offered, polished.
    # It is one suggestion; the advocate's wording rides along as what they said.
    suggestions = [dict(item) for item in details.get("suggestions") or []]
    by_id = {str(item.get("id")): item for item in suggestions if item.get("id")}
    for request in details.get("requests") or []:
        count = int(request.get("count") or 0)
        shown = by_id.get(str(request.get("id"))) if request.get("id") else None
        if shown is not None:
            spoken = str(request.get("text") or "").strip()
            if spoken and spoken != str(shown.get("text") or "").strip():
                shown["spoken"] = spoken
            continue
        if request.get("shown"):
            suggestions.append({"scope": request.get("scope") or "case", "text": request.get("text")})
        else:
            items.append(
                {"kind": "noticed", "scope": request.get("scope") or "case", "text": request.get("text"),
                 "count": count, "needed": needed}
            )
    for suggestion in suggestions:
        entry = {"kind": "suggestion", "scope": suggestion.get("scope") or "case", "text": suggestion.get("text")}
        if suggestion.get("spoken"):
            entry["spoken"] = suggestion["spoken"]
        items.append(entry)
    for fact in details.get("advocate") or []:
        items.append(
            {"kind": "about_you", "category": fact.get("category"), "text": fact.get("text"),
             "updated": bool(fact.get("updated"))}
        )
    for fact in details.get("advocate_evicted") or []:
        items.append({"kind": "made_room", "text": fact.get("text")})
    for tidy in details.get("advocate_consolidated") or []:
        if tidy.get("applied") or tidy.get("changed"):
            items.append(
                {"kind": "tidied", "lines_before": tidy.get("lines_before"), "lines_after": tidy.get("lines_after")}
            )
    review = details.get("review")
    if isinstance(review, dict) and review.get("turns"):
        items.append(
            {
                "kind": "reviewed",
                "turns": int(review.get("turns") or 0),
                "trigger": review.get("trigger"),
                "changed": int(review.get("changed") or 0),
                "suggested": int(review.get("suggested") or 0),
            }
        )
    profile = details.get("profile")
    if isinstance(profile, dict):
        for text in profile.get("practice") or []:
            items.append({"kind": "suggestion", "scope": "about_you", "text": text})
        for text in profile.get("rules") or []:
            items.append({"kind": "suggestion", "scope": "user", "text": text, "across_cases": True})
    seeded = details.get("seeded")
    if isinstance(seeded, dict) and (seeded.get("added") or seeded.get("updated")):
        items.append({"kind": "filled_in", "added": int(seeded.get("added") or 0), "updated": int(seeded.get("updated") or 0)})
    documents = [str(name) for name in details.get("documents") or [] if str(name or "").strip()]
    if documents:
        # Documents whose processing brought memory up to date (app/services/memory/seed.py).
        items.append({"kind": "uploaded", "documents": documents})
    return items


def _headline(items: Sequence[dict[str, Any]], rejections: Sequence[str]) -> tuple[str, str]:
    kinds = [item["kind"] for item in items]
    facts = kinds.count("fact")
    rules = kinds.count("instruction")
    about = kinds.count("about_you")
    parts: list[str] = []
    if facts:
        parts.append(f"saved {_plural(facts, 'fact')}")
    if rules:
        parts.append("saved an instruction" if rules == 1 else f"saved {rules} instructions")
    if about:
        parts.append("remembered something about you" if about == 1 else f"remembered {about} things about you")
    if parts:
        return "saved", (", ".join(parts)).capitalize()
    if "suggestion" in kinds:
        count = kinds.count("suggestion")
        return "suggested", "Suggested a rule for you to review" if count == 1 else f"Suggested {count} rules to review"
    if "noticed" in kinds:
        return "noticed", "Noticed a request and started counting it"
    if "merged" in kinds or "removed_repeat" in kinds:
        return "saved", "Combined facts memory held more than once"
    if "moved" in kinds:
        return "saved", "Moved dated facts to Dates"
    if "uploaded" in kinds:
        return "saved", "Added your newly processed documents to memory"
    if "filled_in" in kinds and "tidied" not in kinds and "made_room" not in kinds:
        return "saved", "Filled in memory from the case details"
    if "tidied" in kinds or "filled_in" in kinds or "made_room" in kinds:
        return "saved", "Tidied memory"
    if "reviewed" in kinds:
        return "nothing", "Reviewed your recent messages, nothing new to keep"
    if rejections:
        return "nothing", "Checked, but nothing could be kept"
    return "nothing", "Checked, nothing to keep"


def describe(row: dict[str, Any]) -> dict[str, Any]:
    """One log row as {headline, outcome, items, reasons, hint, question, ...}. Never raises."""
    details = _details(row)
    reason = write_reason(row.get("skipped_reason"))
    codes = [str(code) for code in details.get("rejection_codes") or [] if code]
    reasons: list[str] = []
    for code in codes:
        text = REJECTIONS.get(code, GENERIC_REJECTION)
        if text not in reasons:
            reasons.append(text)

    items = _items(details, _suggest_after())
    if reason and not items:
        outcome, headline = SKIP_REASONS.get(reason, ("skipped", "This turn was not checked"))
    else:
        outcome, headline = _headline(items, reasons)

    preset = bool(row.get("preset"))
    label = str(row.get("prompt_label") or "").strip()
    question = label if preset else str(row.get("question") or "").strip()
    if len(question) > QUESTION_CHARS:
        question = question[: QUESTION_CHARS - 1].rstrip() + "…"

    created = row.get("created_at")
    asked = row.get("asked_at")
    reread = str(row.get("mode") or "") == "reread"
    return {
        "id": row.get("id"),
        "chat_id": row.get("chat_id"),
        "created_at": created.isoformat() if hasattr(created, "isoformat") else created,
        # An earlier message read again: when it was asked, not when it was read.
        "reread": reread,
        "asked_at": asked.isoformat() if hasattr(asked, "isoformat") else asked,
        "question": question or None,
        "preset": preset,
        "outcome": outcome,
        "headline": headline,
        "hint": HINTS.get(reason or "") if not items else None,
        "reason_code": reason,
        "items": items,
        "reasons": reasons,
        "used": {
            "instructions": len(details.get("instructions_applied") or []),
            "about_you": int(details.get("advocate_lines") or 0),
            "sections": [
                str(section.get("section"))
                for section in (row.get("sections_loaded") or [])
                if isinstance(section, dict) and section.get("section")
            ],
        },
    }


def summarise(entries: Iterable[dict[str, Any]]) -> dict[str, int]:
    """How many turns ended each way, for the line above the list."""
    counts = {"turns": 0, "saved": 0, "suggested": 0, "noticed": 0, "nothing": 0, "skipped": 0, "off": 0, "error": 0}
    for entry in entries:
        counts["turns"] += 1
        outcome = str(entry.get("outcome") or "nothing")
        counts[outcome] = counts.get(outcome, 0) + 1
    return counts
