"""Folding what JuriNex remembers about the advocate into fewer, sharper lines."""
from __future__ import annotations

import contextlib
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.services.memory import consolidate as cons
from app.services.memory.schemas import MAX_ADVOCATE_CHARS, MAX_ADVOCATE_LINES

NOTES = [
    {"category": "practice", "text": "Mostly appears before the Aurangabad Bench"},
    {"category": "practice", "text": "Files land acquisition matters at Aurangabad"},
    {"category": "practice", "text": "Practises mainly in land acquisition"},
    {"category": "clients", "text": "Usually acts for borrowers, not banks"},
]

MERGED = [
    {"category": "practice", "text": "Appears before the Aurangabad Bench, mainly in land acquisition matters"},
    {"category": "clients", "text": "Usually acts for borrowers, not banks"},
]


def _settings(**overrides):
    values = {
        "advocate_consolidate_enabled": True,
        "advocate_consolidate_at": 0.8,
        "advocate_consolidate_model": "gemini-3.8-flash",
        "advocate_consolidate_min_interval_s": 3600.0,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class SettingsCase(unittest.TestCase):
    settings = _settings()

    def setUp(self):
        stack = contextlib.ExitStack()
        stack.enter_context(patch.object(cons, "get_settings", side_effect=lambda: self.settings))
        self.addCleanup(stack.close)


def full_set(count=MAX_ADVOCATE_LINES):
    return [{"category": "background", "text": f"Fact number {n} about the advocate"} for n in range(count)]


class TriggerTests(SettingsCase):
    def test_a_small_set_is_left_alone(self):
        self.assertFalse(cons.should_consolidate(NOTES[:2]))
        self.assertFalse(cons.should_consolidate(NOTES))

    def test_a_set_near_its_line_cap_is_worth_merging(self):
        self.assertTrue(cons.should_consolidate(full_set(int(MAX_ADVOCATE_LINES * 0.85))))

    def test_a_set_near_its_character_cap_is_worth_merging(self):
        lines = [{"category": "background", "text": "x" * 290} for _ in range(9)]
        self.assertGreaterEqual(cons.fullness(lines), 0.8)
        self.assertTrue(cons.should_consolidate(lines))

    def test_switched_off_means_never(self):
        self.settings = _settings(advocate_consolidate_enabled=False)
        self.assertFalse(cons.should_consolidate(full_set()))

    def test_the_trigger_point_is_configurable_and_bounded(self):
        self.settings = _settings(advocate_consolidate_at=0.1)
        self.assertEqual(cons.trigger_fraction(), 0.5)
        self.settings = _settings(advocate_consolidate_at="nonsense")
        self.assertEqual(cons.trigger_fraction(), 0.8)


class ParseTests(SettingsCase):
    def test_json_plain_and_fenced_are_both_read(self):
        payload = '```json\n{"lines": [{"category": "practice", "text": "- Files at Aurangabad"}]}\n```'
        self.assertEqual(cons.parse_lines(payload), [{"category": "practice", "text": "Files at Aurangabad"}])

    def test_unknown_categories_and_blanks_are_dropped(self):
        payload = '{"lines": [{"category": "hobbies", "text": "Chess"}, {"category": "clients", "text": "Acts for borrowers"}]}'
        self.assertEqual(cons.parse_lines(payload), [{"category": "clients", "text": "Acts for borrowers"}])

    def test_nothing_usable_raises(self):
        for bad in ("", "not json", '{"lines": []}', '{"lines": [{"category": "hobbies", "text": "Chess"}]}'):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                cons.parse_lines(bad)


class CheckTests(SettingsCase):
    """The merge is only trusted when it says nothing new and breaks no rule."""

    def test_a_faithful_merge_passes(self):
        self.assertIsNone(cons.check_merged(MERGED, NOTES))

    def test_a_merge_that_is_not_shorter_is_refused(self):
        self.assertEqual(cons.check_merged(NOTES, NOTES), "not_shorter")

    def test_an_invented_fact_is_refused(self):
        invented = [{"category": "practice", "text": "Also handles income tax appeals before the Tribunal"}]
        self.assertEqual(cons.check_merged(invented, NOTES), "line_not_in_the_notes")

    def test_a_case_detail_smuggled_into_the_merge_is_refused(self):
        sneaky = [{"category": "practice", "text": "Appears at Aurangabad in WP 1234/2024 land matters"}]
        self.assertEqual(cons.check_merged(sneaky, NOTES), "line_case_data_case_number")

    def test_a_party_name_is_refused(self):
        notes = [*NOTES, {"category": "clients", "text": "Acts for co-operative societies"}]
        merged = [{"category": "clients", "text": "Acts for Pawar co-operative societies"}]
        self.assertEqual(cons.check_merged(merged, notes, party_names=("Sunil Pawar",)), "line_universal_party_name")

    def test_a_merge_over_the_caps_is_refused(self):
        long_notes = [{"category": "background", "text": "x" * 290} for _ in range(12)]
        too_long = [{"category": "background", "text": "y" * 290} for _ in range(MAX_ADVOCATE_CHARS // 290 + 1)]
        self.assertIn(cons.check_merged(too_long, long_notes), {"too_long", "not_shorter"})

    def test_an_empty_merge_is_refused(self):
        self.assertEqual(cons.check_merged([], NOTES), "empty")


class PlanTests(SettingsCase):
    def ask(self, **kwargs):
        return patch.object(cons, "_ask_model", **kwargs)

    def test_a_good_merge_comes_back_ready_to_write(self):
        with self.ask(return_value=(MERGED, "gemini-3.8-flash")):
            result = cons.plan(NOTES)
        self.assertTrue(result.changed)
        self.assertEqual((len(result.before), len(result.after)), (4, 2))
        self.assertLess(result.chars_after, result.chars_before)
        self.assertEqual(result.as_dict()["lines_after"], 2)

    def test_an_unavailable_model_changes_nothing(self):
        with self.ask(side_effect=RuntimeError("quota")):
            result = cons.plan(NOTES)
        self.assertEqual(result.error, "unavailable")
        self.assertFalse(result.changed)

    def test_a_merge_that_breaks_a_rule_changes_nothing(self):
        bad = [{"category": "practice", "text": "Also appears in the Supreme Court every Monday"}]
        with self.ask(return_value=(bad, "gemini-3.8-flash")):
            result = cons.plan(NOTES)
        self.assertEqual(result.error, "line_not_in_the_notes")
        self.assertEqual(result.after, [])

    def test_too_few_notes_never_reach_the_model(self):
        with self.ask(side_effect=AssertionError("should not be called")):
            result = cons.plan(NOTES[:2])
        self.assertEqual(result.error, "too_few")

    def test_the_request_gives_the_notes_oldest_first_with_categories(self):
        request = cons.build_request(NOTES)
        self.assertIn("[practice] Mostly appears before the Aurangabad Bench", request)
        self.assertLess(request.index("Mostly appears"), request.index("Usually acts"))


if __name__ == "__main__":
    unittest.main()
