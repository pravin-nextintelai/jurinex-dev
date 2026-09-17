"""Past-session recall finds a discussion however it was worded, and in Marathi or Hindi.

Before, recall ran only on English phrases ("we discussed") and searched with English
full-text search, so "which side is more vulnerable" missed "tell me the weaker party",
and no Marathi or Hindi question searched at all. The questions below are from a real
case whose earlier chats covered the weaker party, the petitioner's likely questions and
the decision to press the Section 63-1A ground.
"""
from __future__ import annotations

import time
import unittest
from concurrent.futures import Future
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.services.memory import assembly
from app.services.memory import chat_index
from app.services.memory import recall
from app.services.memory import relevance
from app.services.memory.chat_index import VectorHit
from app.services.memory.scope import CaseScope
from tests.test_memory_recall import FakeConn, FakeCursor
from tests.test_memory_writer import run

SCOPE = CaseScope(case_key="512", folder_name="Lahoti_v_State", user_id="65", accessible_user_ids=("65",))
QUESTIONS = "11111111-1111-1111-1111-111111111111"
WEAKER = "22222222-2222-2222-2222-222222222222"
GROUND = "33333333-3333-3333-3333-333333333333"
GROUND_MESSAGE = "My client is the purchaser. We will press the Section 63-1A ground and drop the limitation point."


class CueTests(unittest.TestCase):
    def test_marathi_and_hindi_references_to_an_earlier_chat(self) -> None:
        for question in (
            "आपण चर्चा केलेले याचिकाकर्ता विचारू शकणारे प्रश्न आठवण करून दे",
            "मागच्या वेळी कोणती बाजू कमकुवत आहे असे ठरवले?",
            "आम्ही या मुद्द्यावर चर्चा केली होती, तो मुद्दा दे",
            "पिछली बार हमने कौन सा ग्राउंड छोड़ने का फैसला किया था?",
            "जैसा हमने पहले तय किया था, वही ड्राफ्ट करो",
            "which ground did we agree to drop last time",
        ):
            with self.subTest(question=question):
                self.assertTrue(recall.has_recall_cue(question))

    def test_references_to_the_record_are_not(self) -> None:
        for question in ("FIR मध्ये सांगितलेले तथ्य काय आहे?", "पुढील सुनावणी कधी आहे?", "याचिकेत नमूद केलेली तारीख कोणती?"):
            with self.subTest(question=question):
                self.assertFalse(recall.has_recall_cue(question))


class TopicTests(unittest.TestCase):
    def test_a_topic_inside_a_hindi_reference_is_kept(self) -> None:
        topic = recall.topic_words("पिछली बार हमने कौन सा ग्राउंड छोड़ने का फैसला किया था?")
        self.assertIn("ग्राउंड", topic)
        self.assertFalse({"पिछली", "हमने", "फैसला"} & topic)

    def test_a_pure_reference_has_no_topic(self) -> None:
        self.assertEqual(recall.topic_words("मागच्या वेळी काय ठरवले?"), set())

    def test_a_topic_word_is_found_in_an_english_message_in_either_script(self) -> None:
        self.assertEqual(recall.words_in_common({"ग्राउंड"}, GROUND_MESSAGE), 1)
        self.assertEqual(recall.words_in_common({"ground", "drop"}, GROUND_MESSAGE), 2)

    def test_an_ordinary_marathi_word_is_not_an_english_word_with_an_ending(self) -> None:
        # "प्रश्न" (question) is p-r-s-n; "press" is p-r-s.
        self.assertEqual(recall.words_in_common({"प्रश्न"}, GROUND_MESSAGE), 0)


class FusionTests(unittest.TestCase):
    def hit(self, chat_id: str, similarity: float) -> VectorHit:
        return VectorHit(chat_id=chat_id, similarity=similarity, kind="question", piece=0, start=0, end=0)

    def test_a_turn_found_two_ways_beats_one_found_one_way(self) -> None:
        ranked = recall.fuse([self.hit(WEAKER, 0.73), self.hit(GROUND, 0.70)], [], [GROUND], 3)
        self.assertEqual(ranked[0], GROUND)

    def test_only_turns_close_to_the_best_meaning_match_take_part(self) -> None:
        ranked = recall.fuse([self.hit(WEAKER, 0.73), self.hit(QUESTIONS, 0.60)], [], [], 3)
        self.assertEqual(ranked, [WEAKER])

    def test_a_weak_best_match_by_meaning_counts_for_nothing(self) -> None:
        self.assertEqual(recall.fuse([self.hit(WEAKER, 0.3)], [], [], 3), [])

    def test_the_limit_holds(self) -> None:
        ids = [f"id-{n}" for n in range(8)]
        self.assertEqual(len(recall.fuse([], ids, [], 3)), 3)


