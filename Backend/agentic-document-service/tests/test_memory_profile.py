"""Learning about the advocate across their cases: suggestions only, each one checked."""
from __future__ import annotations

import unittest
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import memory as memory_routes
from app.api.routes.rbac.auth import get_current_user
from app.services.memory import profile as prof
from app.services.memory.repository import VersionConflict
from app.services.memory.schemas import MemorySettings

NOW = datetime(2026, 9, 17, 12, 0, tzinfo=timezone.utc)


def case(key, case_type="Writ Petition", court="High Court", place="Aurangabad", area=None):
    return {"case_key": key, "case_type": case_type, "court_level": court, "jurisdiction": place, "primary_category": area}


def settings(**overrides):
    values = {"memory_profile_enabled": True, "memory_profile_interval_hours": 24,
              "memory_profile_model": "gemini-3.7-flash", "memory_profile_thinking_level": "medium"}
    values.update(overrides)
    return SimpleNamespace(**values)


class PracticeTests(unittest.TestCase):
    def test_fewer_than_three_cases_say_nothing(self) -> None:
        self.assertEqual(prof.practice_facts([case("1"), case("2")]), [])

    def test_what_most_cases_share_is_described_with_its_count(self) -> None:
        facts = {fact.field: fact for fact in prof.practice_facts([case("1"), case("2"), case("3", case_type="Bail")])}
        self.assertEqual(facts["court_level"].text, "Practises mainly before the High Court (3 of 3 cases)")
        self.assertEqual(facts["case_type"].text, "Mostly handles Writ Petition matters (2 of 3 cases)")
        self.assertEqual((facts["case_type"].count, facts["case_type"].total), (2, 3))

    def test_no_single_value_dominating_says_nothing_about_it(self) -> None:
        cases = [case("1", case_type="Bail"), case("2", case_type="Writ Petition"), case("3", case_type="Civil Suit"), case("4", case_type="Appeal")]
        self.assertNotIn("case_type", {fact.field for fact in prof.practice_facts(cases)})

    def test_a_renamed_place_counts_as_the_same_place(self) -> None:
        cases = [case("1", place="Aurangabad"), case("2", place="Chhatrapati Sambhajinagar"), case("3", place=None)]
        places = [fact for fact in prof.practice_facts(cases) if fact.field == "jurisdiction"]
        self.assertEqual((places[0].count, places[0].total), (2, 2))

    def test_blank_fields_are_not_counted(self) -> None:
        cases = [case("1", area=None), case("2", area=""), case("3", area="Revenue")]
        self.assertNotIn("primary_category", {fact.field for fact in prof.practice_facts(cases)})

    def test_every_practice_line_is_a_valid_fact_about_the_advocate(self) -> None:
        from app.services.memory.validator import validate_advocate_line

        for fact in prof.practice_facts([case("1"), case("2"), case("3"), case("4", area="Revenue"), case("5", area="Revenue")]):
            with self.subTest(fact=fact.text):
                self.assertIsNone(validate_advocate_line(fact.text, category="practice"))


class TimingTests(unittest.TestCase):
    def test_it_runs_once_a_day(self) -> None:
        with patch.object(prof, "get_settings", return_value=settings()):
            self.assertTrue(prof.due(None, now=NOW))
            self.assertFalse(prof.due(NOW - timedelta(hours=3), now=NOW))
            self.assertTrue(prof.due(NOW - timedelta(hours=25), now=NOW))

    def test_switched_off_never_runs(self) -> None:
        with patch.object(prof, "get_settings", return_value=settings(memory_profile_enabled=False)):
            self.assertFalse(prof.due(None, now=NOW))


