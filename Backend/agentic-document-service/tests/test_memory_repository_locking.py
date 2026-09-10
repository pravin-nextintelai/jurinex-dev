"""Optimistic locking and case_key isolation, exercised against a fake cursor.

No database: the fake understands only the handful of statements the repository
issues, which is enough to prove the version-token contract and to assert that
every case-scoped statement carries `case_key = %s`.
"""
from __future__ import annotations

import re
import unittest

from app.services.memory import repository
from app.services.memory.repository import VersionConflict
from app.services.memory.validator import ResolvedOp


class FakeCursor:
    """Minimal psycopg-like cursor over dict state."""

    def __init__(self, db: "FakeDB") -> None:
        self.db = db
        self._result: dict | None = None
        self._rows: list[dict] = []
        self.rowcount = 0

    def __enter__(self) -> "FakeCursor":
        return self

    def __exit__(self, *exc) -> None:
        return None

    def execute(self, sql: str, params=None) -> None:
        params = list(params or [])
        self.db.executed.append((" ".join(sql.split()), params))
        self._result = None
        self._rows = []
        text = " ".join(sql.split()).lower()

        if "insert into case_memory_sections" in text:
            key, section = params[0], params[2]
            if (key, section) in self.db.sections:
                self._result = None  # ON CONFLICT DO NOTHING
            else:
                self.db.sections[(key, section)] = 1
                self._result = {"version": 1}
            return

        if "select version from case_memory_sections" in text:
            key, section = params[0], params[1]
            version = self.db.sections.get((key, section))
            self._result = {"version": version} if version is not None else None
            return

        if "update case_memory_sections set version = version + 1" in text:
            key, section = params[0], params[1]
            current = self.db.sections.get((key, section))
            expected = params[2] if len(params) > 2 else None
            if current is None or (expected is not None and int(expected) != current):
                self._result = None
                return
            self.db.sections[(key, section)] = current + 1
            self._result = {"version": current + 1}
            return

        if "select id, ord, tag, text, source_ref from case_memory_lines" in text:
            key, section = params[0], params[1]
            self._rows = [l for l in self.db.lines if l["case_key"] == key and l["section"] == section]
            return

        if "coalesce(max(ord), 0) + 1" in text:
            key, section = params[0], params[1]
            existing = [l for l in self.db.lines if l["case_key"] == key and l["section"] == section]
            self._result = {"next_ord": len(existing) + 1}
            return

        if "insert into case_memory_lines" in text:
            key, section, ord_, tag, body = params[0], params[1], params[2], params[3], params[4]
            new_id = f"line-{len(self.db.lines) + 1}"
            self.db.lines.append(
                {"id": new_id, "case_key": key, "section": section, "ord": ord_, "tag": tag, "text": body}
            )
            self._result = {"id": new_id} if "returning id" in text else None
            return

        if "update case_memory_lines set" in text:
            line_id, key, section = params[-3], params[-2], params[-1]
            for row in self.db.lines:
                if row["id"] == line_id and row["case_key"] == key and row["section"] == section:
                    row["tag"], row["text"] = params[0], params[1]
                    self._result = {"id": line_id}
                    return
            self._result = None
            return

        if "delete from case_memory_lines" in text:
            before = len(self.db.lines)
            if "where id =" in text:
                line_id, key = params[0], params[1]
                self.db.lines = [l for l in self.db.lines if not (l["id"] == line_id and l["case_key"] == key)]
            else:
                key, section = params[0], params[1]
                self.db.lines = [
                    l for l in self.db.lines if not (l["case_key"] == key and l["section"] == section)
                ]
            self.rowcount = before - len(self.db.lines)
            return

        if "select section from case_memory_lines" in text:
            line_id, key = params[0], params[1]
            match = next((l for l in self.db.lines if l["id"] == line_id and l["case_key"] == key), None)
            self._result = {"section": match["section"]} if match else None
            return

        if "delete from case_memory_sections" in text:
            key, section = params[0], params[1]
            self.db.sections.pop((key, section), None)
            return

    def fetchone(self) -> dict | None:
        return self._result

    def fetchall(self) -> list[dict]:
        return self._rows


class FakeConn:
    def __init__(self, db: "FakeDB") -> None:
        self.db = db
        self.commits = 0
        self.rollbacks = 0

    def cursor(self) -> FakeCursor:
        return FakeCursor(self.db)

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rollbacks += 1


class FakeDB:
    def __init__(self) -> None:
        self.sections: dict[tuple[str, str], int] = {}
        self.lines: list[dict] = []
        self.executed: list[tuple[str, list]] = []

    def conn(self) -> FakeConn:
        return FakeConn(self)


def op(kind: str = "append_line", section: str = "facts", text: str = "A fact", **kwargs) -> ResolvedOp:
    return ResolvedOp(op=kind, section=section, text=text, tag=kwargs.pop("tag", "stated"), **kwargs)


