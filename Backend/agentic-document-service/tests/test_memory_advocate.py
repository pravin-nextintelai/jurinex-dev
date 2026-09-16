"""Remembering the advocate across cases: what may be kept, how it reaches the prompt, and its API."""
from __future__ import annotations

import unittest
from contextlib import ExitStack
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import memory as memory_routes
from app.api.routes.rbac.auth import get_current_user
from app.services.memory import assembly as assembly_mod
from app.services.memory.assembly import MemoryBudget, build_context_layers, render_advocate
from app.services.memory.instructions import InstructionContext
from app.services.memory.repository import VersionConflict
from app.services.memory.schemas import MAX_ADVOCATE_LINES, SETTINGS_FLAGS, MemorySettings
from app.services.memory.scope import CaseScope
from app.services.memory.validator import advocate_set_room, validate_advocate_line

USER = {"id": 42, "name": "Adv. Kulkarni", "email": "a@x.in", "role": "user", "account_type": "SOLO"}
SCOPE = CaseScope(case_key="512", folder_name="State v Pawar", user_id="42", case_id="512", accessible_user_ids=("42",))

LINES = [
    {"id": "a1", "category": "clients", "text": "Usually acts for borrowers, not banks"},
    {"id": "a2", "category": "practice", "text": "Mostly appears before the Aurangabad Bench"},
    {"id": "a3", "category": "work_style", "text": "Juniors prepare the first draft"},
]


class ValidatorTests(unittest.TestCase):
    def test_working_facts_about_the_advocate_are_allowed(self) -> None:
        for category, text in (
            ("practice", "Mostly appears before the Aurangabad Bench in land acquisition matters"),
            ("clients", "Usually acts for borrowers, not banks"),
            ("work_style", "Juniors prepare the first draft; the advocate settles it"),
            ("background", "Twelve years at the bar; works in English and Marathi"),
        ):
            with self.subTest(text=text):
                self.assertIsNone(validate_advocate_line(text, category=category))

    def test_case_details_are_refused(self) -> None:
        for text, code in (
            ("Appears in WP 1234/2024 for the petitioner", "case_data_case_number"),
            ("Hearing on 14 October 2026 before the Bench", "case_data_date"),
            ("Acts in Pawar vs State matters", "case_data_party"),
            ("Handles FIR no 45 at the local station", "case_data_fir"),
        ):
            with self.subTest(text=text):
                self.assertEqual(validate_advocate_line(text, category="practice").code, code)

    def test_a_party_from_their_cases_is_refused(self) -> None:
        rejection = validate_advocate_line("Usually acts for the Pawar family", party_names=("Sunil Pawar",))
        self.assertEqual(rejection.code, "universal_party_name")

    def test_inference_identifiers_and_unknown_categories_are_refused(self) -> None:
        self.assertEqual(validate_advocate_line("Probably a criminal lawyer").code, "inference_language")
        self.assertEqual(validate_advocate_line("PAN ABCDE1234F").code, "pii_pan")
        self.assertEqual(validate_advocate_line("Plays chess", category="hobbies").code, "bad_category")
        self.assertEqual(validate_advocate_line("   ").code, "empty")

    def test_the_set_has_a_line_and_a_character_cap(self) -> None:
        self.assertIsNone(advocate_set_room(LINES, "Twelve years at the bar"))
        full = [{"text": "x"} for _ in range(MAX_ADVOCATE_LINES)]
        self.assertEqual(advocate_set_room(full, "one more").code, "set_full")
        self.assertEqual(advocate_set_room([{"text": "x" * 2_990}], "a long new fact").code, "set_too_long")


class RenderTests(unittest.TestCase):
    def test_facts_are_grouped_by_category_in_a_fixed_order(self) -> None:
        text, count = render_advocate(LINES, 2_000)
        self.assertEqual(count, 3)
        self.assertLess(text.index("Practice:"), text.index("Clients:"))
        self.assertLess(text.index("Clients:"), text.index("How they work:"))
        self.assertIn("Practice:\n- Mostly appears before the Aurangabad Bench", text)

    def test_the_oldest_facts_go_first_when_over_budget(self) -> None:
        text, count = render_advocate(LINES, 80)
        self.assertEqual(count, 1)
        self.assertNotIn("borrowers", text)
        self.assertIn("Juniors prepare the first draft", text)

    def test_blank_lines_and_unknown_categories_are_left_out(self) -> None:
        text, count = render_advocate([{"category": "hobbies", "text": "Chess"}, {"category": "practice", "text": " "}], 500)
        self.assertEqual((text, count), ("", 0))


