"""The post-turn memory writer: what it files, what it refuses, and how it fails."""
from __future__ import annotations

import unittest
from contextlib import ExitStack, contextmanager
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from app.services.memory import writer as writer_mod
from app.services.memory.recall import RecallHit
from app.services.memory.repository import VersionConflict
from app.services.memory.schemas import MemoryLine, MemoryOp, MemoryOps, MemoryProposal, MemorySettings
from app.services.memory.scope import CaseScope
from app.services.memory.writer import (
    SNAPSHOT_CHARS,
    Extraction,
    TurnContext,
    TurnInput,
    WriteReport,
    build_extractor_input,
    draft_status_line,
    extract_ops,
    has_standing_rule,
    is_grounded,
    parse_extraction,
    render_snapshot,
    run_post_turn,
    submit_post_turn,
    turn_context,
    turn_skip_reason,
)

TODAY = date(2026, 9, 11)
CHAT = "44444444-4444-4444-4444-444444444444"
SCOPE = CaseScope(case_key="512", folder_name="State_v_Pawar", user_id="42", case_id="512")

HEART = "My client Sunil Pawar has a heart condition, that is the medical ground."
MEDICAL_LINE = "Medical ground to be pleaded: accused's cardiac condition"


def op(
    text: str,
    *,
    section: str = "facts",
    tag: str = "stated",
    kind: str = "append_line",
    line_id: str | None = None,
    changed: bool = False,
    sensitive: bool = False,
    source: str = "user",
    document: str | None = None,
) -> MemoryOp:
    return MemoryOp(
        op=kind,
        section=section,
        line_id=line_id,
        reason="test",
        line=MemoryLine(
            tag=tag, text=text, source=source, document=document, changed=changed, sensitive=sensitive
        ),
    )


def turn(message: str, **overrides) -> TurnInput:
    base = dict(
        scope=SCOPE,
        question_raw=message,
        answer="Noted.",
        session_id="s-1",
        chat_id=CHAT,
        mode="chat",
        model="gemini-2.5-pro",
        log_entry={"case_key": "512", "user_id": "42", "mode": "chat"},
    )
    base.update(overrides)
    return TurnInput(**base)


def recall_hit(chat_id: str, *, session: str = "s-1", question: str = "", answer: str = "Answer.", saved: bool = False):
    return RecallHit(
        chat_id=chat_id,
        session_id=session,
        created_at="2026-09-11T08:00:00",
        question=question,
        answer=answer,
        prompt_label=None,
        used_saved_prompt=saved,
    )


def _apply_ok():
    counter = {"n": 0}

    def apply(key, resolved, expected=None, actor=None, folder_name=None, source_ref_extra=None):
        counter["n"] += 1
        return {"section": resolved.section, "version": (expected or 1) + 1, "line_id": f"new-{counter['n']}"}

    return apply


def _put_ok(key, content, version, updated_by=None, folder_name=None):
    return {"content": content, "version": (version or 0) + 1}


@contextmanager
def harness(
    *,
    stored=None,
    settings=None,
    extraction=None,
    extract_error=None,
    apply=None,
    instructions=None,
    instructions_rows=None,
    preferences=None,
    available=True,
    write_enabled=True,
    history=None,
    put_instructions=None,
    turns=None,
    turns_error=None,
    seeded=None,
    seed_error=None,
):
    mocks = {}
    with ExitStack() as stack:
        def repo(name, **kwargs):
            mocks[name] = stack.enter_context(patch.object(writer_mod.repository, name, **kwargs))

        def module(name, **kwargs):
            mocks[name] = stack.enter_context(patch.object(writer_mod, name, **kwargs))

        module(
            "get_settings",
            return_value=SimpleNamespace(memory_write_enabled=write_enabled, memory_extraction_model="gemini-2.5-flash"),
        )
        repo("available", return_value=available)
        repo("effective_settings", return_value=settings or MemorySettings())
        repo("get_sections", return_value=stored or {})
        repo("apply_op", side_effect=apply if apply is not None else _apply_ok())
        repo(
            "append_lines",
            side_effect=lambda key, section, lines, actor=None, folder_name=None: {
                "section": section, "version": 2, "added": len(lines)
            },
        )
        repo("add_proposal", return_value="proposal-1")
        if instructions_rows is not None:
            repo("get_instructions", side_effect=list(instructions_rows))
        else:
            repo("get_instructions", return_value={"content": instructions} if instructions else None)
        repo("get_preferences", return_value={"content": preferences} if preferences else None)
        repo("list_proposals", return_value=list(history or []))
        repo("put_instructions", side_effect=put_instructions if put_instructions is not None else _put_ok)
        repo("write_assembly_log", return_value="log-1")
        if turns_error is not None:
            module("recent_turns", side_effect=turns_error)
        else:
            module("recent_turns", return_value=list(turns or []))
        if seed_error is not None:
            module("refresh_seed", side_effect=seed_error)
        else:
            module("refresh_seed", return_value=seeded)
        if extract_error is not None:
            module("extract_ops", side_effect=extract_error)
        else:
            module("extract_ops", return_value=extraction or Extraction(nothing_durable=True))
        yield mocks


