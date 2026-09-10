from __future__ import annotations

import unittest
from datetime import date

from app.services.memory.schemas import MAX_LINE_CHARS, MemoryLine, MemoryOp
from app.services.memory.validator import (
    DEDUPE_NEAR,
    find_duplicate,
    merge_with_history,
    normalize_for_compare,
    validate_ops,
)


def line(text: str, **kwargs) -> MemoryLine:
    return MemoryLine(tag=kwargs.pop("tag", "stated"), text=text, **kwargs)


def append(section: str, text: str, **kwargs) -> MemoryOp:
    return MemoryOp(op="append_line", section=section, line=line(text, **kwargs))


class NormalizeTests(unittest.TestCase):
    def test_tag_prefix_punctuation_and_case_are_ignored(self) -> None:
        self.assertEqual(
            normalize_for_compare("[stated] Accused: Sunil Pawar, 47."),
            normalize_for_compare("accused sunil pawar 47"),
        )


class FindDuplicateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.existing = [
            {"id": "a", "text": "Accused Sunil Pawar, 47, arrested 22-08-2026"},
            {"id": "b", "text": "FIR No. 214/2026, Cidco PS"},
        ]

    def test_near_duplicate_is_found(self) -> None:
        hit = find_duplicate("Accused Sunil Pawar, 47, arrested on 22-08-2026", self.existing)
        self.assertIsNotNone(hit)
        self.assertEqual(hit["id"], "a")
        self.assertGreaterEqual(hit["_ratio"], DEDUPE_NEAR)

    def test_unrelated_text_is_not_a_duplicate(self) -> None:
        self.assertIsNone(find_duplicate("Next hearing listed 14 October 2026", self.existing))

    def test_empty_text_matches_nothing(self) -> None:
        self.assertIsNone(find_duplicate("   ", self.existing))


class MergeHistoryTests(unittest.TestCase):
    def test_previous_fact_is_kept_in_line(self) -> None:
        merged = merge_with_history(
            "Custody: judicial, since 24-08-2026",
            "Custody: police custody 22-08 to 24-08",
            today=date(2026, 9, 10),
        )
        self.assertIn("Custody: judicial, since 24-08-2026", merged)
        self.assertIn("earlier:", merged)
        self.assertIn("2026-09-10", merged)
        self.assertLessEqual(len(merged), MAX_LINE_CHARS)

    def test_merge_never_exceeds_the_line_cap(self) -> None:
        merged = merge_with_history("y" * 250, "x" * 250, today=date(2026, 9, 10))
        self.assertLessEqual(len(merged), MAX_LINE_CHARS)

    def test_no_previous_text_returns_the_new_text(self) -> None:
        self.assertEqual(merge_with_history("New fact", "", today=date(2026, 9, 10)), "New fact")


class ValidateOpsDedupeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.existing = {
            "facts": [
                {"id": "line-1", "text": "Accused Sunil Pawar, 47, arrested 22-08-2026", "tag": "stated"},
            ]
        }

    def test_near_duplicate_append_becomes_a_replace(self) -> None:
        resolved, rejections = validate_ops(
            [append("facts", "Accused Sunil Pawar, 47, arrested on 22-08-2026", changed=True)],
            self.existing,
        )
        self.assertEqual(rejections, [])
        self.assertEqual(len(resolved), 1)
        self.assertEqual(resolved[0].op, "replace_line")
        self.assertEqual(resolved[0].line_id, "line-1")

    def test_identical_fact_is_dropped(self) -> None:
        resolved, rejections = validate_ops(
            [append("facts", "Accused Sunil Pawar, 47, arrested 22-08-2026")],
            self.existing,
        )
        self.assertEqual(resolved, [])
        self.assertEqual([r.code for r in rejections], ["duplicate"])

    def test_changed_fact_keeps_the_earlier_value_in_line(self) -> None:
        resolved, _ = validate_ops(
            [
                MemoryOp(
                    op="replace_line",
                    section="facts",
                    match_text="Accused Sunil Pawar, 47, arrested 22-08-2026",
                    line=line("Accused Sunil Pawar, 48, arrested 22-08-2026", changed=True),
                )
            ],
            self.existing,
            today=date(2026, 9, 10),
        )
        self.assertEqual(len(resolved), 1)
        self.assertIn("earlier:", resolved[0].text)

    def test_new_fact_is_appended(self) -> None:
        resolved, rejections = validate_ops(
            [append("facts", "Custody: judicial, since 24-08-2026")],
            self.existing,
        )
        self.assertEqual(rejections, [])
        self.assertEqual(len(resolved), 1)
        self.assertEqual(resolved[0].op, "append_line")

    def test_two_identical_appends_in_one_turn_write_once(self) -> None:
        text = "Next hearing listed 14 October 2026"
        resolved, rejections = validate_ops(
            [append("dates", text), append("dates", text)],
            {"dates": []},
        )
        self.assertEqual(len(resolved), 1)
        self.assertEqual([r.code for r in rejections], ["duplicate"])

    def test_pipeline_may_not_delete_a_section(self) -> None:
        resolved, rejections = validate_ops(
            [MemoryOp(op="delete_section", section="facts")], self.existing
        )
        self.assertEqual(resolved, [])
        self.assertEqual([r.code for r in rejections], ["delete_not_allowed"])

    def test_sensitive_line_is_dropped_when_disallowed(self) -> None:
        resolved, rejections = validate_ops(
            [append("facts", "Applicant has a cardiac condition", sensitive=True)],
            {"facts": []},
            allow_sensitive=False,
        )
        self.assertEqual(resolved, [])
        self.assertEqual([r.code for r in rejections], ["sensitive_disabled"])

    def test_sensitive_line_is_kept_when_allowed(self) -> None:
        resolved, rejections = validate_ops(
            [append("facts", "Applicant has a cardiac condition", sensitive=True)],
            {"facts": []},
            allow_sensitive=True,
        )
        self.assertEqual(rejections, [])
        self.assertEqual(len(resolved), 1)
        self.assertTrue(resolved[0].sensitive)

    def test_section_line_cap_is_enforced(self) -> None:
        full = {"facts": [{"id": f"l{i}", "text": f"Distinct fact number {i}"} for i in range(60)]}
        resolved, rejections = validate_ops([append("facts", "A brand new unrelated fact")], full)
        self.assertEqual(resolved, [])
        self.assertEqual([r.code for r in rejections], ["section_full"])

    def test_invalid_lines_are_rejected_without_stopping_valid_ones(self) -> None:
        resolved, rejections = validate_ops(
            [
                append("facts", "The complaint is probably retaliatory"),
                append("facts", "Custody: judicial, since 24-08-2026"),
            ],
            {"facts": []},
        )
        self.assertEqual(len(resolved), 1)
        self.assertEqual([r.code for r in rejections], ["inference_language"])


if __name__ == "__main__":
    unittest.main()
