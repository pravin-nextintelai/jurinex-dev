"""Memory API for the case lifecycle: export, import and re-seeding."""
from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import memory as memory_routes
from app.api.routes.rbac.auth import get_current_user
from app.services.memory import export as export_mod
from app.services.memory import seed as seed_mod
from app.services.memory.repository import VersionConflict
from app.services.memory.scope import CaseScope

USER = {"id": 42, "name": "Adv. Kulkarni", "email": "a@x.in", "role": "user", "account_type": "SOLO"}
SCOPE = CaseScope(
    case_key="512",
    folder_name="State_v_Pawar",
    user_id="42",
    case_id="512",
    firm_id="firm-9",
)


def client() -> TestClient:
    app = FastAPI()
    app.include_router(memory_routes.router)
    app.dependency_overrides[get_current_user] = lambda: dict(USER)
    return TestClient(app)


class ExportRouteTests(unittest.TestCase):
    def test_export_returns_this_cases_document(self) -> None:
        with patch.object(memory_routes, "resolve_case_scope", return_value=SCOPE), patch.object(
            export_mod, "export_case", return_value={"schema": "jurinex.case_memory", "sections": []}
        ) as export_case:
            response = client().get("/api/memory/cases/State_v_Pawar/export")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["schema"], "jurinex.case_memory")
        self.assertIs(export_case.call_args.args[0], SCOPE)

    def test_an_inaccessible_case_cannot_be_exported(self) -> None:
        with patch.object(memory_routes, "resolve_case_scope", return_value=None), patch.object(
            export_mod, "export_case"
        ) as export_case:
            response = client().get("/api/memory/cases/Someone_Elses_Case/export")
        self.assertEqual(response.status_code, 404)
        export_case.assert_not_called()


class ImportRouteTests(unittest.TestCase):
    def test_a_file_that_is_not_an_export_is_422(self) -> None:
        with patch.object(memory_routes, "resolve_case_scope", return_value=SCOPE), patch.object(
            memory_routes, "_document_names", return_value=[]
        ):
            response = client().post(
                "/api/memory/cases/State_v_Pawar/import", json={"payload": {"schema": "nope"}}
            )
        self.assertEqual(response.status_code, 422)
        body = response.json()
        self.assertEqual(body["detail"], "rejected")
        self.assertEqual(body["problems"][0]["code"], "invalid_export")

    def test_import_passes_the_mode_and_this_cases_documents(self) -> None:
        with patch.object(memory_routes, "resolve_case_scope", return_value=SCOPE), patch.object(
            memory_routes, "_document_names", return_value=["remand-order.pdf"]
        ), patch.object(export_mod, "import_case", return_value={"lines_written": 3}) as import_case:
            response = client().post(
                "/api/memory/cases/State_v_Pawar/import",
                json={"payload": {"schema": "jurinex.case_memory"}, "replace": True},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"lines_written": 3})
        self.assertIs(import_case.call_args.args[0], SCOPE)
        kwargs = import_case.call_args.kwargs
        self.assertTrue(kwargs["replace"])
        self.assertEqual(kwargs["doc_names"], ["remand-order.pdf"])
        self.assertEqual(kwargs["actor"], "42")

    def test_merge_is_the_default(self) -> None:
        with patch.object(memory_routes, "resolve_case_scope", return_value=SCOPE), patch.object(
            memory_routes, "_document_names", return_value=[]
        ), patch.object(export_mod, "import_case", return_value={}) as import_case:
            client().post("/api/memory/cases/State_v_Pawar/import", json={"payload": {}})
        self.assertFalse(import_case.call_args.kwargs["replace"])

    def test_a_concurrent_edit_during_import_is_409(self) -> None:
        with patch.object(memory_routes, "resolve_case_scope", return_value=SCOPE), patch.object(
            memory_routes, "_document_names", return_value=[]
        ), patch.object(
            export_mod, "import_case", side_effect=VersionConflict("instructions", 2, 3)
        ):
            response = client().post(
                "/api/memory/cases/State_v_Pawar/import",
                json={"payload": {"schema": "jurinex.case_memory"}, "replace": True},
            )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["detail"], "stale_version")
        self.assertEqual(response.json()["current_version"], 3)


class SeedRouteTests(unittest.TestCase):
    def test_seed_uses_this_cases_row_chronology_and_documents(self) -> None:
        row = {"case_title": "State v. Pawar"}
        tree = {"dates": []}
        files = [{"id": "f1", "name": "FIR.pdf"}]
        with patch.object(memory_routes, "resolve_case_scope", return_value=SCOPE), patch.object(
            memory_routes, "_seed_inputs", return_value=(row, tree, files)
        ), patch.object(
            seed_mod,
            "seed_case_memory",
            return_value={"case_key": "512", "added": 4, "updated": 0, "skipped": 1, "skipped_reason": None},
        ) as seed:
            response = client().post("/api/memory/cases/State_v_Pawar/seed")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["added"], 4)
        self.assertEqual(seed.call_args.args[0], "512")
        kwargs = seed.call_args.kwargs
        self.assertEqual(kwargs["case_row"], row)
        self.assertEqual(kwargs["tree"], tree)
        self.assertEqual(kwargs["files"], files)
        self.assertEqual(kwargs["firm_id"], "firm-9")
        self.assertEqual(kwargs["actor"], "42")

    def test_an_inaccessible_case_is_never_seeded(self) -> None:
        with patch.object(memory_routes, "resolve_case_scope", return_value=None), patch.object(
            memory_routes, "_seed_inputs"
        ) as inputs, patch.object(seed_mod, "seed_case_memory") as seed:
            response = client().post("/api/memory/cases/Someone_Elses_Case/seed")
        self.assertEqual(response.status_code, 404)
        inputs.assert_not_called()
        seed.assert_not_called()


if __name__ == "__main__":
    unittest.main()