def run(message: str, **kwargs) -> tuple[WriteReport, dict]:
    turn_overrides = kwargs.pop("turn", {})
    with harness(**kwargs) as mocks:
        report = run_post_turn(turn(message, **turn_overrides), today=TODAY)
    return report, mocks


def logged(mocks) -> dict:
    return mocks["write_assembly_log"].call_args.args[0]


class GroundingTests(unittest.TestCase):
    def test_a_rewording_of_the_advocates_message_is_grounded(self) -> None:
        self.assertTrue(is_grounded(MEDICAL_LINE, HEART))

    def test_a_claim_that_only_the_answer_made_is_not(self) -> None:
        self.assertFalse(
            is_grounded(
                "Remand order notes investigation substantially complete",
                "Draft the bail application, add the medical ground we discussed.",
            )
        )

    def test_dates_and_framing_words_do_not_count_against_a_decision(self) -> None:
        self.assertTrue(
            is_grounded(
                "Decision 2026-09-09: drop alibi ground; lead with absence of mens rea",
                "Let's not press the alibi, it is weak. Focus on absence of mens rea.",
            )
        )

    def test_a_line_with_no_meaningful_words_is_not_grounded(self) -> None:
        self.assertFalse(is_grounded("Age 47", "He is 47 years old"))


class StandingRuleTests(unittest.TestCase):
    def test_rule_words_are_recognised(self) -> None:
        for text in (
            "Always cite SCC first",
            "From now on, answer in a table",
            "Going forward use Marathi for the client letters",
            "Never use Latin maxims",
            "Remember to add the cause title",
            "Every time I ask for dates, give a table",
            "In all drafts, number the paragraphs",
            "Don't ever call the respondent a fraudster",
        ):
            with self.subTest(text=text):
                self.assertTrue(has_standing_rule(text))

    def test_ordinary_requests_are_not_rules(self) -> None:
        for text in ("Give me tabular events output", "Summarise this case", "Show this as a table", "", None):
            with self.subTest(text=text):
                self.assertFalse(has_standing_rule(text))


class SkipReasonTests(unittest.TestCase):
    def test_messages_without_durable_content_are_skipped(self) -> None:
        cases = {
            "hi": "greeting",
            "Thanks!": "greeting",
            "ok do it": "too_short",
            "   ": "no_message",
        }
        for message, reason in cases.items():
            with self.subTest(message=message):
                self.assertEqual(turn_skip_reason(turn(message)), reason)

    def test_saved_prompts_and_special_modes_are_skipped(self) -> None:
        self.assertEqual(turn_skip_reason(turn(HEART, saved_prompt=True)), "saved_prompt")
        self.assertEqual(turn_skip_reason(turn(HEART, mode="learning")), "mode_learning")
        self.assertEqual(turn_skip_reason(turn(HEART, mode="deep_research")), "mode_deep_research")

    def test_a_real_message_is_not_skipped(self) -> None:
        self.assertIsNone(turn_skip_reason(turn(HEART)))


class RunSkipTests(unittest.TestCase):
    def test_nothing_is_written_while_memory_generation_is_off(self) -> None:
        report, mocks = run(HEART, settings=MemorySettings(write_enabled=False))
        self.assertEqual(report.skipped_reason, "disabled_by_user")
        mocks["extract_ops"].assert_not_called()
        mocks["apply_op"].assert_not_called()
        mocks["refresh_seed"].assert_not_called()
        self.assertIn("write:disabled_by_user", logged(mocks)["skipped_reason"])

    def test_the_deployment_kill_switch_wins(self) -> None:
        report, mocks = run(HEART, write_enabled=False)
        self.assertEqual(report.skipped_reason, "disabled_globally")
        mocks["extract_ops"].assert_not_called()

    def test_an_anonymous_user_writes_nothing(self) -> None:
        anonymous = CaseScope(case_key="512", folder_name="State_v_Pawar", user_id="anonymous")
        report, mocks = run(HEART, turn={"scope": anonymous})
        self.assertEqual(report.skipped_reason, "no_scope")
        mocks["effective_settings"].assert_not_called()

    def test_no_scope_writes_no_log_either(self) -> None:
        report, mocks = run(HEART, turn={"scope": None, "log_entry": {}})
        self.assertEqual(report.skipped_reason, "no_scope")
        mocks["write_assembly_log"].assert_not_called()

    def test_a_greeting_never_reaches_the_model(self) -> None:
        report, mocks = run("hello")
        self.assertEqual(report.skipped_reason, "greeting")
        mocks["extract_ops"].assert_not_called()

    def test_a_saved_prompt_never_reaches_the_model(self) -> None:
        report, mocks = run("Summarise the case in 14 sections with a chronology", turn={"saved_prompt": True})
        self.assertEqual(report.skipped_reason, "saved_prompt")
        mocks["extract_ops"].assert_not_called()


