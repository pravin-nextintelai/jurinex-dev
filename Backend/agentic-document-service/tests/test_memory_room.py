"""Making room when a part of a case's memory is full, instead of dropping what comes next."""
from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.services.memory import activity
from app.services.memory import repository as repository_mod
from app.services.memory import room as room_mod
from app.services.memory import same_fact
from app.services.memory import writer as writer_mod
from app.services.memory.schemas import MAX_SECTION_LINES
from tests import test_memory_writer as writer_tests

# One fact, stored twice: the later line says nothing the earlier one does not, so the
# earlier line is what both become and the later one goes.
SUIT_SAVED = "Suit filed on 12/03/2019 by the tenant for possession of the shop"
SUIT_AGAIN = "Suit filed on 12/03/2019 for possession"
# Lines with no date, no identifier and no shared names: never candidates for a merge.
FILLER = "Rent for month {} deposited with the Rent Controller"


def line(text: str, index: int, *, tag: str = "extracted", section: str = "facts", kind: str = "seed") -> dict:
    return {
        "id": f"l-{index}",
        "tag": tag,
        "text": text,
        "section": section,
        "ord": index,
        "created_at": f"2026-01-{index + 1:02d}T09:00:00",
        "source_ref": {"kind": kind, "document": "Plaint.pdf"},
    }


def fillers(count: int, *, start: int = 0) -> list[dict]:
    """Lines nothing can be done with: no date to move, nothing to merge them into."""
    return [line(FILLER.format(index), index) for index in range(start, count)]


def with_a_repeat(count: int = MAX_SECTION_LINES) -> list[dict]:
    """`count` lines, the first two of them the same fact in different words."""
    return [line(SUIT_SAVED, 0), line(SUIT_AGAIN, 1)] + fillers(count, start=2)


def judge_that(same: dict[str, str]):
    """A judge that calls the named lines one fact and nothing else. No model is used."""

    def judge(items):
        out = []
        for text, options in items:
            match = next((option for option in options if same.get(text) == str(option.get("text"))), None)
            out.append(same_fact.Judgement(same_as=match) if match else same_fact.Judgement())
        return out

    return judge


def judge_nothing(items):
    return [same_fact.Judgement() for _ in items]


class Store:
    """A stand-in for the memory tables: sections of lines, each with a version."""

    def __init__(self, sections: dict[str, list[dict]]):
        self.sections = {
            name: {"version": 3, "lines": [dict(item) for item in lines]} for name, lines in sections.items()
        }
        self.writes: list[dict] = []

    def get_sections(self, case_key, names=None, **_kwargs):
        wanted = set(names) if names is not None else set(self.sections)
        return {
            name: {"section": name, "version": data["version"], "lines": [dict(item) for item in data["lines"]]}
            for name, data in self.sections.items()
            if name in wanted
        }

    def _locate(self, line_id):
        for name, data in self.sections.items():
            for item in data["lines"]:
                if str(item.get("id")) == str(line_id):
                    return name, item
        return None, None

    def _drop(self, name, item):
        self.sections[name]["lines"] = [row for row in self.sections[name]["lines"] if row is not item]

    def rewrite_lines(self, case_key, *, updates=(), deletes=(), moves=(), actor=None, folder_name=None, conn=None):
        written = {"updated": 0, "deleted": 0, "moved": 0, "skipped": 0}
        touched: set[str] = set()
        for item in updates:
            name, found = self._locate(item["id"])
            if found is None:
                written["skipped"] += 1
                continue
            found["text"], found["source_ref"] = item["text"], item.get("source_ref") or {}
            written["updated"] += 1
            touched.add(name)
        for item in deletes:
            name, found = self._locate(item["id"])
            if found is None:
                written["skipped"] += 1
                continue
            self._drop(name, found)
            written["deleted"] += 1
            touched.add(name)
        for item in moves:
            name, found = self._locate(item["id"])
            if found is None:
                written["skipped"] += 1
                continue
            self._drop(name, found)
            target = self.sections.setdefault(item["section"], {"version": 1, "lines": []})
            target["lines"].append({**found, "section": item["section"]})
            written["moved"] += 1
            touched.update({name, item["section"]})
        for name in touched:
            self.sections[name]["version"] += 1
        self.writes.append(written)
        return written

    def texts(self, section: str = "facts") -> list[str]:
        return [str(item.get("text") or "") for item in self.sections.get(section, {}).get("lines") or []]


def settings(*, enabled: bool = True, retry_after_s: float = 600.0) -> SimpleNamespace:
    return SimpleNamespace(memory_room_enabled=enabled, memory_room_retry_after_s=retry_after_s)


