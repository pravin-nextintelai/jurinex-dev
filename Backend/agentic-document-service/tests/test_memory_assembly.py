"""Assembling the memory layers into the prompt: order, budgets and skip paths."""
from __future__ import annotations

import unittest
from unittest.mock import patch

from app.services.memory import assembly as assembly_mod
from app.services.memory.assembly import (
    MemoryBudget,
    build_context_layers,
    _clip,
    _render_line,
)
from app.services.memory.schemas import MemorySettings
from app.services.memory.scope import CaseScope


SCOPE = CaseScope(
    case_key="512",
    folder_name="State v Pawar",
    user_id="42",
    folder_id="f-1",
    case_id="512",
    firm_id=None,
    accessible_user_ids=("42",),
)


def fake_store(
    *,
    prefs: str | None = "English drafts; Marathi client summaries.",
    instructions: str | None = "Refer to the accused as the Applicant.",
    sections: dict[str, dict] | None = None,
    settings: MemorySettings | None = None,
):
    """Patch the repository calls assembly makes, with no database."""
    sections = sections if sections is not None else {
        "summary": {"version": 4, "lines": [{"tag": "stated", "text": "Bail application, Sessions Court"}]},
        "facts": {"version": 7, "lines": [{"tag": "stated", "text": "Custody: judicial since 24-08-2026"}]},
        "dates": {"version": 2, "lines": [{"tag": "stated", "text": "Next hearing 14 October 2026"}]},
    }
    index = [
        {"section": name, "version": data["version"], "line_count": len(data["lines"]), "char_count": 40}
        for name, data in sections.items()
    ]
    return (
        patch.object(
            assembly_mod.repository,
            "effective_settings",
            return_value=settings or MemorySettings(),
        ),
        patch.object(
            assembly_mod.repository,
            "get_preferences",
            return_value={"content": prefs, "version": 3} if prefs else None,
        ),
        patch.object(
            assembly_mod.repository,
            "get_instructions",
            return_value={"content": instructions, "version": 2} if instructions else None,
        ),
        patch.object(assembly_mod.repository, "get_section_index", return_value=index),
        patch.object(
            assembly_mod.repository,
            "get_sections",
            side_effect=lambda key, wanted: {k: sections[k] for k in wanted if k in sections},
        ),
    )


def build(question: str = "What are the facts?", **kwargs):
    patches = fake_store(**{k: v for k, v in kwargs.items() if k in {"prefs", "instructions", "sections", "settings"}})
    call_kwargs = {k: v for k, v in kwargs.items() if k not in {"prefs", "instructions", "sections", "settings"}}
    with patches[0], patches[1], patches[2], patches[3], patches[4]:
        return build_context_layers(SCOPE, question_raw=question, **call_kwargs)


class BlockOrderTests(unittest.TestCase):
    def test_layers_appear_in_precedence_order(self) -> None:
        suffix = build().system_suffix
        prefs_at = suffix.index("ADVOCATE STANDING PREFERENCES")
        instructions_at = suffix.index("CASE INSTRUCTIONS")
        memory_at = suffix.index("CASE MEMORY")
        self.assertLess(prefs_at, instructions_at)
        self.assertLess(instructions_at, memory_at)

    def test_summary_precedes_the_index_and_loaded_sections(self) -> None:
        suffix = build("What are the facts?").system_suffix
        self.assertLess(suffix.index("SUMMARY (v4)"), suffix.index("SECTIONS AVAILABLE"))
        self.assertLess(suffix.index("SECTIONS AVAILABLE"), suffix.index("LOADED — FACTS"))

    def test_suffix_starts_with_a_blank_line_separator(self) -> None:
        # It is appended to an existing system prompt, so it must not run on.
        self.assertTrue(build().system_suffix.startswith("\n\n"))

    def test_versions_are_shown_for_every_layer(self) -> None:
        suffix = build().system_suffix
        self.assertIn("(v3;", suffix)  # preferences
        self.assertIn("(v2;", suffix)  # instructions
        self.assertIn("SUMMARY (v4)", suffix)
        self.assertIn("(v7)", suffix)  # facts