class WriteTests(unittest.TestCase):
    def test_a_stated_fact_is_written_with_the_turn_it_came_from(self) -> None:
        report, mocks = run(HEART, extraction=Extraction(ops=[op(MEDICAL_LINE, sensitive=True)]))
        self.assertEqual(report.writes, 1)
        call = mocks["apply_op"].call_args
        self.assertEqual(call.args[0], "512")
        self.assertEqual(call.args[1].op, "append_line")
        self.assertEqual(call.args[1].tag, "stated")
        self.assertEqual(call.kwargs["source_ref_extra"], {"kind": "chat", "session_id": "s-1", "chat_id": CHAT})
        entry = logged(mocks)
        self.assertEqual((entry["writes"], entry["chat_id"], entry["case_key"]), (1, CHAT, "512"))

    def test_the_turn_log_lists_the_lines_written(self) -> None:
        _, mocks = run(HEART, extraction=Extraction(ops=[op(MEDICAL_LINE)]))
        self.assertEqual(
            logged(mocks)["details"]["lines"],
            [{"section": "facts", "tag": "stated", "text": MEDICAL_LINE, "updated": False}],
        )

    def test_a_decision_hidden_in_a_request_is_written(self) -> None:
        message = "Let's not press the alibi, it is weak. Focus on absence of mens rea and draft it."
        report, mocks = run(
            message,
            extraction=Extraction(
                ops=[op("Decision 2026-09-11: drop alibi ground; lead with absence of mens rea", section="decisions")]
            ),
        )
        self.assertEqual(report.writes, 1)
        self.assertEqual(mocks["apply_op"].call_args.args[1].section, "decisions")

    def test_document_facts_are_never_filed_from_a_chat(self) -> None:
        report, mocks = run(
            "The remand order says the investigation is substantially complete.",
            extraction=Extraction(
                ops=[
                    op(
                        "Remand order notes investigation substantially complete",
                        tag="extracted",
                        source="document",
                        document="remand-order.pdf",
                    )
                ]
            ),
        )
        mocks["apply_op"].assert_not_called()
        self.assertEqual(report.rejection_codes, ["extracted_from_chat"])

    def test_only_single_line_operations_are_allowed(self) -> None:
        line = MemoryLine(tag="stated", text=MEDICAL_LINE)
        ops = [
            MemoryOp(op="rewrite_section", section="summary", lines=[line]),
            MemoryOp(op="create_section", section="facts", lines=[line]),
            MemoryOp(op="delete_section", section="facts"),
        ]
        report, mocks = run(HEART, extraction=Extraction(ops=ops))
        mocks["apply_op"].assert_not_called()
        self.assertEqual(report.rejection_codes, ["writer_op_not_allowed"] * 3)

    def test_a_claim_only_the_answer_made_is_refused_and_the_reason_kept(self) -> None:
        report, mocks = run(
            "Draft the bail application, add the medical ground we discussed.",
            extraction=Extraction(ops=[op("Investigation is substantially complete per remand order")]),
        )
        mocks["apply_op"].assert_not_called()
        self.assertEqual(report.rejection_codes, ["not_in_advocate_message"])
        self.assertEqual(logged(mocks)["details"], {"rejection_codes": ["not_in_advocate_message"]})

    def test_an_already_recorded_fact_is_not_written_again(self) -> None:
        stored = {"facts": {"version": 3, "lines": [{"id": "l1", "tag": "stated", "text": MEDICAL_LINE}]}}
        report, mocks = run(HEART, stored=stored, extraction=Extraction(ops=[op(MEDICAL_LINE)]))
        mocks["apply_op"].assert_not_called()
        self.assertEqual(report.rejection_codes, ["duplicate"])

    def test_a_changed_fact_updates_its_line_and_keeps_the_earlier_value(self) -> None:
        stored = {
            "facts": {
                "version": 3,
                "lines": [{"id": "l1", "tag": "stated", "text": "Custody: police custody since 22-08-2026"}],
            }
        }
        report, mocks = run(
            "Custody is now judicial, since 24-08-2026.",
            stored=stored,
            extraction=Extraction(
                ops=[op("Custody: judicial since 24-08-2026", kind="replace_line", line_id="l1", changed=True)]
            ),
        )
        self.assertEqual(report.writes, 1)
        call = mocks["apply_op"].call_args
        self.assertEqual(call.args[2], 3)
        resolved = call.args[1]
        self.assertEqual((resolved.op, resolved.line_id), ("replace_line", "l1"))
        self.assertEqual(
            resolved.text,
            "Custody: judicial since 24-08-2026 (earlier: Custody: police custody since 22-08-2026; updated 2026-09-11)",
        )

    def test_sensitive_details_are_dropped_when_turned_off(self) -> None:
        report, mocks = run(
            HEART,
            settings=MemorySettings(sensitive_enabled=False),
            extraction=Extraction(ops=[op(MEDICAL_LINE, sensitive=True)]),
        )
        mocks["apply_op"].assert_not_called()
        self.assertEqual(report.rejection_codes, ["sensitive_disabled"])

    def test_two_ops_for_the_same_fact_in_one_turn_write_once(self) -> None:
        report, mocks = run(HEART, extraction=Extraction(ops=[op(MEDICAL_LINE), op(MEDICAL_LINE)]))
        self.assertEqual(mocks["apply_op"].call_count, 1)
        self.assertEqual(report.writes, 1)

    def test_every_write_and_proposal_targets_this_case_only(self) -> None:
        message = "My client has a heart condition, that is the medical ground. Always cite SCC first in this matter."
        run_report, mocks = run(
            message,
            extraction=Extraction(
                ops=[op(MEDICAL_LINE), op("Client has a heart condition", section="parties")],
                proposals=[MemoryProposal(kind="instruction", text="Always cite SCC first in this matter")],
            ),
        )
        self.assertGreater(run_report.writes, 0)
        self.assertEqual({call.args[0] for call in mocks["apply_op"].call_args_list}, {"512"})
        self.assertEqual(mocks["put_instructions"].call_args.args[0], "512")
        self.assertEqual(mocks["add_proposal"].call_args.args[0], "512")
        self.assertEqual(mocks["list_proposals"].call_args.args[0], "512")


