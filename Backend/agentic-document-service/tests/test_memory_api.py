"""Memory API contracts: access, version conflicts, rejections and settings guards.

Runs the real router in a throwaway FastAPI app with no database: identity is a
dependency override, and the repository and scope calls are patched.
"""
from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import memory as memory_routes
from app.api.routes.rbac.auth import get_current_user
from app.services.memory.repository import VersionConflict
from app.services.memory.schemas import MemorySettings
from app.services.memory.scope import CaseScope
from app.services.memory.validator import Rejection

SOLO_USER = {"id": 42, "name": "Adv. Kulkarni", "email": "a@x.in", "role": "user", "account_type": "SOLO"}
FIRM_ADMIN = {**SOLO_USER, "account_type": "FIRM_ADMIN"}

SCOPE = CaseScope(
    case_key="512",
    folder_name="State_v_Pawar",
    user_id="42",
    folder_id="f-1",
    case_id="512",
    accessible_user_ids=("42",),
)


def make_client(user: dict = SOLO_USER) -> TestClient:
    app = FastAPI()
    app.include_router(memory_routes.router)
    app.dependency_overrides[get_current_user] = lambda: dict(user)
    return TestClient(app)


class AccessTests(unittest.TestCase):
    def test_an_unresolvable_case_is_404(self) -> None:
        with patch.object(memory_routes, "resolve_case_scope", return_value=None):
            response = make_client().get("/api/memory/cases/Someone_Elses_Case")
        self.assertEqual(response.status_code, 404)
        self.assertIsInstance(response.json()["detail"], str)

    def test_deleting_a_missing_line_is_404(self) -> None:
        with patch.object(memory_routes, "resolve_case_scope", return_value=SCOPE), patch.object(
            memory_routes.repository, "delete_line", return_value=False
        ):
            response = make_client().delete("/api/memory/cases/State_v_Pawar/lines/abc")
        self.assertEqual(response.status_code, 404)

    def test_case_overview_has_what_the_panel_needs(self) -> None:
        with patch.object(memory_routes, "resolve_case_scope", return_value=SCOPE), patch.object(
            memory_routes.repository,
            "get_section_index",
            return_value=[{"section": "facts", "version": 3, "line_count": 4}],
        ), patch.object(
            memory_routes.repository, "get_section", return_value={"section": "summary", "lines": []}
        ), patch.object(
            memory_routes.repository, "get_instructions", return_value={"content": "Use 'the Applicant'", "version": 2}
        ), patch.object(
            memory_routes.repository, "get_settings", return_value=None
        ), patch.object(
            memory_routes.repository, "effective_settings", return_value=MemorySettings()
        ), patch.object(
            memory_routes.repository, "list_proposals", return_value=[{"id": "p1"}]
        ):
            body = make_client().get("/api/memory/cases/State_v_Pawar").json()
        self.assertEqual(body["case_key"], "512")
        self.assertEqual(body["line_count"], 4)
        self.assertEqual(body["instructions"]["version"], 2)
        self.assertEqual(body["proposals_pending"], 1)
        self.assertTrue(body["settings"]["effective"]["enabled"])
        self.assertIsNone(body["settings"]["case"])