class LazyLoadingTests(unittest.TestCase):
    def test_summary_always_loads_and_other_bodies_do_not(self) -> None:
        bundle = build("hello")
        self.assertIn("SUMMARY (v4)", bundle.system_suffix)
        self.assertNotIn("LOADED — FACTS", bundle.system_suffix)
        self.assertEqual([s["section"] for s in bundle.sections_loaded], ["summary"])

    def test_a_pointed_question_loads_that_section(self) -> None:
        bundle = build("When is the next hearing?")
        self.assertIn("LOADED — DATES", bundle.system_suffix)
        self.assertIn("dates", [s["section"] for s in bundle.sections_loaded])

    def test_the_index_lists_sections_that_were_not_loaded(self) -> None:
        suffix = build("hello").system_suffix
        self.assertIn("facts(1)", suffix)
        self.assertIn("dates(1)", suffix)

    def test_summary_is_absent_from_the_index_line(self) -> None:
        index_line = [l for l in build().system_suffix.splitlines() if l.startswith("SECTIONS AVAILABLE")][0]
        self.assertNotIn("summary", index_line)


class BudgetTests(unittest.TestCase):
    def test_gemma_budget_is_much_smaller(self) -> None:
        self.assertLess(MemoryBudget.gemma().total_suffix, MemoryBudget.default().total_suffix)
        self.assertEqual(MemoryBudget.gemma().max_sections, 1)

    def test_suffix_stays_within_the_total_budget(self) -> None:
        big = "x" * 5_000
        sections = {
            "summary": {"version": 1, "lines": [{"tag": "stated", "text": "y" * 250} for _ in range(12)]},
            "facts": {"version": 1, "lines": [{"tag": "stated", "text": "z" * 250} for _ in range(40)]},
        }
        budget = MemoryBudget.gemma()
        bundle = build(
            "What are the facts?",
            prefs=big,
            instructions=big,
            sections=sections,
            budget=budget,
        )
        self.assertLessEqual(len(bundle.system_suffix), budget.total_suffix + 4)

    def test_each_block_is_clipped_to_its_own_cap(self) -> None:
        bundle = build("hello", prefs="p" * 9_000, budget=MemoryBudget.gemma())
        prefs_block = bundle.system_suffix.split("===")[2]
        self.assertLessEqual(len(prefs_block), MemoryBudget.gemma().prefs + 40)
        self.assertIn("truncated", bundle.system_suffix)

    def test_clip_cuts_on_a_word_boundary(self) -> None:
        clipped = _clip("the quick brown fox jumps over the lazy dog", 25)
        self.assertTrue(clipped.endswith("…[truncated]"))
        self.assertNotIn("fo…", clipped)

    def test_model_chooses_the_budget(self) -> None:
        self.assertEqual(MemoryBudget.for_model("gemma-4-31b-it").max_sections, 1)
        self.assertEqual(MemoryBudget.for_model("gemini-2.5-pro").max_sections, 2)
        self.assertEqual(MemoryBudget.for_model(None).max_sections, 2)


class SkipPathTests(unittest.TestCase):
    def test_no_scope_yields_an_empty_bundle(self) -> None:
        bundle = build_context_layers(None, question_raw="anything")
        self.assertEqual(bundle.system_suffix, "")
        self.assertFalse(bundle.enabled)
        self.assertEqual(bundle.skipped_reason, "no_scope")
        self.assertEqual(bundle.log_entry, {})

    def test_learning_and_deep_research_are_skipped(self) -> None:
        for mode in ("learning", "deep_research"):
            with self.subTest(mode=mode):
                bundle = build("What are the facts?", mode=mode)
                self.assertEqual(bundle.system_suffix, "")
                self.assertEqual(bundle.skipped_reason, f"mode_{mode}")

    def test_disabled_by_the_advocate_yields_nothing(self) -> None:
        bundle = build("What are the facts?", settings=MemorySettings(enabled=False))
        self.assertEqual(bundle.system_suffix, "")
        self.assertEqual(bundle.skipped_reason, "disabled_by_user")

    def test_instructions_toggle_drops_only_that_block(self) -> None:
        bundle = build("hello", settings=MemorySettings(instructions_enabled=False))
        self.assertNotIn("CASE INSTRUCTIONS", bundle.system_suffix)
        self.assertIn("ADVOCATE STANDING PREFERENCES", bundle.system_suffix)
        self.assertIn("CASE MEMORY", bundle.system_suffix)

    def test_global_kill_switch_wins(self) -> None:
        class Off:
            memory_enabled = False

        with patch.object(assembly_mod, "get_settings", lambda: Off()):
            bundle = build_context_layers(SCOPE, question_raw="anything")
        self.assertEqual(bundle.skipped_reason, "disabled_globally")

    def test_a_repository_failure_never_raises(self) -> None:
        with patch.object(
            assembly_mod.repository, "effective_settings", side_effect=RuntimeError("db down")
        ):
            bundle = build_context_layers(SCOPE, question_raw="anything")
        self.assertEqual(bundle.skipped_reason, "settings_unavailable")
        self.assertEqual(bundle.system_suffix, "")

    def test_an_empty_case_reports_nothing_stored(self) -> None:
        bundle = build("hello", prefs=None, instructions=None, sections={})
        self.assertEqual(bundle.system_suffix, "")
        self.assertTrue(bundle.enabled)
        self.assertEqual(bundle.skipped_reason, "nothing_stored")