def build(*, lines=LINES, settings=None, advocate_error=None):
    def resolve(user_id, case_key, session_id=None, *, include_case=True):
        items = [{"id": "u1", "text": "Answer in English", "enabled": True, "effective": True}]
        return InstructionContext(user_version=3, user_items=items, applied_ids=["u1"])

    advocate = (
        {"side_effect": advocate_error}
        if advocate_error is not None
        else {"return_value": {"user_id": "42", "version": 5, "lines": list(lines), "forgotten": []}}
    )
    with ExitStack() as stack:
        stack.enter_context(
            patch.object(assembly_mod.repository, "effective_settings", return_value=settings or MemorySettings())
        )
        stack.enter_context(patch.object(assembly_mod, "resolve_instructions", side_effect=resolve))
        stack.enter_context(patch.object(assembly_mod.repository, "get_section_index", return_value=[]))
        read = stack.enter_context(patch.object(assembly_mod.repository, "get_advocate_memory", **advocate))
        bundle = build_context_layers(SCOPE, question_raw="Summarise the case")
    return bundle, read


class AssemblyTests(unittest.TestCase):
    def test_the_advocate_block_comes_first_and_is_reported(self) -> None:
        bundle, read = build()
        read.assert_called_once_with("42")
        suffix = bundle.system_suffix
        self.assertIn("ABOUT THE ADVOCATE (v5;", suffix)
        self.assertLess(suffix.index("ABOUT THE ADVOCATE"), suffix.index("ADVOCATE STANDING INSTRUCTIONS"))
        self.assertEqual(bundle.advocate_lines, 3)
        self.assertEqual(bundle.metadata()["advocate_lines"], 3)
        self.assertEqual(bundle.log_entry["details"]["advocate_lines"], 3)

    def test_nothing_is_read_when_the_switch_is_off(self) -> None:
        bundle, read = build(settings=MemorySettings(advocate_enabled=False))
        read.assert_not_called()
        self.assertNotIn("ABOUT THE ADVOCATE", bundle.system_suffix)
        self.assertIn("ADVOCATE STANDING INSTRUCTIONS", bundle.system_suffix)

    def test_a_failed_read_only_loses_this_block(self) -> None:
        bundle, _ = build(advocate_error=RuntimeError("db down"))
        self.assertNotIn("ABOUT THE ADVOCATE", bundle.system_suffix)
        self.assertIn("Answer in English", bundle.system_suffix)
        self.assertEqual(bundle.advocate_lines, 0)

    def test_no_block_when_nothing_is_remembered(self) -> None:
        bundle, _ = build(lines=[])
        self.assertNotIn("ABOUT THE ADVOCATE", bundle.system_suffix)

    def test_a_gemma_chat_gets_a_small_slice(self) -> None:
        self.assertLess(MemoryBudget.gemma().advocate, MemoryBudget.default().advocate)
        self.assertIn("advocate", MemoryBudget.default().as_dict())


def client() -> TestClient:
    app = FastAPI()
    app.include_router(memory_routes.router)
    app.dependency_overrides[get_current_user] = lambda: dict(USER)
    return TestClient(app)


def stored(lines=LINES, version=5):
    return {"user_id": "42", "version": version, "lines": [dict(line) for line in lines], "forgotten": []}