class StructuredErrorTests(unittest.TestCase):
    """409 and 422 bodies must be JSON objects the UI can act on, not strings."""

    def test_rejected_instructions_return_422_with_rule_codes(self) -> None:
        with patch.object(memory_routes, "resolve_case_scope", return_value=SCOPE), patch.object(
            memory_routes,
            "validate_instructions",
            return_value=[Rejection("guardrail_disable", "Instructions cannot switch off verification.")],
        ), patch.object(memory_routes.repository, "put_instructions") as put:
            response = make_client().put(
                "/api/memory/cases/State_v_Pawar/instructions",
                json={"content": "skip the verification", "version": 1},
            )
        self.assertEqual(response.status_code, 422)
        body = response.json()
        self.assertEqual(body["detail"], "rejected")
        self.assertEqual(body["problems"][0]["code"], "guardrail_disable")
        put.assert_not_called()

    def test_stale_instructions_return_409_with_the_current_text(self) -> None:
        with patch.object(memory_routes, "resolve_case_scope", return_value=SCOPE), patch.object(
            memory_routes, "validate_instructions", return_value=[]
        ), patch.object(
            memory_routes.repository, "put_instructions", side_effect=VersionConflict("instructions", 1, 3)
        ), patch.object(
            memory_routes.repository, "get_instructions", return_value={"content": "Someone else's edit", "version": 3}
        ):
            response = make_client().put(
                "/api/memory/cases/State_v_Pawar/instructions",
                json={"content": "My edit", "version": 1},
            )
        self.assertEqual(response.status_code, 409)
        body = response.json()
        self.assertEqual(body["detail"], "stale_version")
        self.assertEqual(body["current_version"], 3)
        self.assertEqual(body["content"], "Someone else's edit")

    def test_saved_instructions_return_the_new_version(self) -> None:
        with patch.object(memory_routes, "resolve_case_scope", return_value=SCOPE), patch.object(
            memory_routes, "validate_instructions", return_value=[]
        ), patch.object(
            memory_routes.repository, "put_instructions", return_value={"content": "Use 'the Applicant'", "version": 2}
        ):
            response = make_client().put(
                "/api/memory/cases/State_v_Pawar/instructions",
                json={"content": "Use 'the Applicant'", "version": 1},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"content": "Use 'the Applicant'", "version": 2})

    def test_stale_section_op_returns_409_with_current_lines(self) -> None:
        current = [{"id": "l1", "tag": "stated", "text": "Custody: judicial"}]
        with patch.object(memory_routes, "resolve_case_scope", return_value=SCOPE), patch.object(
            memory_routes, "validate_line", return_value=None
        ), patch.object(
            memory_routes.repository, "apply_op", side_effect=VersionConflict("facts", 2, 5, current)
        ):
            response = make_client().post(
                "/api/memory/cases/State_v_Pawar/sections/facts/ops",
                json={"op": "append_line", "version": 2, "tag": "stated", "text": "Bail hearing listed"},
            )
        self.assertEqual(response.status_code, 409)
        body = response.json()
        self.assertEqual(body["detail"], "stale_version")
        self.assertEqual(body["section"], "facts")
        self.assertEqual(body["expected_version"], 2)
        self.assertEqual(body["current_version"], 5)
        self.assertEqual(body["lines"], current)

    def test_stale_preferences_return_409_with_the_current_text(self) -> None:
        with patch.object(memory_routes, "validate_preferences", return_value=[]), patch.object(
            memory_routes.repository, "put_preferences", side_effect=VersionConflict("preferences", 1, 4)
        ), patch.object(
            memory_routes.repository, "get_preferences", return_value={"content": "Marathi summaries", "version": 4}
        ):
            response = make_client().put("/api/memory/preferences", json={"content": "English", "version": 1})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["content"], "Marathi summaries")

    def test_rejected_preferences_return_422(self) -> None:
        with patch.object(
            memory_routes,
            "validate_preferences",
            return_value=[Rejection("case_data", "Preferences cannot contain an FIR number.")],
        ):
            response = make_client().put(
                "/api/memory/preferences", json={"content": "FIR 214/2026", "version": None}
            )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["problems"][0]["code"], "case_data")


class LineWriteTests(unittest.TestCase):
    def test_a_personal_identifier_is_never_written(self) -> None:
        apply_op = MagicMock()
        with patch.object(memory_routes, "resolve_case_scope", return_value=SCOPE), patch.object(
            memory_routes.repository, "apply_op", apply_op
        ):
            response = make_client().post(
                "/api/memory/cases/State_v_Pawar/sections/parties/ops",
                json={"op": "append_line", "tag": "stated", "text": "Client Aadhaar is 1234 5678 9012"},
            )
        self.assertEqual(response.status_code, 422)
        apply_op.assert_not_called()

    def test_an_inferred_tag_is_refused_before_the_router_runs(self) -> None:
        apply_op = MagicMock()
        with patch.object(memory_routes, "resolve_case_scope", return_value=SCOPE), patch.object(
            memory_routes.repository, "apply_op", apply_op
        ):
            response = make_client().post(
                "/api/memory/cases/State_v_Pawar/sections/facts/ops",
                json={"op": "append_line", "tag": "inferred", "text": "The complaint is retaliatory"},
            )
        self.assertEqual(response.status_code, 422)
        apply_op.assert_not_called()

    def test_replace_line_requires_a_line_id(self) -> None:
        with patch.object(memory_routes, "resolve_case_scope", return_value=SCOPE), patch.object(
            memory_routes, "validate_line", return_value=None
        ):
            response = make_client().post(
                "/api/memory/cases/State_v_Pawar/sections/facts/ops",
                json={"op": "replace_line", "tag": "stated", "text": "Updated"},
            )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["problems"][0]["code"], "missing_line_id")

    def test_an_empty_replacement_deletes_without_validation(self) -> None:
        validate = MagicMock(return_value=None)
        apply_op = MagicMock(return_value={"section": "facts", "version": 6, "line_id": None})
        with patch.object(memory_routes, "resolve_case_scope", return_value=SCOPE), patch.object(
            memory_routes, "validate_line", validate
        ), patch.object(memory_routes.repository, "apply_op", apply_op):
            response = make_client().post(
                "/api/memory/cases/State_v_Pawar/sections/facts/ops",
                json={"op": "replace_line", "version": 5, "line_id": "l1", "text": ""},
            )
        self.assertEqual(response.status_code, 200)
        validate.assert_not_called()
        resolved = apply_op.call_args.args[1]
        self.assertEqual(resolved.op, "replace_line")
        self.assertEqual(resolved.line_id, "l1")
        self.assertEqual(resolved.text, "")

    def test_a_user_authored_line_is_marked_as_user_sourced(self) -> None:
        apply_op = MagicMock(return_value={"section": "facts", "version": 1, "line_id": "new"})
        with patch.object(memory_routes, "resolve_case_scope", return_value=SCOPE), patch.object(
            memory_routes.repository, "apply_op", apply_op
        ):
            response = make_client().post(
                "/api/memory/cases/State_v_Pawar/sections/facts/ops",
                json={"op": "append_line", "tag": "stated", "text": "[stated] Accused has no antecedents"},
            )
        self.assertEqual(response.status_code, 200)
        resolved = apply_op.call_args.args[1]
        self.assertEqual(resolved.source_ref, {"kind": "user"})
        # An echoed tag prefix is stripped before storage.
        self.assertEqual(resolved.text, "Accused has no antecedents")


