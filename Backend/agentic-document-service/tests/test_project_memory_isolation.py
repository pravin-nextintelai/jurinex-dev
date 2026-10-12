"""Project memory must not leak across projects.

Two guarantees, tested two ways:

1. Behaviour — a fact written to project A is invisible to project B through every
   read path: the listing, a read by slug, and a delete by slug.
2. Structure — every statement the project store issues carries the
   `folder_name = %s` predicate, bound to the caller's project. A future edit that
   drops the filter from one query fails here even if the behavioural fixture
   happens not to exercise that row.

The fixture is a tiny in-memory stand-in for psycopg: it stores rows as dicts and
answers only the handful of statements the project store issues, matching the
`WHERE user_id = %s AND folder_name = %s` scope literally. That keeps the test
runnable with no Postgres while still exercising the real SQL text.

Run:  .venv/Scripts/python.exe -m unittest tests.test_project_memory_isolation -v
"""
from __future__ import annotations

import re
import unittest
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any

from app.services import memory_service


PROJECT_A = "case-alpha-2026"
PROJECT_B = "case-beta-2026"
USER = "user-1"
OTHER_USER = "user-2"


class _FakeCursor:
    """Answers the project store's statements against a list-of-dicts table."""

    def __init__(self, rows: list[dict[str, Any]], log: list[tuple[str, tuple]]) -> None:
        self._rows = rows
        self._log = log
        self._result: list[dict[str, Any]] = []
        self.rowcount = 0

    # ── psycopg surface ──────────────────────────────────────────────────────
    def __enter__(self) -> "_FakeCursor":
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def fetchone(self) -> dict[str, Any] | None:
        return self._result[0] if self._result else None

    def fetchall(self) -> list[dict[str, Any]]:
        return list(self._result)

    # ── the tiny SQL dialect the project store actually uses ─────────────────
    def execute(self, sql: str, params: Any = ()) -> None:
        params = tuple(params or ())
        self._log.append((sql, params))
        text = " ".join(sql.split())
        self._result = []
        self.rowcount = 0

        if text.startswith("CREATE") or text.startswith("ALTER") or text.startswith("DROP"):
            return

        if text.startswith("INSERT"):
            # An insert carries the scope as column values rather than a predicate.
            user_id, folder_name, topic_key, title, content, kind, description, sensitive = params
            if not folder_name:
                raise AssertionError("project insert with no project")
            row = {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "folder_name": folder_name,
                "topic_key": topic_key,
                "title": title,
                "content": content,
                "origin": "edited",
                "pinned": False,
                "kind": kind,
                "description": description,
                "aliases": [],
                "sensitive": bool(sensitive),
                "sources": ["chat"],
                "version": 1,
                "created_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
            }
            self._rows.append(row)
            self._result = [dict(row)]
            self.rowcount = 1
            return

        if "user_id = %s AND folder_name = %s" not in text:
            raise AssertionError(f"project statement is missing the project scope: {text[:120]}")

        if text.startswith("UPDATE"):
            # SET title, content, description, kind, sensitive ... WHERE uid, folder, id
            title, content, description, kind, sensitive, uid, folder, row_id = params
            for row in self._rows:
                if row["user_id"] == uid and row["folder_name"] == folder and row["id"] == row_id:
                    row.update(
                        title=title,
                        content=content,
                        description=description,
                        kind=kind,
                        sensitive=bool(row["sensitive"]) or bool(sensitive),
                        origin="edited",
                        version=int(row["version"]) + 1,
                        updated_at=datetime.now(timezone.utc),
                    )
                    self._result = [dict(row)]
                    self.rowcount = 1
            return

        uid, folder = params[0], params[1]
        rest = params[2:]

        def in_scope(row: dict[str, Any]) -> bool:
            return row["user_id"] == uid and row["folder_name"] == folder

        if text.startswith("SELECT"):
            rows = [r for r in self._rows if in_scope(r)]
            if "topic_key = %s" in text:
                rows = [r for r in rows if r["topic_key"] == rest[0]]
            rows.sort(key=lambda r: r["updated_at"], reverse=True)
            if " LIMIT 1" in text:
                rows = rows[:1]
            self._result = [dict(r) for r in rows]
            self.rowcount = len(self._result)
            return

        if text.startswith("DELETE"):
            keep = [
                r
                for r in self._rows
                if not (in_scope(r) and r["topic_key"] == rest[0])
            ]
            self.rowcount = len(self._rows) - len(keep)
            self._rows[:] = keep
            return

        raise AssertionError(f"unexpected statement: {text[:120]}")


