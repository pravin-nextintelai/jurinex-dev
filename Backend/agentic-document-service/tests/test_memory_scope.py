from __future__ import annotations

import unittest
from unittest.mock import patch

from app.services.memory import scope as scope_mod
from app.services.memory.scope import CaseScope, is_real_user, resolve_case_scope, verified_user_id


class FakeCursor:
    def __init__(self, folder_row, assignment_row=None) -> None:
        self.folder_row = folder_row
        self.assignment_row = assignment_row
        self._result = None
        self.queries: list[str] = []

    def __enter__(self) -> "FakeCursor":
        return self

    def __exit__(self, *exc) -> None:
        return None

    def execute(self, sql, params=None) -> None:
        flat = " ".join(sql.split()).lower()
        self.queries.append(flat)
        if "from user_files uf" in flat:
            self._result = self.folder_row
        elif "case_assignments" in flat:
            self._result = self.assignment_row
        else:
            self._result = None

    def fetchone(self):
        return self._result


class FakeConn:
    def __init__(self, cursor: FakeCursor) -> None:
        self._cursor = cursor

    def __enter__(self) -> "FakeConn":
        return self

    def __exit__(self, *exc) -> None:
        return None

    def cursor(self) -> FakeCursor:
        return self._cursor


def patched(folder_row, *, firm=None, accessible=None, assignment_row=None):
    """Patch the DB and access-context lookups scope.py depends on."""
    cursor = FakeCursor(folder_row, assignment_row)
    return (
        patch.object(scope_mod, "is_db_available", return_value=True),
        patch.object(scope_mod, "get_db_connection", lambda: FakeConn(cursor)),
        patch.object(scope_mod, "_access_context", lambda uid: (accessible or [uid], firm or {})),
        patch.object(scope_mod, "_adopt_orphaned_keys", lambda *a, **k: None),
        cursor,
    )


class UserIdTests(unittest.TestCase):
    def test_anonymous_and_non_numeric_ids_are_refused(self) -> None:
        for value in ("anonymous", "", None, "abc", "user-7"):
            with self.subTest(value=value):
                self.assertFalse(is_real_user(value))

    def test_numeric_id_is_accepted(self) -> None:
        self.assertTrue(is_real_user("42"))


class VerifiedUserIdTests(unittest.TestCase):
    def test_verified_token_beats_a_spoofed_header(self) -> None:
        import jwt as pyjwt

        token = pyjwt.encode({"id": 7}, "s3cret", algorithm="HS256")
        with patch.object(scope_mod, "get_settings", lambda: type("S", (), {"jwt_secret": "s3cret"})()):
            self.assertEqual(verified_user_id("999", f"Bearer {token}"), "7")

    def test_header_is_used_when_no_token_is_sent(self) -> None:
        with patch.object(scope_mod, "get_settings", lambda: type("S", (), {"jwt_secret": "s3cret"})()):
            self.assertEqual(verified_user_id("42", None), "42")

    def test_invalid_token_falls_back_to_the_header(self) -> None:
        with patch.object(scope_mod, "get_settings", lambda: type("S", (), {"jwt_secret": "s3cret"})()):
            self.assertEqual(verified_user_id("42", "Bearer not.a.token"), "42")

    def test_nothing_at_all_yields_none(self) -> None:
        with patch.object(scope_mod, "get_settings", lambda: type("S", (), {"jwt_secret": "s3cret"})()):
            self.assertIsNone(verified_user_id(None, None))