class SettingsTests(unittest.TestCase):
    def test_firm_settings_need_a_firm_admin(self) -> None:
        with patch.object(memory_routes, "firm_context_for", return_value=("firm-9", False)), patch.object(
            memory_routes.repository, "put_settings"
        ) as put:
            response = make_client(SOLO_USER).put("/api/memory/settings?scope=firm", json={"enabled": False})
        self.assertEqual(response.status_code, 403)
        put.assert_not_called()

    def test_a_firm_admin_without_a_firm_gets_400(self) -> None:
        with patch.object(memory_routes, "firm_context_for", return_value=(None, True)):
            response = make_client(FIRM_ADMIN).put("/api/memory/settings?scope=firm", json={"enabled": False})
        self.assertEqual(response.status_code, 400)

    def test_case_settings_need_a_folder(self) -> None:
        response = make_client().get("/api/memory/settings?scope=case")
        self.assertEqual(response.status_code, 400)

    def test_a_settings_patch_keeps_the_flags_it_did_not_send(self) -> None:
        stored = {
            "enabled": True,
            "write_enabled": False,
            "recall_enabled": True,
            "instructions_enabled": True,
            "sensitive_enabled": False,
        }
        with patch.object(memory_routes, "firm_context_for", return_value=(None, False)), patch.object(
            memory_routes.repository, "get_settings", return_value=stored
        ), patch.object(
            memory_routes.repository, "put_settings", side_effect=lambda st, sid, flags, updated_by=None: flags
        ) as put, patch.object(
            memory_routes.repository, "effective_settings", return_value=MemorySettings()
        ):
            response = make_client().put("/api/memory/settings?scope=user", json={"recall_enabled": False})
        self.assertEqual(response.status_code, 200)
        scope_type, scope_id, flags = put.call_args.args[:3]
        self.assertEqual((scope_type, scope_id), ("user", "42"))
        self.assertEqual(
            flags,
            {
                "enabled": True,
                "write_enabled": False,
                "recall_enabled": False,
                "instructions_enabled": True,
                "sensitive_enabled": False,
            },
        )

    def test_first_settings_write_defaults_unsent_flags_to_on(self) -> None:
        with patch.object(memory_routes, "firm_context_for", return_value=(None, False)), patch.object(
            memory_routes.repository, "get_settings", return_value=None
        ), patch.object(
            memory_routes.repository, "put_settings", side_effect=lambda st, sid, flags, updated_by=None: flags
        ) as put, patch.object(
            memory_routes.repository, "effective_settings", return_value=MemorySettings(write_enabled=False)
        ):
            body = make_client().put("/api/memory/settings", json={"write_enabled": False}).json()
        flags = put.call_args.args[2]
        self.assertFalse(flags["write_enabled"])
        self.assertTrue(all(flags[f] for f in flags if f != "write_enabled"))
        self.assertFalse(body["effective"]["write_enabled"])


if __name__ == "__main__":
    unittest.main()