class MakeRoomTests(unittest.TestCase):
    """app/services/memory/room.py: what a blocked write does about a full section."""

    def setUp(self) -> None:
        room_mod.forget_attempts()

    def make_room(self, store: Store, *, judge=None, **flags):
        with patch.object(room_mod, "get_settings", return_value=settings(**flags)), patch.object(
            repository_mod, "get_sections", side_effect=store.get_sections
        ), patch.object(repository_mod, "rewrite_lines", side_effect=store.rewrite_lines):
            return room_mod.make_room("512", section="facts", judge_fn=judge or judge_nothing)

    def test_a_fact_held_twice_becomes_one_line_and_frees_room(self) -> None:
        store = Store({"facts": with_a_repeat()})
        result = self.make_room(store, judge=judge_that({SUIT_AGAIN: SUIT_SAVED}))
        self.assertTrue(result.changed)
        self.assertEqual(result.lines_freed, 1)
        self.assertEqual(len(store.texts()), MAX_SECTION_LINES - 1)
        self.assertNotIn(SUIT_AGAIN, store.texts())
        # What was combined is reported in the shape the Activity tab reads.
        self.assertEqual(result.described["merged"][0]["from"], [SUIT_SAVED, SUIT_AGAIN])
        # The section the caller must re-read comes back as it now stands.
        self.assertEqual(result.sections["facts"]["version"], 4)
        self.assertEqual(len(result.sections["facts"]["lines"]), MAX_SECTION_LINES - 1)

    def test_a_dated_fact_read_from_an_answer_moves_to_dates_and_frees_a_line(self) -> None:
        store = Store({"facts": [line(SUIT_SAVED, 0, kind="answer"), *fillers(MAX_SECTION_LINES, start=1)]})
        result = self.make_room(store)
        self.assertEqual(result.lines_freed, 1)
        self.assertEqual(result.described["moved"], [{"text": SUIT_SAVED, "from": "facts", "to": "dates"}])
        self.assertEqual(store.texts("dates"), [SUIT_SAVED])
        self.assertNotIn(SUIT_SAVED, store.texts())

    def test_a_section_that_cannot_be_shortened_changes_nothing(self) -> None:
        store = Store({"facts": fillers(MAX_SECTION_LINES)})
        result = self.make_room(store)
        self.assertEqual((result.changed, result.error), (False, "nothing_to_merge"))
        self.assertEqual(store.writes, [])
        self.assertEqual(len(store.texts()), MAX_SECTION_LINES)

    def test_the_same_question_is_not_asked_twice(self) -> None:
        store = Store({"facts": fillers(MAX_SECTION_LINES)})
        self.assertEqual(self.make_room(store).error, "nothing_to_merge")
        asked = []
        self.make_room(store, judge=lambda items: asked.append(items) or judge_nothing(items))
        self.assertEqual(asked, [])  # nothing has changed since, so the plan is not made again

    def test_a_section_that_changed_since_is_asked_again(self) -> None:
        store = Store({"facts": with_a_repeat()})
        self.assertEqual(self.make_room(store).error, "nothing_to_merge")
        store.sections["facts"]["version"] = 9  # the advocate deleted a line meanwhile
        result = self.make_room(store, judge=judge_that({SUIT_AGAIN: SUIT_SAVED}))
        self.assertEqual(result.lines_freed, 1)

    def test_an_outage_is_left_alone_and_then_tried_again(self) -> None:
        store = Store({"facts": with_a_repeat()})

        def broken(_items):
            raise RuntimeError("no model")

        self.assertEqual(self.make_room(store, judge=broken).error, "unavailable")
        self.assertEqual(self.make_room(store, judge=broken).error, "asked_already")
        with patch.object(room_mod, "retry_after_s", return_value=0.0):
            self.assertEqual(self.make_room(store, judge=broken).error, "unavailable")

    def test_nothing_is_tidied_while_the_feature_is_off(self) -> None:
        store = Store({"facts": with_a_repeat()})
        result = self.make_room(store, judge=judge_that({SUIT_AGAIN: SUIT_SAVED}), enabled=False)
        self.assertEqual((result.changed, result.error), (False, "disabled"))
        self.assertEqual(len(store.texts()), MAX_SECTION_LINES)

    def test_a_database_that_cannot_be_read_never_raises(self) -> None:
        with patch.object(room_mod, "get_settings", return_value=settings()), patch.object(
            repository_mod, "get_sections", side_effect=RuntimeError("down")
        ):
            result = room_mod.make_room("512", section="facts")
        self.assertEqual((result.changed, result.error), (False, "unavailable"))

    def test_a_plan_whose_lines_all_changed_writes_nothing(self) -> None:
        store = Store({"facts": with_a_repeat()})
        with patch.object(room_mod, "get_settings", return_value=settings()), patch.object(
            repository_mod, "get_sections", side_effect=store.get_sections
        ), patch.object(
            repository_mod,
            "rewrite_lines",
            return_value={"updated": 0, "deleted": 0, "moved": 0, "skipped": 2},
        ):
            result = room_mod.make_room("512", section="facts", judge_fn=judge_that({SUIT_AGAIN: SUIT_SAVED}))
        self.assertEqual((result.changed, result.error), (False, "nothing_written"))

    def test_an_attempt_is_remembered_per_case(self) -> None:
        room_mod._remember_attempt("512", "facts", 3, "nothing_to_merge")
        room_mod.forget_attempts("999")
        self.assertTrue(room_mod._asked_already("512", "facts", 3))
        room_mod.forget_attempts("512")
        self.assertFalse(room_mod._asked_already("512", "facts", 3))