class SharedRuleTests(unittest.TestCase):
    RULES = [
        {"case_key": "273", "text": "give me detailed answers"},
        {"case_key": "301", "text": "explain everything in detail"},
        {"case_key": "301", "text": "refer to my client as the Applicant"},
        {"case_key": "412", "text": "answer in Marathi"},
    ]

    def test_a_group_must_cite_two_known_cases(self) -> None:
        payload = '{"shared": [{"text": "Give detailed answers", "cases": ["273", "301", "999"]}, {"text": "Answer in Marathi", "cases": ["412"]}]}'
        shared = prof.parse_shared(payload, ["273", "301", "412"])
        self.assertEqual([(rule.text, rule.case_keys) for rule in shared], [("Give detailed answers", ("273", "301"))])

    def test_the_cases_are_checked_without_the_model(self) -> None:
        rule = prof.SharedRule(text="Give detailed answers", case_keys=("273", "301", "412"))
        self.assertEqual(prof.cases_backing(rule, self.RULES), {"273", "301"})

    def test_a_group_the_cases_do_not_back_is_caught(self) -> None:
        rule = prof.SharedRule(text="Present everything in tables", case_keys=("273", "301"))
        self.assertEqual(prof.cases_backing(rule, self.RULES), set())

    def test_unusable_output_raises(self) -> None:
        for bad in ("", "nope", '{"other": 1}'):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                prof.parse_shared(bad, ["273"])