class _FakeConnection:
    def __init__(self, rows: list[dict[str, Any]], log: list[tuple[str, tuple]]) -> None:
        self._rows = rows
        self._log = log
        self.commits = 0

    def cursor(self) -> _FakeCursor:
        return _FakeCursor(self._rows, self._log)

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        return None


class ProjectMemoryIsolationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.rows: list[dict[str, Any]] = []
        self.sql_log: list[tuple[str, tuple]] = []

        @contextmanager
        def fake_conn():
            yield _FakeConnection(self.rows, self.sql_log)

        patches = {
            "get_db_connection": fake_conn,
            "is_db_available": lambda: True,
            "_ensure_tables": lambda conn: None,
            "get_settings_for_user": lambda uid: {
                "enabled": True,
                "generate_from_chats": True,
                "sensitive_data": False,
            },
        }
        self._saved = {name: getattr(memory_service, name) for name in patches}
        for name, value in patches.items():
            setattr(memory_service, name, value)

    def tearDown(self) -> None:
        for name, value in self._saved.items():
            setattr(memory_service, name, value)

    # ── behaviour ────────────────────────────────────────────────────────────
    def test_a_fact_written_to_one_project_is_invisible_to_the_other(self) -> None:
        memory_service.write_project_memory(
            USER,
            PROJECT_A,
            "client-x-requirements",
            "What the client asked for in this matter",
            "Client wants the appeal filed before the limitation date.",
        )

        listing_a = memory_service.list_project_memory(USER, PROJECT_A)
        self.assertEqual([f["slug"] for f in listing_a], ["client_x_requirements"])

        listing_b = memory_service.list_project_memory(USER, PROJECT_B)
        self.assertEqual(listing_b, [], "project B must not see project A's files")

        blob = " ".join(str(f) for f in listing_b)
        self.assertNotIn("appeal", blob.lower())
        self.assertNotIn("client_x_requirements", blob)

        self.assertIsNone(
            memory_service.read_project_memory(USER, PROJECT_B, "client_x_requirements"),
            "reading project A's slug from project B must return nothing",
        )
        self.assertIsNotNone(
            memory_service.read_project_memory(USER, PROJECT_A, "client_x_requirements")
        )

    def test_listing_never_carries_content(self) -> None:
        memory_service.write_project_memory(
            USER, PROJECT_A, "forum", "Which forum this matter sits in", "Filed in the NCLT."
        )
        entry = memory_service.list_project_memory(USER, PROJECT_A)[0]
        self.assertNotIn("content", entry)
        self.assertEqual(entry["description"], "Which forum this matter sits in")

    def test_delete_from_the_other_project_does_not_remove_the_row(self) -> None:
        memory_service.write_project_memory(
            USER, PROJECT_A, "forum", "Which forum this matter sits in", "Filed in the NCLT."
        )
        self.assertFalse(memory_service.delete_project_memory(USER, PROJECT_B, "forum"))
        self.assertIsNotNone(memory_service.read_project_memory(USER, PROJECT_A, "forum"))
        self.assertTrue(memory_service.delete_project_memory(USER, PROJECT_A, "forum"))
        self.assertIsNone(memory_service.read_project_memory(USER, PROJECT_A, "forum"))

    def test_another_user_cannot_read_the_same_project_key(self) -> None:
        memory_service.write_project_memory(
            USER, PROJECT_A, "forum", "Which forum this matter sits in", "Filed in the NCLT."
        )
        self.assertEqual(memory_service.list_project_memory(OTHER_USER, PROJECT_A), [])
        self.assertIsNone(memory_service.read_project_memory(OTHER_USER, PROJECT_A, "forum"))

    def test_a_write_updates_in_place_and_bumps_the_version(self) -> None:
        first = memory_service.write_project_memory(
            USER, PROJECT_A, "forum", "Forum", "Filed in the NCLT."
        )
        self.assertEqual(first["version"], 1)
        second = memory_service.write_project_memory(
            USER, PROJECT_A, "forum", "Forum", "Moved to the NCLAT on appeal."
        )
        self.assertEqual(second["version"], 2)
        self.assertEqual(len(memory_service.list_project_memory(USER, PROJECT_A)), 1)

    def test_a_stale_expected_version_is_refused(self) -> None:
        memory_service.write_project_memory(USER, PROJECT_A, "forum", "Forum", "Filed in the NCLT.")
        memory_service.write_project_memory(USER, PROJECT_A, "forum", "Forum", "Now the NCLAT.")
        with self.assertRaises(ValueError):
            memory_service.write_project_memory(
                USER, PROJECT_A, "forum", "Forum", "Racing write.", expected_version=1
            )

    # ── the boundary cannot be widened away ──────────────────────────────────
    def test_a_missing_project_raises_instead_of_falling_back_to_global(self) -> None:
        for project in (None, "", "   "):
            with self.assertRaises(ValueError):
                memory_service.list_project_memory(USER, project)
            with self.assertRaises(ValueError):
                memory_service.read_project_memory(USER, project, "forum")
            with self.assertRaises(ValueError):
                memory_service.delete_project_memory(USER, project, "forum")
            with self.assertRaises(ValueError):
                memory_service.write_project_memory(USER, project, "forum", "Forum", "Body.")

    def test_a_path_naming_another_project_is_refused(self) -> None:
        with self.assertRaises(ValueError):
            memory_service.read_memory(
                USER, f"/cases/{PROJECT_A}/areas/forum.md", folder_name=PROJECT_B
            )
        with self.assertRaises(ValueError):
            memory_service.write_memory(
                USER, f"/cases/{PROJECT_A}/areas/forum.md", "Body.", folder_name=PROJECT_B
            )

    # ── structure ────────────────────────────────────────────────────────────
    def test_every_project_statement_filters_on_the_caller_project(self) -> None:
        self.sql_log.clear()
        memory_service.write_project_memory(USER, PROJECT_A, "forum", "Forum", "Filed in the NCLT.")
        memory_service.write_project_memory(USER, PROJECT_A, "forum", "Forum", "Now the NCLAT.")
        memory_service.list_project_memory(USER, PROJECT_A)
        memory_service.read_project_memory(USER, PROJECT_A, "forum")
        memory_service.delete_project_memory(USER, PROJECT_A, "forum")

        checked = 0
        for sql, params in self.sql_log:
            text = " ".join(sql.split())
            if text.startswith(("CREATE", "ALTER", "DROP")):
                continue
            checked += 1
            if text.startswith("INSERT"):
                # An insert has no WHERE; it must still write the project into the row.
                self.assertIn("folder_name", text.split("VALUES")[0])
            else:
                self.assertIn(
                    "user_id = %s AND folder_name = %s",
                    text,
                    f"statement has no project filter: {text[:120]}",
                )
            self.assertIn(
                PROJECT_A,
                params,
                f"project filter is not bound to the caller's project: {text[:120]}",
            )
            # A statement must never reach for the global store while claiming a project.
            self.assertNotIn("folder_name IS NULL", text)
            self.assertNotIn("COALESCE(folder_name", text)
        self.assertGreaterEqual(checked, 5, "the fixture did not exercise the project store")

    def test_the_scope_constant_is_the_one_the_statements_use(self) -> None:
        self.assertEqual(memory_service._PROJECT_SCOPE, "user_id = %s AND folder_name = %s")
        source = re.findall(r"_PROJECT_SCOPE", memory_service.__doc__ or "")
        self.assertEqual(source, [], "sanity: the constant lives in code, not the docstring")


if __name__ == "__main__":
    unittest.main()