class ConflictTests(unittest.TestCase):
    def test_a_version_conflict_is_retried_once_against_the_fresh_section(self) -> None:
        apply = [
            VersionConflict("facts", None, 4, [{"id": "x1", "tag": "stated", "text": "Bail hearing listed"}]),
            {"section": "facts", "version": 5, "line_id": "n1"},
        ]
        report, mocks = run(HEART, apply=apply, extraction=Extraction(ops=[op(MEDICAL_LINE)]))
        self.assertEqual(report.writes, 1)
        self.assertEqual(mocks["apply_op"].call_count, 2)
        self.assertEqual(mocks["apply_op"].call_args_list[1].args[2], 4)

    def test_a_second_conflict_drops_the_write_without_raising(self) -> None:
        apply = [VersionConflict("facts", None, 4, []), VersionConflict("facts", 4, 5, [])]
        report, _ = run(HEART, apply=apply, extraction=Extraction(ops=[op(MEDICAL_LINE)]))
        self.assertEqual(report.writes, 0)
        self.assertIn("version_conflict", report.rejection_codes)

    def test_a_conflict_showing_the_fact_was_just_written_writes_nothing_more(self) -> None:
        apply = [VersionConflict("facts", None, 2, [{"id": "x1", "tag": "stated", "text": MEDICAL_LINE}])]
        report, mocks = run(HEART, apply=apply, extraction=Extraction(ops=[op(MEDICAL_LINE)]))
        self.assertEqual(mocks["apply_op"].call_count, 1)
        self.assertEqual(report.writes, 0)
        self.assertIn("duplicate", report.rejection_codes)