class ApiTests(unittest.TestCase):
    def setUp(self) -> None:
        stack = ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(patch("app.services.memory.parties.party_names_for_user", return_value=("Sunil Pawar",)))
        self.stack = stack

    def patch_repo(self, name, **kwargs):
        return self.stack.enter_context(patch.object(memory_routes.repository, name, **kwargs))

    def test_the_list_carries_its_limits(self) -> None:
        self.patch_repo("get_advocate_memory", return_value=stored())
        body = client().get("/api/memory/advocate").json()
        self.assertEqual(body["version"], 5)
        self.assertEqual(len(body["lines"]), 3)
        self.assertEqual(body["categories"], ["practice", "clients", "work_style", "background"])
        self.assertEqual((body["max_lines"], body["max_line_chars"]), (MAX_ADVOCATE_LINES, 300))

    def test_adding_a_fact_saves_it_as_the_advocates_own(self) -> None:
        self.patch_repo("get_advocate_memory", return_value=stored())
        add = self.patch_repo(
            "add_advocate_line", return_value={"version": 6, "line": {"id": "a9", "category": "background"}}
        )
        response = client().post(
            "/api/memory/advocate", json={"category": "background", "text": "  Twelve years   at the bar ", "version": 5}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(add.call_args.args, ("42", "background", "Twelve years at the bar", 5))
        self.assertEqual(add.call_args.kwargs["source_ref"], {"kind": "user"})

    def test_case_details_and_party_names_get_422_with_the_rule(self) -> None:
        add = self.patch_repo("add_advocate_line")
        self.patch_repo("get_advocate_memory", return_value=stored())
        for text, code in (
            ("Appears in WP 1234/2024", "case_data_case_number"),
            ("Acts for the Pawar family", "universal_party_name"),
        ):
            with self.subTest(text=text):
                response = client().post("/api/memory/advocate", json={"category": "clients", "text": text})
                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.json()["problems"][0]["code"], code)
        add.assert_not_called()

    def test_a_full_set_gets_422(self) -> None:
        self.patch_repo(
            "get_advocate_memory",
            return_value=stored([{"id": f"a{n}", "category": "practice", "text": "x"} for n in range(MAX_ADVOCATE_LINES)]),
        )
        response = client().post("/api/memory/advocate", json={"category": "practice", "text": "Criminal lawyer"})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["problems"][0]["code"], "set_full")

    def test_a_stale_version_gets_409_with_the_current_lines(self) -> None:
        self.patch_repo("get_advocate_memory", return_value=stored())
        self.patch_repo("add_advocate_line", side_effect=VersionConflict("advocate", 4, 5, list(LINES)))
        response = client().post(
            "/api/memory/advocate", json={"category": "practice", "text": "Criminal lawyer", "version": 4}
        )
        self.assertEqual(response.status_code, 409)
        body = response.json()
        self.assertEqual((body["detail"], body["current_version"], len(body["lines"])), ("stale_version", 5, 3))

    def test_editing_checks_the_new_text_and_marks_the_edit(self) -> None:
        self.patch_repo("get_advocate_memory", return_value=stored())
        update = self.patch_repo(
            "update_advocate_line", return_value={"version": 6, "line": {"id": "a2", "text": "Appears at Nagpur"}}
        )
        response = client().patch("/api/memory/advocate/a2", json={"text": "Appears at the Nagpur Bench", "version": 5})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(update.call_args.args, ("42", "a2", 5))
        self.assertEqual(update.call_args.kwargs["text"], "Appears at the Nagpur Bench")
        self.assertEqual(update.call_args.kwargs["source_ref_extra"], {"edited_by": "user"})

        bad = client().patch("/api/memory/advocate/a2", json={"text": "Hearing on 14 October 2026"})
        self.assertEqual(bad.status_code, 422)
        missing = client().patch("/api/memory/advocate/zz", json={"text": "Criminal lawyer"})
        self.assertEqual(missing.status_code, 404)

    def test_forgetting_one_fact_and_everything(self) -> None:
        delete = self.patch_repo("delete_advocate_line", return_value={"version": 6, "deleted": True, "line": {}})
        self.assertEqual(client().delete("/api/memory/advocate/a1?version=5").status_code, 200)
        self.assertEqual(delete.call_args.args, ("42", "a1", 5))

        delete.return_value = {"version": 6, "deleted": False, "line": None}
        self.assertEqual(client().delete("/api/memory/advocate/a1").status_code, 404)

        forget = self.patch_repo("delete_advocate_memory", return_value=3)
        self.assertEqual(client().delete("/api/memory/advocate").json(), {"deleted": 3})
        forget.assert_called_once_with("42")

    def test_the_switch_is_one_of_the_settings(self) -> None:
        self.assertIn("advocate_enabled", SETTINGS_FLAGS)
        merged = MemorySettings().merged_with(MemorySettings(advocate_enabled=False))
        self.assertFalse(merged.advocate_enabled)
        self.assertTrue(merged.recall_enabled)

    def test_a_turn_reports_what_it_remembered_about_the_advocate(self) -> None:
        self.stack.enter_context(patch.object(memory_routes, "resolve_case_scope", return_value=SCOPE))
        self.patch_repo(
            "get_turn_log",
            return_value={"writes": 1, "details": {"advocate": [{"category": "practice", "text": "Criminal lawyer"}]}},
        )
        body = client().get("/api/memory/cases/State%20v%20Pawar/turns/44444444-4444-4444-4444-444444444444").json()
        self.assertEqual(body["advocate"], [{"category": "practice", "text": "Criminal lawyer"}])


if __name__ == "__main__":
    unittest.main()