class CaseKeyPrecedenceTests(unittest.TestCase):
    def test_case_id_wins_when_a_case_row_exists(self) -> None:
        row = {"folder_id": "f-1", "folder_name": "State v Pawar", "case_id": "512"}
        p1, p2, p3, p4, _ = patched(row)
        with p1, p2, p3, p4:
            resolved = resolve_case_scope("State v Pawar", "42")
        self.assertIsInstance(resolved, CaseScope)
        self.assertEqual(resolved.case_key, "512")
        self.assertEqual(resolved.case_id, "512")
        self.assertFalse(resolved.is_intake)

    def test_folder_uuid_is_used_when_there_is_no_case_row(self) -> None:
        row = {"folder_id": "f-9", "folder_name": "Storage box", "case_id": None}
        p1, p2, p3, p4, _ = patched(row)
        with p1, p2, p3, p4:
            resolved = resolve_case_scope("Storage box", "42")
        self.assertEqual(resolved.case_key, "folder:f-9")
        self.assertIsNone(resolved.case_id)

    def test_intake_folder_without_a_row_keys_by_its_temp_name(self) -> None:
        p1, p2, p3, p4, _ = patched(None)
        with p1, p2, p3, p4:
            resolved = resolve_case_scope("temp-abc123", "42")
        self.assertEqual(resolved.case_key, "temp-abc123")
        self.assertTrue(resolved.is_intake)

    def test_unknown_folder_yields_no_scope(self) -> None:
        p1, p2, p3, p4, _ = patched(None)
        with p1, p2, p3, p4:
            self.assertIsNone(resolve_case_scope("Someone else's case", "42"))


class AccessTests(unittest.TestCase):
    def test_anonymous_user_gets_no_scope(self) -> None:
        self.assertIsNone(resolve_case_scope("Any case", "anonymous"))

    def test_missing_database_yields_no_scope(self) -> None:
        with patch.object(scope_mod, "is_db_available", return_value=False):
            self.assertIsNone(resolve_case_scope("Any case", "42"))

    def test_limited_firm_user_without_an_assignment_is_refused(self) -> None:
        row = {"folder_id": "f-1", "folder_name": "Firm case", "case_id": "512"}
        firm = {"accountType": "FIRM_USER", "isFirmAdmin": False, "firmId": "77"}
        p1, p2, p3, p4, _ = patched(row, firm=firm, accessible=["42", "43"], assignment_row=None)
        with p1, p2, p3, p4:
            self.assertIsNone(resolve_case_scope("Firm case", "42"))

    def test_limited_firm_user_with_an_assignment_is_allowed(self) -> None:
        row = {"folder_id": "f-1", "folder_name": "Firm case", "case_id": "512"}
        firm = {"accountType": "FIRM_USER", "isFirmAdmin": False, "firmId": "77"}
        p1, p2, p3, p4, _ = patched(row, firm=firm, accessible=["42", "43"], assignment_row={"?column?": 1})
        with p1, p2, p3, p4:
            resolved = resolve_case_scope("Firm case", "42")
        self.assertIsNotNone(resolved)
        self.assertEqual(resolved.firm_id, "77")
        self.assertTrue(resolved.is_limited_firm_user)

    def test_firm_admin_skips_the_assignment_check(self) -> None:
        row = {"folder_id": "f-1", "folder_name": "Firm case", "case_id": "512"}
        firm = {"accountType": "FIRM_ADMIN", "isFirmAdmin": True, "firmId": "77"}
        p1, p2, p3, p4, cursor = patched(row, firm=firm, accessible=["42", "43"])
        with p1, p2, p3, p4:
            resolved = resolve_case_scope("Firm case", "42")
        self.assertIsNotNone(resolved)
        self.assertFalse(resolved.is_limited_firm_user)
        self.assertFalse(any("case_assignments" in q for q in cursor.queries))

    def test_folder_lookup_is_scoped_to_accessible_users(self) -> None:
        row = {"folder_id": "f-1", "folder_name": "Firm case", "case_id": "512"}
        p1, p2, p3, p4, cursor = patched(row, accessible=["42", "43"])
        with p1, p2, p3, p4:
            resolve_case_scope("Firm case", "42")
        lookup = next(q for q in cursor.queries if "from user_files uf" in q)
        self.assertIn("user_id::text = any(%s::text[])", lookup)
        self.assertIn("is_folder = true", lookup)


if __name__ == "__main__":
    unittest.main()