class PassageTests(unittest.TestCase):
    def test_the_advocates_words_then_the_answer_in_overlapping_passages(self) -> None:
        answer = "x" * 4_500
        pieces = chat_index.passages("tell me the weaker party", answer)
        self.assertEqual(pieces[0].kind, "question")
        answers = [piece for piece in pieces if piece.kind == "answer"]
        self.assertEqual([(p.start, p.end) for p in answers], [(0, 2_000), (1_800, 3_800), (3_600, 4_500)])
        self.assertTrue(all(p.text.startswith("Advocate asked: tell me the weaker party") for p in answers))

    def test_offsets_point_into_the_answer_as_recall_shows_it(self) -> None:
        answer = "Intro.\n\n" + ("word " * 600) + "THE POINT"
        last = chat_index.passages("q", answer)[-1]
        self.assertTrue(chat_index.collapse(answer)[last.start : last.end].endswith("THE POINT"))

    def test_a_saved_prompt_is_indexed_under_its_name(self) -> None:
        pieces = chat_index.passages("Role: You are a legal analyst …", "Summary.", label="Case Summary")
        self.assertEqual(pieces[0].text, "Case Summary")

    def test_a_long_answer_has_a_bounded_number_of_passages(self) -> None:
        pieces = chat_index.passages("q", "y" * 100_000)
        self.assertEqual(sum(1 for p in pieces if p.kind == "answer"), chat_index.MAX_PASSAGES)


class EmbeddingTests(unittest.TestCase):
    def test_a_failed_call_gives_no_vector_never_a_made_up_one(self) -> None:
        client = MagicMock()
        client.models.embed_content.side_effect = RuntimeError("429 quota")
        with patch.object(chat_index, "_client", return_value=client), \
                patch.object(chat_index, "get_settings", return_value=SimpleNamespace(gemini_api_key="k")):
            self.assertIsNone(chat_index.embed(["text"], task="RETRIEVAL_DOCUMENT"))

    def test_a_short_or_partial_result_is_refused(self) -> None:
        client = MagicMock()
        client.models.embed_content.return_value = SimpleNamespace(embeddings=[SimpleNamespace(values=[0.1] * 10)])
        with patch.object(chat_index, "_client", return_value=client), \
                patch.object(chat_index, "get_settings", return_value=SimpleNamespace(gemini_api_key="k")):
            self.assertIsNone(chat_index.embed(["a", "b"], task="RETRIEVAL_DOCUMENT"))

    def test_nothing_is_indexed_when_embedding_fails(self) -> None:
        conn = MagicMock()
        cur = conn.cursor.return_value
        cur.fetchall.side_effect = [
            [{"chat_id": GROUND, "question": GROUND_MESSAGE, "answer": "Noted.", "prompt_label": None,
              "used_secret_prompt": None, "preset": False}],
            [],
        ]
        conn.__enter__.return_value = conn
        cur.__enter__.return_value = cur
        with patch.object(chat_index, "enabled", return_value=True), \
                patch.object(chat_index, "is_db_available", return_value=True), \
                patch.object(chat_index, "table_ready", return_value=True), \
                patch.object(chat_index, "get_db_connection", return_value=conn), \
                patch.object(chat_index, "embed", return_value=None):
            report = chat_index.index_chats([GROUND])
        self.assertTrue(report.failed)
        self.assertFalse(any("INSERT INTO folder_chat_vectors" in str(call.args[0]) for call in cur.execute.call_args_list))


class VectorCursor(FakeCursor):
    """FakeCursor that also answers the search by meaning."""

    def __init__(self, *, vectors=(), **kwargs) -> None:
        super().__init__(**kwargs)
        self.vectors = list(vectors)

    def execute(self, sql: str, params=None) -> None:
        super().execute(sql, params)
        if "folder_chat_vectors" in sql:
            self._all = list(self.vectors)


def row(chat_id: str, question: str, answer: str = "Answer.") -> dict:
    return {
        "chat_id": chat_id,
        "session_id": "44444444-4444-4444-4444-444444444444",
        "question": question,
        "answer": answer,
        "prompt_label": None,
        "used_secret_prompt": False,
        "created_at": datetime(2026, 9, 16, 10, 0),
        "rank": 0.0,
    }