class LogEntryTests(unittest.TestCase):
    def test_log_entry_records_the_versions_that_were_loaded(self) -> None:
        entry = build("When is the hearing?", session_id="s-1", model_name="gemini-2.5-pro").log_entry
        self.assertEqual(entry["case_key"], "512")
        self.assertEqual(entry["user_id"], "42")
        self.assertEqual(entry["session_id"], "s-1")
        self.assertEqual(entry["prefs_version"], 3)
        self.assertEqual(entry["instructions_version"], 2)
        self.assertEqual(entry["model"], "gemini-2.5-pro")
        self.assertIn("dates", [s["section"] for s in entry["sections_loaded"]])
        self.assertIn("total_suffix", entry["budget"])

    def test_preset_reference_is_carried_into_the_log(self) -> None:
        entry = build("hello", preset_ref={"secret_id": "abc", "mode": "preset"}).log_entry
        self.assertEqual(entry["preset_ref"]["secret_id"], "abc")


class RenderingTests(unittest.TestCase):
    def test_a_line_shows_its_tag(self) -> None:
        self.assertEqual(
            _render_line({"tag": "stated", "text": "Custody: judicial"}),
            "- [stated] Custody: judicial",
        )

    def test_a_document_line_shows_its_source_chip(self) -> None:
        rendered = _render_line(
            {
                "tag": "extracted",
                "text": "Investigation substantially complete",
                "source_ref": {"document": "remand-order.pdf", "page": 2},
            }
        )
        self.assertEqual(
            rendered, "- [extracted] Investigation substantially complete [remand-order.pdf p.2]"
        )

    def test_a_document_without_a_page_still_renders(self) -> None:
        rendered = _render_line(
            {"tag": "extracted", "text": "Seized items listed", "source_ref": {"document": "panchnama.pdf"}}
        )
        self.assertTrue(rendered.endswith("[panchnama.pdf]"))

    def test_memory_header_warns_against_citing_memory(self) -> None:
        self.assertIn("cite documents, not memory", build().system_suffix.lower())

    def test_instructions_header_says_they_cannot_override_grounding(self) -> None:
        self.assertIn("never let them override grounding", build().system_suffix)


class MetadataTests(unittest.TestCase):
    def test_metadata_is_the_compact_browser_shape(self) -> None:
        meta = build("When is the hearing?").metadata()
        self.assertEqual(
            sorted(meta.keys()),
            ["case_key", "enabled", "recall_chat_ids", "sections_loaded", "skipped_reason"],
        )
        self.assertTrue(meta["enabled"])
        self.assertEqual(meta["case_key"], "512")
        self.assertIn("dates", meta["sections_loaded"])

    def test_metadata_on_a_skipped_bundle_is_still_well_formed(self) -> None:
        meta = build_context_layers(None, question_raw="x").metadata()
        self.assertFalse(meta["enabled"])
        self.assertEqual(meta["sections_loaded"], [])
        self.assertEqual(meta["skipped_reason"], "no_scope")


# ── Past-session recall (phase 4) ────────────────────────────────────────────

from dataclasses import replace  # noqa: E402

