"""Memory is ONE switch.

The profile Settings page shows a single Memory toggle and nothing else, so
`update_settings(enabled=...)` has to carry the behaviour that makes Memory useful:
filing durable facts after a turn (`generate_from_chats`). Turning it off has to
stop all of it.

`sensitive_data` is the deliberate exception — health, political, religious,
orientation, caste and financial facts stay unstored unless a caller opts in on
purpose — so it must NOT follow the switch.

Run:  PYTHONPATH=. .venv/Scripts/python.exe -m unittest tests.test_memory_single_switch -v
"""
from __future__ import annotations

import unittest
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any

from app.services import memory_service


USER = "user-1"


class _SettingsCursor:
    """Just the two statements the settings path issues."""

    def __init__(self, store: dict[str, dict[str, Any]]) -> None:
        self._store = store
        self._result: list[dict[str, Any]] = []
        self.rowcount = 0

    def __enter__(self) -> "_SettingsCursor":
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def fetchone(self) -> dict[str, Any] | None:
        return self._result[0] if self._result else None

    def fetchall(self) -> list[dict[str, Any]]:
        return list(self._result)

    def execute(self, sql: str, params: Any = ()) -> None:
        params = tuple(params or ())
        text = " ".join(sql.split())
        self._result = []
        if text.startswith(("CREATE", "ALTER", "DROP", "UPDATE personalization_memory_settings SET enabled")):
            return
        if text.startswith("SELECT enabled"):
            row = self._store.get(params[0])
            self._result = [dict(row)] if row else []
            return
        if text.startswith("INSERT INTO personalization_memory_settings"):
            uid, enabled, generate, sensitive = params
            self._store[uid] = {
                "enabled": bool(enabled),
                "generate_from_chats": bool(generate),
                "sensitive_data": bool(sensitive),
                "updated_at": datetime.now(timezone.utc),
            }
            self.rowcount = 1
            return
        raise AssertionError(f"unexpected statement: {text[:120]}")


class _SettingsConnection:
    def __init__(self, store: dict[str, dict[str, Any]]) -> None:
        self._store = store

    def cursor(self) -> _SettingsCursor:
        return _SettingsCursor(self._store)

    def commit(self) -> None:
        return None

    def rollback(self) -> None:
        return None


class SingleMemorySwitchTests(unittest.TestCase):
    def setUp(self) -> None:
        self.store: dict[str, dict[str, Any]] = {}

        @contextmanager
        def fake_conn():
            yield _SettingsConnection(self.store)

        patches = {
            "get_db_connection": fake_conn,
            "is_db_available": lambda: True,
            "_ensure_tables": lambda conn: None,
        }
        self._saved = {name: getattr(memory_service, name) for name in patches}
        for name, value in patches.items():
            setattr(memory_service, name, value)

    def tearDown(self) -> None:
        for name, value in self._saved.items():
            setattr(memory_service, name, value)

    def test_turning_the_switch_on_turns_on_filing(self) -> None:
        out = memory_service.update_settings(USER, enabled=True)
        self.assertTrue(out["enabled"])
        self.assertTrue(out["generate_from_chats"], "one switch must turn on background filing")

    def test_past_chat_search_is_not_a_memory_setting(self) -> None:
        out = memory_service.update_settings(USER, enabled=True)
        self.assertNotIn(
            "search_past_chats",
            out,
            "Memory is files only; raw conversations are not part of it",
        )

    def test_turning_the_switch_off_turns_everything_off(self) -> None:
        memory_service.update_settings(USER, enabled=True)
        out = memory_service.update_settings(USER, enabled=False)
        self.assertFalse(out["enabled"])
        self.assertFalse(out["generate_from_chats"])

    def test_sensitive_data_does_not_follow_the_switch(self) -> None:
        out = memory_service.update_settings(USER, enabled=True)
        self.assertFalse(
            out["sensitive_data"],
            "turning Memory on must never silently consent to storing sensitive facts",
        )

    def test_sensitive_data_survives_an_off_then_on_cycle(self) -> None:
        memory_service.update_settings(USER, enabled=True)
        memory_service.update_settings(USER, sensitive_data=True)
        memory_service.update_settings(USER, enabled=False)
        out = memory_service.update_settings(USER, enabled=True)
        self.assertTrue(out["sensitive_data"], "an explicit consent must not be reset by the switch")

    def test_the_granular_flags_still_work_for_api_callers(self) -> None:
        memory_service.update_settings(USER, enabled=True)
        out = memory_service.update_settings(USER, generate_from_chats=False)
        self.assertTrue(out["enabled"])
        self.assertFalse(out["generate_from_chats"], "an explicit flag must win over the cascade")

    def test_an_explicit_flag_sent_with_the_switch_wins(self) -> None:
        out = memory_service.update_settings(USER, enabled=True, generate_from_chats=False)
        self.assertTrue(out["enabled"])
        self.assertFalse(out["generate_from_chats"])

    def test_a_new_user_starts_with_memory_off(self) -> None:
        out = memory_service.get_settings_for_user("brand-new-user")
        self.assertFalse(out["enabled"])
        self.assertFalse(out["generate_from_chats"])
        self.assertFalse(out["sensitive_data"])


if __name__ == "__main__":
    unittest.main()