class VersionTokenTests(unittest.TestCase):
    def setUp(self) -> None:
        self.db = FakeDB()
        self.conn = self.db.conn()

    def test_first_write_creates_the_section_and_bumps_the_version(self) -> None:
        result = repository.apply_op("case-1", op(text="Custody: judicial since 24-08"), None, conn=self.conn)
        self.assertEqual(result["section"], "facts")
        self.assertEqual(result["version"], 2)  # created at 1, bumped by the write
        self.assertEqual(len(self.db.lines), 1)

    def test_stale_token_raises_with_the_current_content(self) -> None:
        repository.apply_op("case-1", op(text="First fact"), None, conn=self.conn)
        current = self.db.sections[("case-1", "facts")]

        with self.assertRaises(VersionConflict) as ctx:
            repository.apply_op("case-1", op(text="Second fact"), current - 1, conn=self.conn)

        conflict = ctx.exception
        self.assertEqual(conflict.section, "facts")
        self.assertEqual(conflict.expected, current - 1)
        self.assertEqual(conflict.current_version, current)
        self.assertEqual([l["text"] for l in conflict.current_lines], ["First fact"])
        self.assertEqual(len(self.db.lines), 1, "the rejected write must not land")

    def test_matching_token_succeeds_and_bumps(self) -> None:
        repository.apply_op("case-1", op(text="First fact"), None, conn=self.conn)
        current = self.db.sections[("case-1", "facts")]

        result = repository.apply_op("case-1", op(text="Second fact"), current, conn=self.conn)
        self.assertEqual(result["version"], current + 1)
        self.assertEqual(len(self.db.lines), 2)

    def test_conflict_rolls_back(self) -> None:
        repository.apply_op("case-1", op(text="First fact"), None, conn=self.conn)
        rollbacks_before = self.conn.rollbacks
        with self.assertRaises(VersionConflict):
            repository.apply_op("case-1", op(text="Second"), 99, conn=self.conn)
        self.assertEqual(self.conn.rollbacks, rollbacks_before + 1)

    def test_replace_line_updates_in_place(self) -> None:
        repository.apply_op("case-1", op(text="Custody: police"), None, conn=self.conn)
        line_id = self.db.lines[0]["id"]
        version = self.db.sections[("case-1", "facts")]

        repository.apply_op(
            "case-1",
            op(kind="replace_line", text="Custody: judicial", line_id=line_id),
            version,
            conn=self.conn,
        )
        self.assertEqual(len(self.db.lines), 1)
        self.assertEqual(self.db.lines[0]["text"], "Custody: judicial")

    def test_replace_with_empty_text_deletes_the_line(self) -> None:
        repository.apply_op("case-1", op(text="A fact to forget"), None, conn=self.conn)
        line_id = self.db.lines[0]["id"]
        version = self.db.sections[("case-1", "facts")]

        repository.apply_op(
            "case-1", op(kind="replace_line", text="", line_id=line_id), version, conn=self.conn
        )
        self.assertEqual(self.db.lines, [])

    def test_rewrite_section_replaces_every_line(self) -> None:
        repository.apply_op("case-1", op(text="Old one"), None, conn=self.conn)
        version = self.db.sections[("case-1", "facts")]
        rewrite = ResolvedOp(
            op="rewrite_section",
            section="facts",
            lines=[{"tag": "stated", "text": "New one"}, {"tag": "stated", "text": "New two"}],
        )
        repository.apply_op("case-1", rewrite, version, conn=self.conn)
        self.assertEqual([l["text"] for l in self.db.lines], ["New one", "New two"])

    def test_create_section_on_an_existing_section_conflicts(self) -> None:
        repository.apply_op("case-1", op(text="First"), None, conn=self.conn)
        with self.assertRaises(VersionConflict):
            repository.apply_op(
                "case-1",
                ResolvedOp(op="create_section", section="facts", lines=[{"tag": "stated", "text": "x"}]),
                None,
                conn=self.conn,
            )


class IsolationSqlTests(unittest.TestCase):
    """Every case-scoped statement must filter on case_key."""

    CASE_TABLES = ("case_memory_sections", "case_memory_lines")

    def test_every_statement_carries_case_key(self) -> None:
        db = FakeDB()
        conn = db.conn()
        repository.apply_op("case-A", op(text="Fact one"), None, conn=conn)
        version = db.sections[("case-A", "facts")]
        repository.apply_op("case-A", op(text="Fact two"), version, conn=conn)
        repository.delete_line("case-A", db.lines[0]["id"], conn=conn)

        checked = 0
        for sql, params in db.executed:
            lowered = sql.lower()
            if not any(table in lowered for table in self.CASE_TABLES):
                continue
            checked += 1
            if lowered.startswith("insert into"):
                # An insert scopes the row by writing case_key as a column value.
                self.assertIn("case_key", lowered.split("values")[0], f"insert without case_key: {sql}")
            else:
                self.assertTrue(
                    re.search(r"case_key\s*=\s*(%s|any\()", lowered),
                    f"statement without a case_key filter: {sql}",
                )
            self.assertIn("case-A", [str(p) for p in params], f"case_key not bound: {sql}")
        self.assertGreater(checked, 5)

    def test_two_cases_never_see_each_other(self) -> None:
        db = FakeDB()
        conn = db.conn()
        repository.apply_op("case-A", op(text="ALPHA token"), None, conn=conn)
        repository.apply_op("case-B", op(text="BRAVO token"), None, conn=conn)

        cur = conn.cursor()
        cur.execute(
            "SELECT id, ord, tag, text, source_ref FROM case_memory_lines "
            "WHERE case_key = %s AND section = %s ORDER BY ord ASC",
            ("case-A", "facts"),
        )
        texts = [row["text"] for row in cur.fetchall()]
        self.assertEqual(texts, ["ALPHA token"])
        self.assertNotIn("BRAVO token", texts)


class RequireCaseKeyTests(unittest.TestCase):
    def test_empty_case_key_is_refused(self) -> None:
        for value in ("", "   ", None):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    repository._require_case_key(value)  # noqa: SLF001

    def test_apply_op_refuses_an_empty_case_key(self) -> None:
        with self.assertRaises(ValueError):
            repository.apply_op("", op(), None, conn=FakeDB().conn())

    def test_unknown_section_is_refused(self) -> None:
        with self.assertRaises(ValueError):
            repository.apply_op("case-1", op(section="notes"), None, conn=FakeDB().conn())


if __name__ == "__main__":
    unittest.main()