class InstructionFromChatTests(unittest.TestCase):
    RULE = "Always cite SCC first in this matter"

    def extraction(self, text: str = RULE, kind: str = "instruction") -> Extraction:
        return Extraction(proposals=[MemoryProposal(kind=kind, text=text)])

    def test_an_explicit_standing_instruction_is_saved_to_the_case_instructions(self) -> None:
        report, mocks = run(
            "Always cite SCC first in this matter.",
            instructions="Refer to the accused as the Applicant.",
            extraction=self.extraction(),
        )
        mocks["apply_op"].assert_not_called()
        key, content, version = mocks["put_instructions"].call_args.args[:3]
        self.assertEqual(key, "512")
        self.assertEqual(content, f"Refer to the accused as the Applicant.\n{self.RULE}")
        self.assertIsNone(version)
        self.assertEqual(mocks["put_instructions"].call_args.kwargs["updated_by"], writer_mod.WRITER_ACTOR)

        record = mocks["add_proposal"].call_args
        self.assertEqual(record.args[:4], ("512", "42", "instruction", self.RULE))
        self.assertTrue(record.args[4]["auto"])
        self.assertEqual(record.args[4]["chat_id"], CHAT)
        self.assertEqual(record.kwargs["status"], "accepted")

        self.assertEqual((report.instructions_saved, report.writes, report.proposals), (1, 1, 0))
        saved = logged(mocks)["details"]["instructions"]
        self.assertEqual(saved, [{"id": "proposal-1", "text": self.RULE, "version": 1}])

    def test_a_rule_without_a_rule_word_becomes_a_suggestion(self) -> None:
        text = "Cite SCC first in this matter"
        report, mocks = run(f"{text}.", extraction=self.extraction(text))
        mocks["put_instructions"].assert_not_called()
        suggestion = mocks["add_proposal"].call_args
        self.assertEqual(suggestion.args[:4], ("512", "42", "instruction", text))
        self.assertNotIn("status", suggestion.kwargs)
        self.assertEqual(report.proposals, 1)
        self.assertEqual(logged(mocks)["details"]["suggestions"][0]["text"], text)

    def test_a_stray_rule_word_in_a_statement_does_not_save_an_instruction(self) -> None:
        message = "The bank never disbursed the loan, draft the reply to the notice."
        report, mocks = run(message, extraction=self.extraction("Draft the reply to the notice"))
        mocks["put_instructions"].assert_not_called()
        self.assertEqual(report.proposals, 1)

    def test_with_instructions_switched_off_a_rule_is_only_suggested(self) -> None:
        report, mocks = run(
            "Always cite SCC first in this matter.",
            settings=MemorySettings(instructions_enabled=False),
            extraction=self.extraction(),
        )
        mocks["put_instructions"].assert_not_called()
        self.assertEqual(report.proposals, 1)

    def test_a_preference_for_all_work_is_suggested_not_saved(self) -> None:
        text = "In all my matters, always cite SCC first"
        report, mocks = run(f"{text}.", extraction=self.extraction(text, kind="preference"))
        mocks["put_instructions"].assert_not_called()
        self.assertEqual(mocks["add_proposal"].call_args.args[2], "preference")
        self.assertEqual(report.proposals, 1)

    def test_instructions_changed_meanwhile_are_reread_and_saved_once(self) -> None:
        rows = [
            {"content": "", "version": 2},  # read for the proposal checks
            {"content": "", "version": 2},  # first save attempt
            {"content": "Use Marathi.", "version": 3},  # after the conflict
        ]
        put = [VersionConflict("instructions", 2, 3), {"content": f"Use Marathi.\n{self.RULE}", "version": 4}]
        report, mocks = run(
            "Always cite SCC first in this matter.",
            instructions_rows=rows,
            put_instructions=put,
            extraction=self.extraction(),
        )
        self.assertEqual(mocks["put_instructions"].call_count, 2)
        self.assertEqual(mocks["put_instructions"].call_args.args[1:3], (f"Use Marathi.\n{self.RULE}", 3))
        self.assertEqual(report.instructions_saved, 1)

    def test_an_instruction_the_advocate_undid_is_suggested_instead(self) -> None:
        history = [
            {"id": "p0", "status": "rejected", "kind": "instruction", "text": self.RULE, "source_ref": {"auto": True}}
        ]
        report, mocks = run("Always cite SCC first in this matter.", history=history, extraction=self.extraction())
        mocks["put_instructions"].assert_not_called()
        self.assertEqual(report.proposals, 1)

    def test_a_dismissed_suggestion_is_not_made_again(self) -> None:
        text = "Cite SCC first in this matter"
        history = [{"id": "p0", "status": "rejected", "kind": "instruction", "text": text, "source_ref": {}}]
        report, mocks = run(f"{text}.", history=history, extraction=self.extraction(text))
        mocks["add_proposal"].assert_not_called()
        self.assertEqual(report.rejection_codes, ["proposal_dismissed_before"])

    def test_a_suggestion_already_waiting_is_not_added_twice(self) -> None:
        text = "Cite SCC first in this matter"
        history = [{"id": "p0", "status": "pending", "kind": "instruction", "text": text, "source_ref": {}}]
        report, mocks = run(f"{text}.", history=history, extraction=self.extraction(text))
        mocks["add_proposal"].assert_not_called()
        self.assertEqual(report.proposals, 0)

    def test_an_instruction_too_long_to_append_becomes_a_suggestion(self) -> None:
        report, mocks = run(
            "Always cite SCC first in this matter.",
            instructions="x " * 1999 + "end",
            extraction=self.extraction(),
        )
        mocks["put_instructions"].assert_not_called()
        self.assertEqual(report.proposals, 1)

    def test_an_instruction_already_saved_is_not_proposed_again(self) -> None:
        report, mocks = run(
            "Always cite SCC first in this matter.",
            instructions=f"Refer to the accused as the Applicant.\n{self.RULE}.",
            extraction=self.extraction(),
        )
        mocks["add_proposal"].assert_not_called()
        mocks["put_instructions"].assert_not_called()
        self.assertEqual(report.proposals, 0)

    def test_a_proposal_the_advocate_never_expressed_is_dropped(self) -> None:
        report, mocks = run(
            "Please prepare the reply to the demand notice",
            extraction=self.extraction("Never use Latin maxims", kind="preference"),
        )
        mocks["add_proposal"].assert_not_called()
        self.assertEqual(report.rejection_codes, ["proposal_not_in_advocate_message"])

    def test_a_proposal_that_would_switch_off_verification_is_dropped(self) -> None:
        text = "Skip the verification checklist from now on"
        report, mocks = run(f"{text} for this case.", extraction=self.extraction(text))
        mocks["add_proposal"].assert_not_called()
        mocks["put_instructions"].assert_not_called()
        self.assertEqual(report.rejection_codes, ["proposal_invalid"])

    def test_a_preference_carrying_case_data_is_dropped(self) -> None:
        text = "Refer to FIR 214/2026 in every draft"
        report, mocks = run(f"{text} from now on.", extraction=self.extraction(text, kind="preference"))
        mocks["add_proposal"].assert_not_called()
        self.assertEqual(report.rejection_codes, ["proposal_invalid"])