class LearnTests(unittest.TestCase):
    """The whole look across cases, with the database and model mocked."""

    def run_learn(self, *, cases=None, rules=None, offered=None, advocate=None, universal=None, shared=None,
                  model_error=None, memory=None, learned_at=None, force=False, polished=None):
        with ExitStack() as stack:
            repo = lambda name, **kw: stack.enter_context(patch(f"app.services.memory.repository.{name}", **kw))  # noqa: E731
            stack.enter_context(patch.object(prof, "get_settings", return_value=settings()))
            mocks = {
                "settings": repo("effective_settings", return_value=memory or MemorySettings()),
                "learned_at": repo("get_learned_at", return_value=learned_at),
                "cases": repo("list_own_cases", return_value=cases if cases is not None else [case("273"), case("301"), case("412", case_type="Bail")]),
                "offered": repo("list_proposals", return_value=list(offered or [])),
                "advocate": repo("get_advocate_memory", return_value=advocate or {"lines": [], "forgotten": []}),
                "rules": repo("list_case_rules", return_value=list(rules if rules is not None else SharedRuleTests.RULES)),
                "user_proposals": repo("list_user_proposals", return_value=[]),
                "universal": repo("get_instruction_set", return_value={"items": [{"text": t} for t in universal or []]}),
                "add": repo("add_proposal", side_effect=lambda key, uid, kind, text, ref: f"p-{text[:6]}"),
                "mark": repo("mark_learned", return_value=None),
                "parties": stack.enter_context(patch("app.services.memory.parties.party_names_for_user", return_value=())),
                "model": stack.enter_context(patch.object(
                    prof, "ask_model",
                    **({"side_effect": model_error} if model_error else {"return_value": list(shared if shared is not None else [prof.SharedRule("Give detailed answers", ("273", "301"))])}),
                )),
                "polish": stack.enter_context(patch.object(prof, "_polish", return_value=polished)),
            }
            report = prof.learn("65", force=force, now=NOW)
        return report, mocks

    def added(self, mocks):
        return [(call.args[3], call.args[4]) for call in mocks["add"].call_args_list]

    def test_practice_and_shared_rules_become_suggestions(self) -> None:
        report, mocks = self.run_learn(polished="Give detailed answers in every case.")
        added = self.added(mocks)
        practice = [(text, ref) for text, ref in added if ref.get("target") == "advocate"]
        rules = [(text, ref) for text, ref in added if ref.get("kind") == "cross_case"]
        self.assertIn("Mostly handles Writ Petition matters (2 of 3 cases)", [text for text, _ in practice])
        self.assertEqual(practice[0][1]["category"], "practice")
        self.assertEqual(rules[0][1]["learned_from"], ["273", "301"])
        self.assertEqual(rules[0][1]["polished"], "Give detailed answers in every case.")
        self.assertTrue(all(call.args[2] == "preference" and call.args[0] == "user:65" for call in mocks["add"].call_args_list))
        self.assertTrue(report.ran)
        mocks["mark"].assert_called_once_with("65")

    def test_nothing_is_ever_saved_directly(self) -> None:
        with patch("app.services.memory.repository.add_advocate_line") as fact, \
                patch("app.services.memory.repository.add_instruction") as rule:
            self.run_learn()
        fact.assert_not_called()
        rule.assert_not_called()

    def test_not_due_does_nothing_unless_asked(self) -> None:
        report, mocks = self.run_learn(learned_at=NOW - timedelta(hours=2))
        self.assertEqual(report.skipped_reason, "not_due")
        mocks["cases"].assert_not_called()
        report, mocks = self.run_learn(learned_at=NOW - timedelta(hours=2), force=True)
        self.assertTrue(report.ran)

    def test_a_fact_already_known_or_forgotten_is_not_suggested(self) -> None:
        known = {"lines": [{"text": "Mostly handles Writ Petition matters (2 of 3 cases)"},
                           {"text": "Most cases are at Aurangabad (3 of 3 cases)"}],
                 "forgotten": ["Practises mainly before the High Court (3 of 3 cases)"]}
        _, mocks = self.run_learn(advocate=known, shared=[])
        self.assertEqual(self.added(mocks), [])

    def test_a_suggestion_dismissed_before_is_not_offered_again(self) -> None:
        offered = [
            {"text": "Mostly handles Writ Petition matters (2 of 3 cases)", "status": "rejected", "source_ref": {"target": "advocate"}},
            {"text": "Practises mainly before the High Court (3 of 3 cases)", "status": "rejected", "source_ref": {"target": "advocate"}},
            {"text": "Most cases are at Aurangabad (3 of 3 cases)", "status": "accepted", "source_ref": {"target": "advocate"}},
            {"text": "Give detailed answers", "status": "rejected", "source_ref": {"kind": "cross_case"}},
        ]
        _, mocks = self.run_learn(offered=offered)
        self.assertEqual(self.added(mocks), [])

    def test_a_rule_kept_in_one_case_only_is_refused(self) -> None:
        rules = [{"case_key": "273", "text": "give me detailed answers"}, {"case_key": "301", "text": "answer in Marathi"}]
        report, mocks = self.run_learn(rules=rules, shared=[prof.SharedRule("Give detailed answers", ("273", "301"))])
        self.assertNotIn("cross_case", [ref.get("kind") for _, ref in self.added(mocks)])
        self.assertIn("Give detailed answers", report.refused)

    def test_a_rule_already_for_all_cases_is_not_suggested(self) -> None:
        _, mocks = self.run_learn(universal=["Give detailed answers"])
        self.assertNotIn("cross_case", [ref.get("kind") for _, ref in self.added(mocks)])

    def test_rules_from_one_case_only_never_reach_the_model(self) -> None:
        _, mocks = self.run_learn(rules=[{"case_key": "273", "text": "give me detailed answers"}])
        mocks["model"].assert_not_called()

    def test_a_model_failure_still_suggests_the_practice(self) -> None:
        report, mocks = self.run_learn(model_error=RuntimeError("quota"))
        self.assertIn("model_unavailable", report.refused)
        self.assertTrue(report.practice_suggested)
        mocks["mark"].assert_called_once()

    def test_each_switch_is_respected(self) -> None:
        _, mocks = self.run_learn(memory=MemorySettings(advocate_enabled=False))
        self.assertNotIn("advocate", [ref.get("target") for _, ref in self.added(mocks)])
        _, mocks = self.run_learn(memory=MemorySettings(instructions_enabled=False))
        mocks["model"].assert_not_called()
        report, mocks = self.run_learn(memory=MemorySettings(write_enabled=False))
        self.assertEqual(report.skipped_reason, "disabled_by_user")
        mocks["cases"].assert_not_called()

    def test_a_database_failure_never_raises(self) -> None:
        with patch("app.services.memory.repository.effective_settings", side_effect=RuntimeError("db down")), \
                patch.object(prof, "get_settings", return_value=settings()):
            report = prof.learn("65", force=True)
        self.assertEqual(report.skipped_reason, "error")

    def test_an_anonymous_user_is_skipped(self) -> None:
        with patch.object(prof, "get_settings", return_value=settings()):
            self.assertEqual(prof.learn("anonymous").skipped_reason, "no_user")