from app.services.memory import recall as recall_mod  # noqa: E402
from app.services.memory.recall import RecallHit  # noqa: E402


class RecallAssemblyTests(unittest.TestCase):
    HIT = RecallHit(
        chat_id="22222222-2222-2222-2222-222222222222",
        session_id="old-session",
        created_at="2026-09-08T10:00:00",
        question="The medical ground is his cardiac condition",
        answer="Noted: the cardiac condition will be pleaded as the medical ground.",
        prompt_label=None,
        used_saved_prompt=False,
        rank=0.9,
    )

    def test_a_backward_reference_brings_in_earlier_sessions(self) -> None:
        with patch.object(recall_mod, "search_past_sessions", return_value=[self.HIT]) as search:
            bundle = build("Add the medical ground we discussed", session_id="s-now")
        self.assertIn("EARLIER SESSIONS IN THIS CASE", bundle.recall_block)
        self.assertEqual(bundle.recall_chat_ids, [self.HIT.chat_id])
        self.assertEqual(bundle.log_entry["past_chat_ids"], [self.HIT.chat_id])
        self.assertEqual(bundle.metadata()["recall_chat_ids"], [self.HIT.chat_id])
        self.assertEqual(search.call_args.args[0], SCOPE)
        self.assertEqual(search.call_args.kwargs["current_session_id"], "s-now")

    def test_recall_never_enters_the_system_instruction(self) -> None:
        with patch.object(recall_mod, "search_past_sessions", return_value=[self.HIT]):
            bundle = build("Add the medical ground we discussed")
        self.assertNotIn("EARLIER SESSIONS", bundle.system_suffix)
        self.assertIn("CASE MEMORY", bundle.system_suffix)

    def test_no_backward_reference_means_no_search(self) -> None:
        with patch.object(recall_mod, "search_past_sessions") as search:
            bundle = build("What are the facts?")
        search.assert_not_called()
        self.assertEqual(bundle.recall_block, "")
        self.assertEqual(bundle.recall_chat_ids, [])

    def test_the_recall_toggle_turns_it_off_without_touching_memory(self) -> None:
        with patch.object(recall_mod, "search_past_sessions") as search:
            bundle = build("Add the ground we discussed", settings=MemorySettings(recall_enabled=False))
        search.assert_not_called()
        self.assertEqual(bundle.recall_block, "")
        self.assertIn("CASE MEMORY", bundle.system_suffix)

    def test_callers_can_opt_out(self) -> None:
        with patch.object(recall_mod, "search_past_sessions") as search:
            build("Add the ground we discussed", load_recall=False)
        search.assert_not_called()

    def test_a_failed_search_keeps_every_other_layer(self) -> None:
        with patch.object(recall_mod, "search_past_sessions", side_effect=RuntimeError("statement timeout")):
            bundle = build("Add the ground we discussed")
        self.assertEqual(bundle.recall_block, "")
        self.assertIn("ADVOCATE STANDING PREFERENCES", bundle.system_suffix)
        self.assertIn("CASE INSTRUCTIONS", bundle.system_suffix)

    def test_recall_alone_counts_as_content(self) -> None:
        with patch.object(recall_mod, "search_past_sessions", return_value=[self.HIT]):
            bundle = build("Add the ground we discussed", prefs=None, instructions=None, sections={})
        self.assertEqual(bundle.system_suffix, "")
        self.assertTrue(bundle.recall_block)
        self.assertIsNone(bundle.skipped_reason)

    def test_learning_mode_never_searches(self) -> None:
        with patch.object(recall_mod, "search_past_sessions") as search:
            bundle = build("Add the ground we discussed", mode="learning")
        search.assert_not_called()
        self.assertEqual(bundle.recall_block, "")

    def test_the_gemma_budget_caps_the_recall_block(self) -> None:
        long_hit = replace(self.HIT, answer="word " * 2_000)
        budget = MemoryBudget.gemma()
        with patch.object(recall_mod, "search_past_sessions", return_value=[long_hit, long_hit, long_hit]):
            bundle = build("Add the ground we discussed", budget=budget)
        self.assertTrue(bundle.recall_block)
        self.assertLessEqual(len(bundle.recall_block), budget.recall)


if __name__ == "__main__":
    unittest.main()