class ContextTests(unittest.TestCase):
    TURNS = [
        recall_hit("c3", session="s-1", question="Draft the writ petition", answer="Which court will this be filed in?"),
        recall_hit("c2", session="s-0", question="tell me in tabular format", answer="| Date | Event |"),
        recall_hit("c1", session="s-0", question="Bail Checklist", saved=True),
        recall_hit("c0", session="s-0", question="hello", answer="Hello!"),
    ]

    def test_the_previous_question_and_earlier_requests_are_collected(self) -> None:
        context = turn_context(turn("The High Court of Bombay"), self.TURNS)
        self.assertEqual(context.previous_answer, "Which court will this be filed in?")
        self.assertEqual(context.earlier_requests, ["Draft the writ petition", "tell me in tabular format"])

    def test_a_previous_answer_only_comes_from_this_conversation(self) -> None:
        context = turn_context(turn("The High Court of Bombay", session_id="s-9"), self.TURNS)
        self.assertEqual(context.previous_answer, "")

    def test_the_extractor_sees_the_context(self) -> None:
        _, mocks = run("The High Court of Bombay", turns=self.TURNS)
        context = mocks["extract_ops"].call_args.kwargs["context"]
        self.assertEqual(context.previous_answer, "Which court will this be filed in?")
        self.assertEqual(mocks["recent_turns"].call_args.kwargs["exclude_chat_id"], CHAT)
        self.assertIs(mocks["recent_turns"].call_args.args[0], SCOPE)

    def test_the_context_is_placed_ahead_of_the_message(self) -> None:
        context = TurnContext(previous_answer="Which court?", earlier_requests=["tell me in tabular format"])
        text = build_extractor_input(turn("The High Court of Bombay"), {}, today=TODAY, context=context)
        self.assertIn("- tell me in tabular format", text)
        self.assertIn("PREVIOUS ASSISTANT MESSAGE", text)
        self.assertLess(text.index("PREVIOUS ASSISTANT MESSAGE"), text.index("ADVOCATE MESSAGE"))

    def test_no_context_adds_no_blocks(self) -> None:
        text = build_extractor_input(turn(HEART), {}, today=TODAY, context=TurnContext())
        self.assertNotIn("EARLIER REQUESTS", text)
        self.assertNotIn("PREVIOUS ASSISTANT MESSAGE", text)

    def test_unavailable_history_does_not_stop_extraction(self) -> None:
        report, mocks = run(HEART, turns_error=RuntimeError("db down"), extraction=Extraction(ops=[op(MEDICAL_LINE)]))
        self.assertEqual(report.writes, 1)
        self.assertEqual(mocks["extract_ops"].call_args.kwargs["context"], TurnContext())


class SeedingTests(unittest.TestCase):
    def test_a_case_fills_from_its_details_even_on_a_greeting(self) -> None:
        report, mocks = run("hello", seeded={"added": 7, "updated": 1, "skipped_reason": None})
        self.assertIs(mocks["refresh_seed"].call_args.args[0], SCOPE)
        self.assertEqual(report.writes, 8)
        self.assertEqual(report.skipped_reason, "greeting")
        self.assertEqual(logged(mocks)["details"]["seeded"], {"added": 7, "updated": 1})

    def test_a_check_that_found_nothing_new_adds_nothing_to_the_log(self) -> None:
        _, mocks = run("hello", seeded=None)
        self.assertNotIn("seeded", logged(mocks)["details"])

    def test_a_seeding_failure_is_contained(self) -> None:
        report, _ = run(
            HEART, seed_error=RuntimeError("chronology unavailable"), extraction=Extraction(ops=[op(MEDICAL_LINE)])
        )
        self.assertEqual(report.writes, 1)