class RouteTests(unittest.TestCase):
    USER = {"id": 65, "name": "Adv", "email": "a@x.in", "role": "user", "account_type": "SOLO"}

    def client(self) -> TestClient:
        app = FastAPI()
        app.include_router(memory_routes.router)
        app.dependency_overrides[get_current_user] = lambda: self.USER
        return TestClient(app)

    PROPOSAL = {"id": "p1", "status": "pending", "kind": "preference",
                "text": "Mostly handles Writ Petition matters (2 of 3 cases)",
                "source_ref": {"target": "advocate", "category": "practice", "kind": "profile"}}

    def accept(self, proposal, **patches):
        with ExitStack() as stack:
            mocks = {name: stack.enter_context(patch.object(memory_routes.repository, name, **kw)) for name, kw in {
                "get_proposal": {"return_value": proposal},
                "set_proposal_status": {"return_value": True},
                "get_advocate_memory": {"return_value": {"version": 4, "lines": []}},
                "add_advocate_line": {"return_value": {"version": 5, "line": {"id": "a1"}}},
                "add_instruction": {"return_value": {"version": 2, "item": {"id": "i1"}}},
                "get_instruction_set": {"return_value": {"items": []}},
                **patches,
            }.items()}
            stack.enter_context(patch.object(memory_routes, "_party_names", return_value=()))
            response = self.client().post("/api/memory/suggestions/p1/accept", json={})
        return response, mocks

    def test_an_about_you_suggestion_is_added_to_the_advocates_facts(self) -> None:
        response, mocks = self.accept(self.PROPOSAL)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["scope"], "advocate")
        args, kwargs = mocks["add_advocate_line"].call_args
        self.assertEqual(args[:4], ("65", "practice", "Mostly handles Writ Petition matters (2 of 3 cases)", 4))
        self.assertEqual(kwargs["source_ref"]["from"], "cases")
        mocks["add_instruction"].assert_not_called()
        mocks["set_proposal_status"].assert_called_once_with("user:65", "p1", "accepted")

    def test_an_edit_that_breaks_the_rules_for_facts_is_refused(self) -> None:
        response, mocks = self.accept(self.PROPOSAL)
        with ExitStack() as stack:
            for name, value in {"get_proposal": self.PROPOSAL, "get_advocate_memory": {"version": 4, "lines": []}}.items():
                stack.enter_context(patch.object(memory_routes.repository, name, return_value=value))
            add = stack.enter_context(patch.object(memory_routes.repository, "add_advocate_line"))
            stack.enter_context(patch.object(memory_routes, "_party_names", return_value=()))
            bad = self.client().post("/api/memory/suggestions/p1/accept", json={"text": "Handles WP 1234/2024 for the petitioner"})
        self.assertEqual(bad.status_code, 422)
        add.assert_not_called()

    def test_a_rule_suggestion_still_becomes_a_standing_instruction(self) -> None:
        rule = {"id": "p1", "status": "pending", "kind": "preference", "text": "Give detailed answers",
                "source_ref": {"kind": "cross_case", "learned_from": ["273", "301"]}}
        response, mocks = self.accept(rule)
        self.assertEqual(response.json()["scope"], "user")
        mocks["add_advocate_line"].assert_not_called()
        mocks["add_instruction"].assert_called_once()

    def test_the_look_now_route_forces_a_run(self) -> None:
        outcome = prof.LearnReport(ran=True, practice_suggested=["Mostly handles Writ Petition matters (2 of 3 cases)"])
        with patch.object(prof, "learn", return_value=outcome) as learn, \
                patch.object(memory_routes.repository, "list_proposals", return_value=[{"id": "p1"}]):
            response = self.client().post("/api/memory/advocate/learn")
        learn.assert_called_once_with("65", force=True)
        body = response.json()
        self.assertEqual((body["ran"], body["proposals"]), (True, [{"id": "p1"}]))


if __name__ == "__main__":
    unittest.main()