class SearchByMeaningTests(unittest.TestCase):
    def setUp(self) -> None:
        patcher = patch.object(recall.chat_index, "schedule_case", return_value=False)
        self.schedule_case = patcher.start()
        self.addCleanup(patcher.stop)

    def test_a_marathi_question_finds_an_english_chat_by_meaning(self) -> None:
        answer = ("Intro. " * 400) + "The petitioner is the weaker party because the limitation point fails."
        cursor = VectorCursor(
            rows=[row(WEAKER, "tell me the weaker party in this case", answer)],
            vectors=[{"chat_id": WEAKER, "kind": "answer", "piece": 1, "start_char": 1_800, "end_char": len(chat_index.collapse(answer)), "similarity": 0.73}],
        )
        hits = recall.search_past_sessions(
            SCOPE,
            question_raw="मागच्या वेळी कोणती बाजू कमकुवत आहे असे ठरवले?",
            current_session_id="55555555-5555-5555-5555-555555555555",
            conn=FakeConn(cursor),
            query_vector=[0.1] * chat_index.DIMS,
        )
        self.assertEqual([hit.chat_id for hit in hits], [WEAKER])
        self.assertTrue(hits[0].passage.endswith("limitation point fails."))
        block, _ = recall.format_recall_block(hits, 3_000)
        self.assertIn("ASSISTANT ANSWERED (the part that matches)", block)
        self.schedule_case.assert_called_once_with("Lahoti_v_State", "65")

    def test_the_search_by_meaning_is_scoped_like_every_other_history_query(self) -> None:
        cursor = VectorCursor(rows=[row(WEAKER, "tell me the weaker party")], vectors=[])
        recall.search_past_sessions(
            SCOPE, question_raw="as we discussed, the weaker party", conn=FakeConn(cursor), query_vector=[0.1] * chat_index.DIMS
        )
        vector_sql = [(sql, params) for sql, params in cursor.executed if "folder_chat_vectors" in sql]
        self.assertEqual(len(vector_sql), 1)
        sql, params = vector_sql[0]
        for clause in ("JOIN folder_chats fc", "fc.folder_name = %s", "fc.user_id::text = %s", "fc.session_id::text <> %s"):
            self.assertIn(clause, sql)
        self.assertEqual(params[1:3], ["Lahoti_v_State", "65"])

    def test_a_slow_embedding_leaves_recall_to_words(self) -> None:
        future: Future = Future()
        future.started_at = time.monotonic() - 5  # type: ignore[attr-defined]
        cursor = VectorCursor(rows=[row(GROUND, GROUND_MESSAGE)], vectors=[{"chat_id": WEAKER}])
        hits = recall.search_past_sessions(
            SCOPE, question_raw="which ground did we agree to drop", conn=FakeConn(cursor), query_vector=future
        )
        self.assertFalse(any("folder_chat_vectors" in sql for sql, _ in cursor.executed))
        self.assertEqual([hit.chat_id for hit in hits], [GROUND])

    def test_only_a_question_that_refers_back_with_a_topic_is_embedded(self) -> None:
        with patch.object(recall, "_EMBEDDER") as executor, patch.object(recall.chat_index, "enabled", return_value=True):
            executor.submit.return_value = Future()
            self.assertIsNone(recall.start_query_embedding("What are the facts?"))
            self.assertIsNone(recall.start_query_embedding("What did we decide last time?"))
            self.assertIsNotNone(recall.start_query_embedding("which ground did we agree to drop"))
        self.assertEqual(executor.submit.call_count, 1)


class IndexingAfterEachTurnTests(unittest.TestCase):
    def test_each_turn_is_indexed_while_past_chats_may_be_searched(self) -> None:
        _, mocks = run(GROUND_MESSAGE)
        mocks["index_schedule"].assert_called_once()

    def test_not_while_the_advocate_has_switched_that_off(self) -> None:
        from app.services.memory.schemas import MemorySettings

        _, mocks = run(GROUND_MESSAGE, settings=MemorySettings(recall_enabled=False))
        mocks["index_schedule"].assert_not_called()


class MarathiRoutingTests(unittest.TestCase):
    def test_a_marathi_question_loads_the_sections_it_is_about(self) -> None:
        self.assertEqual(assembly.route_sections("पुढील सुनावणीची तारीख काय आहे?")[0], "dates")
        self.assertIn("parties", assembly.route_sections("याचिकाकर्ता कोण आहे?"))

    def test_marathi_questions_reach_the_facts_about_the_advocate_they_concern(self) -> None:
        self.assertIn("work_style", relevance.category_hits("हा मसुदा मराठीत लिहा"))
        self.assertIn("मराठीत", relevance.terms("उत्तर मराठीत दे"))


if __name__ == "__main__":
    unittest.main()