class DraftTests(unittest.TestCase):
    TEMPLATE = "gs://bucket/42/templates/3f2a9c1e-1111-2222-3333-444455556666_Bail_Template.pdf"

    def test_a_draft_turn_records_its_status_line(self) -> None:
        report, mocks = run("Draft it", turn={"mode": "draft", "draft_template": self.TEMPLATE})
        section, lines = mocks["append_lines"].call_args.args[1:3]
        self.assertEqual(section, "drafting_log")
        self.assertEqual(lines[0]["tag"], "status")
        self.assertEqual(lines[0]["text"], "Draft generated from template 'Bail_Template.pdf' on 2026-09-11")
        self.assertEqual(report.writes, 1)
        self.assertEqual(logged(mocks)["details"]["lines"][0]["section"], "drafting_log")
        # "Draft it" carries no facts, so the model is never asked.
        self.assertEqual(report.skipped_reason, "too_short")
        mocks["extract_ops"].assert_not_called()

    def test_a_draft_request_that_carries_a_decision_is_still_read(self) -> None:
        message = "Go with the caregiver ground and draft the bail application."
        report, mocks = run(
            message,
            turn={"mode": "draft", "draft_template": self.TEMPLATE},
            extraction=Extraction(ops=[op("Decision: use the caregiver ground", section="decisions")]),
        )
        mocks["extract_ops"].assert_called_once()
        self.assertEqual(report.writes, 2)

    def test_a_template_name_that_looks_like_an_identifier_is_not_stored(self) -> None:
        line = draft_status_line("gs://bucket/4111111111111111.pdf", today=TODAY)
        self.assertEqual(line, "Draft generated from an uploaded template on 2026-09-11")

    def test_a_name_left_empty_once_the_id_is_removed_falls_back(self) -> None:
        line = draft_status_line("gs://bucket/3f2a9c1e-1111-2222-3333-444455556666_.pdf", today=TODAY)
        self.assertEqual(line, "Draft generated from an uploaded template on 2026-09-11")

    def test_a_numeric_prefix_is_removed_from_a_real_name(self) -> None:
        line = draft_status_line("gs://bucket/1726123456_Bail_Application.docx", today=TODAY)
        self.assertEqual(line, "Draft generated from template 'Bail_Application.docx' on 2026-09-11")


class FailureTests(unittest.TestCase):
    def test_an_extractor_failure_never_raises_and_is_logged(self) -> None:
        report, mocks = run(HEART, extract_error=RuntimeError("quota exceeded"))
        self.assertEqual(report.skipped_reason, "extractor_error")
        self.assertIn("write:extractor_error", logged(mocks)["skipped_reason"])

    def test_nothing_durable_writes_nothing(self) -> None:
        report, mocks = run(HEART, extraction=Extraction(nothing_durable=True))
        self.assertEqual(report.skipped_reason, "nothing_durable")
        mocks["apply_op"].assert_not_called()

    def test_invalid_ops_from_the_model_are_counted(self) -> None:
        report, _ = run(HEART, extraction=Extraction(ops=[op(MEDICAL_LINE)], invalid=2))
        self.assertEqual(report.writes, 1)
        self.assertEqual(report.rejection_codes.count("invalid_op"), 2)

    def test_an_unexpected_failure_is_contained(self) -> None:
        with harness() as mocks:
            mocks["effective_settings"].side_effect = RuntimeError("db down")
            report = run_post_turn(turn(HEART), today=TODAY)
        self.assertEqual(report.skipped_reason, "writer_error")

    def test_the_read_and_write_outcomes_share_one_log_row(self) -> None:
        report, mocks = run(
            "hello",
            turn={"log_entry": {"case_key": "512", "user_id": "42", "skipped_reason": "nothing_stored"}},
        )
        self.assertEqual(mocks["write_assembly_log"].call_count, 1)
        self.assertEqual(logged(mocks)["skipped_reason"], "read:nothing_stored; write:greeting")


class ParsingTests(unittest.TestCase):
    VALID = {"op": "append_line", "section": "facts", "line": {"tag": "stated", "text": "A fact"}}

    def test_fenced_json_is_accepted(self) -> None:
        extraction = parse_extraction('```json\n{"ops": [], "proposals": [], "nothing_durable": true}\n```')
        self.assertTrue(extraction.nothing_durable)

    def test_one_bad_op_does_not_sink_the_rest(self) -> None:
        bad = {"op": "append_line", "section": "gossip", "line": {"tag": "stated", "text": "x"}}
        extraction = parse_extraction({"ops": [self.VALID, bad]})
        self.assertEqual((len(extraction.ops), extraction.invalid), (1, 1))

    def test_ops_beyond_the_turn_cap_are_counted_invalid(self) -> None:
        extraction = parse_extraction({"ops": [self.VALID] * 10})
        self.assertEqual((len(extraction.ops), extraction.invalid), (8, 2))

    def test_output_that_is_not_json_raises(self) -> None:
        for text in ("not json", ""):
            with self.subTest(text=text):
                with self.assertRaises(ValueError):
                    parse_extraction(text)

    def test_a_schema_object_is_used_directly(self) -> None:
        self.assertTrue(parse_extraction(MemoryOps(nothing_durable=True)).nothing_durable)


