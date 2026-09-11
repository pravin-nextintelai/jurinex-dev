"""Bulk writes used by seeding and import: one version bump, section caps, isolation."""
from __future__ import annotations

import unittest

from app.services.memory import repository
from app.services.memory.schemas import MAX_SECTION_LINES, MAX_SUMMARY_LINES
from tests.test_memory_repository_locking import FakeConn, FakeCursor, FakeDB


class BulkCursor(FakeCursor):
    """The locking tests' fake, plus the whole-case deletes a replace issues."""

    _WHOLE_CASE_DELETES = (
        "delete from case_memory_lines where case_key = %s",
        "delete from case_memory_sections where case_key = %s",
    )

    def execute(self, sql: str, params=None) -> None:
        flat = " ".join(sql.split())
        values = list(params or [])
        if len(values) == 1 and flat.lower() in self._WHOLE_CASE_DELETES:
            self.db.executed.append((flat, values))
            self._result, self._rows = None, []
            key = values[0]
            if "case_memory_lines" in flat.lower():
                before = len(self.db.lines)
                self.db.lines = [line for line in self.db.lines if line["case_key"] != key]
                self.rowcount = before - len(self.db.lines)
            else:
                doomed = [pair for pair in self.db.sections if pair[0] == key]
                for pair in doomed:
                    self.db.sections.pop(pair)
                self.rowcount = len(doomed)
            return
        super().execute(sql, params)


class BulkConn(FakeConn):
    def cursor(self) -> BulkCursor:
        return BulkCursor(self.db)


def stored_lines(db: FakeDB, key: str, section: str, count: int, *, version: int = 1) -> None:
    db.sections[(key, section)] = version
    for i in range(count):
        db.lines.append(
            {
                "id": f"{key}-{section}-{i}",
                "case_key": key,
                "section": section,
                "ord": i + 1,
                "tag": "stated",
                "text": f"existing {i}",
            }
        )


def lines(*texts: str, tag: str = "stated") -> list[dict]:
    return [{"tag": tag, "text": text, "source_ref": {"kind": "seed", "source": f"s:{text}"}} for text in texts]


class AppendLinesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.db = FakeDB()
        self.conn = BulkConn(self.db)

    def test_many_lines_cost_one_version_bump(self) -> None:
        result = repository.append_lines("case-1", "facts", lines("One", "Two", "Three"), conn=self.conn)
        self.assertEqual(result, {"section": "facts", "version": 2, "added": 3})
        self.assertEqual(self.db.sections[("case-1", "facts")], 2)
        self.assertEqual([line["text"] for line in self.db.lines], ["One", "Two", "Three"])
        self.assertEqual([line["ord"] for line in self.db.lines], [1, 2, 3])
        self.assertEqual(self.conn.commits, 1)

    def test_new_lines_follow_the_existing_ones(self) -> None:
        stored_lines(self.db, "case-1", "facts", 2, version=4)
        repository.append_lines("case-1", "facts", lines("Third"), conn=self.conn)
        third = next(line for line in self.db.lines if line["text"] == "Third")
        self.assertEqual(third["ord"], 3)
        self.assertEqual(self.db.sections[("case-1", "facts")], 5)

    def test_only_the_room_left_in_a_section_is_used(self) -> None:
        stored_lines(self.db, "case-1", "summary", MAX_SUMMARY_LINES - 2)
        result = repository.append_lines("case-1", "summary", lines("A", "B", "C", "D"), conn=self.conn)
        self.assertEqual(result["added"], 2)
        summary = [line["text"] for line in self.db.lines if line["section"] == "summary"]
        self.assertEqual(len(summary), MAX_SUMMARY_LINES)
        self.assertNotIn("C", summary)

    def test_a_full_section_is_left_untouched(self) -> None:
        stored_lines(self.db, "case-1", "facts", MAX_SECTION_LINES, version=9)
        result = repository.append_lines("case-1", "facts", lines("Overflow"), conn=self.conn)
        self.assertEqual(result, {"section": "facts", "version": 9, "added": 0})
        self.assertEqual(self.db.sections[("case-1", "facts")], 9)
        self.assertEqual(self.conn.commits, 0)
        self.assertEqual(self.conn.rollbacks, 1)

    def test_an_empty_batch_touches_nothing(self) -> None:
        result = repository.append_lines("case-1", "facts", [{"tag": "stated", "text": "   "}], conn=self.conn)
        self.assertEqual(result["added"], 0)
        self.assertEqual(self.db.executed, [])

    def test_provenance_is_written_with_each_line(self) -> None:
        repository.append_lines("case-1", "dates", lines("Next hearing: 2026-10-14"), conn=self.conn)
        inserts = [params for sql, params in self.db.executed if sql.lower().startswith("insert into case_memory_lines")]
        self.assertEqual(len(inserts), 1)
        self.assertIn('"kind": "seed"', inserts[0][5])

    def test_an_unknown_section_or_empty_key_is_refused(self) -> None:
        with self.assertRaises(ValueError):
            repository.append_lines("case-1", "notes", lines("x"), conn=self.conn)
        with self.assertRaises(ValueError):
            repository.append_lines("", "facts", lines("x"), conn=self.conn)


class ReplaceCaseMemoryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.db = FakeDB()
        self.conn = BulkConn(self.db)
        stored_lines(self.db, "case-A", "facts", 3, version=7)
        stored_lines(self.db, "case-A", "parties", 2, version=3)
        stored_lines(self.db, "case-B", "facts", 2, version=5)

    def test_replacing_swaps_only_this_cases_memory(self) -> None:
        written = repository.replace_case_memory(
            "case-A", {"facts": lines("New fact"), "dates": lines("Hearing 14 Oct")}, conn=self.conn
        )
        self.assertEqual(written, {"facts": 1, "dates": 1})
        case_a = sorted((line["section"], line["text"]) for line in self.db.lines if line["case_key"] == "case-A")
        self.assertEqual(case_a, [("dates", "Hearing 14 Oct"), ("facts", "New fact")])
        self.assertNotIn(("case-A", "parties"), self.db.sections)
        self.assertEqual(
            [line["text"] for line in self.db.lines if line["case_key"] == "case-B"],
            ["existing 0", "existing 1"],
        )
        self.assertEqual(self.db.sections[("case-B", "facts")], 5)
        self.assertEqual(self.conn.commits, 1)

    def test_replaced_sections_start_from_a_fresh_version(self) -> None:
        repository.replace_case_memory("case-A", {"facts": lines("New fact")}, conn=self.conn)
        self.assertEqual(self.db.sections[("case-A", "facts")], 1)

    def test_unknown_sections_in_the_payload_are_ignored(self) -> None:
        written = repository.replace_case_memory("case-A", {"gossip": lines("x")}, conn=self.conn)
        self.assertEqual(written, {})
        self.assertFalse(any(line["case_key"] == "case-A" for line in self.db.lines))


class BulkIsolationTests(unittest.TestCase):
    def test_every_bulk_statement_is_scoped_to_the_case(self) -> None:
        db = FakeDB()
        conn = BulkConn(db)
        stored_lines(db, "case-B", "facts", 1)
        repository.append_lines("case-A", "dates", lines("Hearing"), conn=conn)
        repository.replace_case_memory("case-A", {"facts": lines("New fact")}, conn=conn)

        checked = 0
        for sql, params in db.executed:
            lowered = sql.lower()
            if "case_memory_" not in lowered:
                continue
            checked += 1
            if lowered.startswith("insert into"):
                self.assertIn("case_key", lowered.split("values")[0], f"insert without case_key: {sql}")
            else:
                self.assertRegex(lowered, r"case_key\s*=\s*%s", f"statement without a case_key filter: {sql}")
            self.assertIn("case-A", [str(p) for p in params], f"case_key not bound: {sql}")
            self.assertNotIn("case-B", [str(p) for p in params])
        self.assertGreater(checked, 5)
        self.assertEqual([line["text"] for line in db.lines if line["case_key"] == "case-B"], ["existing 0"])


if __name__ == "__main__":
    unittest.main()