class WriterRoomTests(unittest.TestCase):
    """app/services/memory/writer.py: a fact that finds no room is not simply dropped."""

    def setUp(self) -> None:
        room_mod.forget_attempts()

    def write(self, store: Store, *, ops=None, same_judge=None, over_cap=None):
        extraction = writer_tests.Extraction(
            ops=ops if ops is not None else [writer_tests.op(writer_tests.MEDICAL_LINE)]
        )
        with writer_tests.harness(extraction=extraction, same_judge=same_judge or judge_nothing) as mocks, patch.object(
            repository_mod, "rewrite_lines", side_effect=store.rewrite_lines
        ), patch.object(room_mod, "get_settings", return_value=settings()):
            mocks["get_sections"].side_effect = store.get_sections
            if over_cap is not None:
                with patch.object(writer_mod, "case_over_cap", side_effect=over_cap):
                    report = writer_mod.run_post_turn(writer_tests.turn(writer_tests.HEART), today=writer_tests.TODAY)
            else:
                report = writer_mod.run_post_turn(writer_tests.turn(writer_tests.HEART), today=writer_tests.TODAY)
        return report

    def test_a_full_section_is_tidied_and_the_fact_is_written(self) -> None:
        store = Store({"facts": with_a_repeat()})
        report = self.write(store, same_judge=judge_that({SUIT_AGAIN: SUIT_SAVED}))
        self.assertEqual(report.writes, 1)
        self.assertNotIn("section_full", report.rejection_codes)
        self.assertEqual(report.details["lines"][0]["text"], writer_tests.MEDICAL_LINE)
        # The advocate reads what was combined to make the room, beside the fact saved.
        self.assertEqual(report.details["merged"][0]["from"], [SUIT_SAVED, SUIT_AGAIN])

    def test_a_section_that_cannot_be_shortened_says_so(self) -> None:
        store = Store({"facts": fillers(MAX_SECTION_LINES)})
        report = self.write(store)
        self.assertEqual(report.writes, 0)
        self.assertEqual(report.rejection_codes, ["section_full"])
        self.assertNotIn("merged", report.details)

    def test_room_is_asked_for_once_a_turn(self) -> None:
        store = Store({"facts": fillers(MAX_SECTION_LINES)})
        ops = [writer_tests.op(writer_tests.MEDICAL_LINE), writer_tests.op("Sunil Pawar is the client")]
        with patch.object(room_mod, "make_room", side_effect=room_mod.make_room) as asked:
            report = self.write(store, ops=ops)
        self.assertEqual(asked.call_count, 1)
        self.assertEqual(report.rejection_codes.count("section_full"), 2)

    def test_a_case_at_its_character_cap_is_tidied_as_a_whole(self) -> None:
        store = Store({"facts": with_a_repeat(10)})
        # Over the cap until the tidy has shortened the case.
        report = self.write(
            store,
            same_judge=judge_that({SUIT_AGAIN: SUIT_SAVED}),
            over_cap=lambda _sections: not store.writes,
        )
        self.assertEqual(report.writes, 1)
        self.assertNotIn("case_full", report.rejection_codes)
        self.assertEqual(report.details["merged"][0]["from"], [SUIT_SAVED, SUIT_AGAIN])

    def test_a_case_that_stays_over_its_cap_keeps_the_reason(self) -> None:
        store = Store({"facts": fillers(10)})
        report = self.write(store, over_cap=lambda _sections: True)
        self.assertEqual(report.writes, 0)
        self.assertEqual(report.rejection_codes, ["case_full"])


class ActivityTests(unittest.TestCase):
    def test_a_full_section_reads_as_something_the_advocate_can_act_on(self) -> None:
        entry = activity.describe(
            {"id": "t1", "mode": "chat", "created_at": None, "details": {"rejection_codes": ["section_full"]}}
        )
        self.assertIn("delete a line", entry["reasons"][0])
        self.assertNotEqual(entry["reasons"][0], activity.GENERIC_REJECTION)


if __name__ == "__main__":
    unittest.main()