class ExtractorInputTests(unittest.TestCase):
    def test_the_advocates_message_is_the_only_fact_source(self) -> None:
        text = build_extractor_input(turn(HEART, answer="The remand order says X."), {}, today=TODAY)
        self.assertIn("TODAY: 2026-09-11", text)
        self.assertIn(f"ADVOCATE MESSAGE (the only source of facts):\n<<<\n{HEART}\n>>>", text)
        self.assertIn("ASSISTANT ANSWER (context only, never a source of facts)", text)

    def test_draft_turns_do_not_show_the_draft(self) -> None:
        text = build_extractor_input(turn(HEART, mode="draft", answer="IN THE COURT OF ..."), {}, today=TODAY)
        self.assertNotIn("IN THE COURT OF", text)

    def test_memory_lines_carry_their_ids(self) -> None:
        snapshot = render_snapshot({"facts": [{"id": "l1", "tag": "stated", "text": "Custody: judicial"}]})
        self.assertIn("- id=l1 [stated] Custody: judicial", snapshot)

    def test_a_large_memory_is_trimmed_oldest_first(self) -> None:
        lines = [{"id": f"l{i}", "tag": "stated", "text": f"fact {i} " + "x" * 200} for i in range(80)]
        snapshot = render_snapshot({"facts": lines})
        self.assertLessEqual(len(snapshot), SNAPSHOT_CHARS)
        self.assertIn("id=l79", snapshot)
        self.assertNotIn("id=l0 ", snapshot)


class FakeModels:
    def __init__(self, outcomes) -> None:
        self.outcomes = list(outcomes)
        self.configs = []
        self.contents = []

    def generate_content(self, *, model, contents, config):
        self.configs.append(config)
        self.contents.append(contents)
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


class ExtractorCallTests(unittest.TestCase):
    def test_it_falls_back_to_plain_json_when_the_schema_is_refused(self) -> None:
        models = FakeModels(
            [
                RuntimeError("response_schema is not supported"),
                SimpleNamespace(parsed=None, text='{"ops": [], "proposals": [], "nothing_durable": true}'),
            ]
        )
        with patch.object(writer_mod, "_extractor_settings", return_value=("gemini-2.5-flash", "PROMPT", 0.1)), patch.object(
            writer_mod, "_gemini_client", return_value=SimpleNamespace(models=models)
        ):
            extraction = extract_ops(turn(HEART), {}, today=TODAY)
        self.assertTrue(extraction.nothing_durable)
        self.assertEqual(extraction.model, "gemini-2.5-flash")
        self.assertIsNotNone(getattr(models.configs[0], "response_schema", None))
        self.assertIsNone(getattr(models.configs[1], "response_schema", None))

    def test_the_context_reaches_the_model(self) -> None:
        models = FakeModels([SimpleNamespace(parsed=None, text='{"ops": [], "nothing_durable": true}')])
        context = TurnContext(previous_answer="Which court will this be filed in?")
        with patch.object(writer_mod, "_extractor_settings", return_value=("gemini-2.5-flash", "PROMPT", 0.1)), patch.object(
            writer_mod, "_gemini_client", return_value=SimpleNamespace(models=models)
        ):
            extract_ops(turn("The High Court of Bombay"), {}, today=TODAY, context=context)
        self.assertIn("Which court will this be filed in?", models.contents[0])

    def test_no_client_is_an_error_the_writer_contains(self) -> None:
        with patch.object(writer_mod, "_extractor_settings", return_value=("gemini-2.5-flash", "PROMPT", 0.1)), patch.object(
            writer_mod, "_gemini_client", return_value=None
        ):
            with self.assertRaises(RuntimeError):
                extract_ops(turn(HEART), {}, today=TODAY)

    def _settings_with(self, cfg):
        with patch.object(
            writer_mod, "get_settings", return_value=SimpleNamespace(memory_extraction_model="gemini-2.5-flash")
        ), patch("app.services.agent_config_service.get_agent_config", return_value=cfg):
            return writer_mod._extractor_settings()  # noqa: SLF001

    def test_without_an_admin_row_the_small_extraction_model_is_used(self) -> None:
        cfg = SimpleNamespace(source="default", model_name="gemini-2.5-pro", prompt="", temperature=0.7)
        self.assertEqual(self._settings_with(cfg), ("gemini-2.5-flash", writer_mod.EXTRACTOR_PROMPT, 0.1))

    def test_an_admin_row_sets_the_model_prompt_and_temperature(self) -> None:
        cfg = SimpleNamespace(source="db", model_name="gemini-3.7-flash", prompt="Admin prompt", temperature=0.2)
        self.assertEqual(self._settings_with(cfg), ("gemini-3.7-flash", "Admin prompt", 0.2))

    def test_an_admin_row_naming_another_provider_keeps_only_its_prompt(self) -> None:
        cfg = SimpleNamespace(source="db", model_name="claude-sonnet-5", prompt="Admin prompt", temperature=0.2)
        self.assertEqual(self._settings_with(cfg), ("gemini-2.5-flash", "Admin prompt", 0.2))


class SubmitTests(unittest.TestCase):
    def test_the_writer_runs_off_the_request_thread(self) -> None:
        with patch.object(writer_mod, "run_post_turn", return_value=WriteReport(writes=2)):
            future = submit_post_turn(turn(HEART))
            self.assertIsNotNone(future)
            self.assertEqual(future.result(timeout=5).writes, 2)


if __name__ == "__main__":
    unittest.main()
