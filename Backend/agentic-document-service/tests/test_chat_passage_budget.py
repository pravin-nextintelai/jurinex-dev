"""Passage budget for specific case-chat questions: estimated tokens on paid models,
unchanged small slices on free-tier Gemma."""
from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.api.routes import files
from app.services import token_budget


def _settings(**overrides):
    values = {"chat_passage_budget_tokens": 24000, "chat_passage_top_k": 36, "chars_per_token_estimate": 3.0}
    values.update(overrides)
    return SimpleNamespace(**values)


class TokenEstimateTests(unittest.TestCase):
    def test_tokens_convert_with_the_measured_ratio(self):
        with patch("app.core.config.get_settings", return_value=_settings()):
            self.assertEqual(token_budget.chars_for_tokens(24000), 72000)
            self.assertEqual(token_budget.estimate_tokens("x" * 3001), 1001)

    def test_a_broken_ratio_falls_back_to_the_default(self):
        for bad in (0, -2, float("nan")):
            with patch("app.core.config.get_settings", return_value=_settings(chars_per_token_estimate=bad)):
                self.assertEqual(token_budget.chars_per_token(), token_budget.DEFAULT_CHARS_PER_TOKEN)

    def test_extreme_ratios_are_clamped(self):
        with patch("app.core.config.get_settings", return_value=_settings(chars_per_token_estimate=50)):
            self.assertEqual(token_budget.chars_per_token(), 6.0)


class PassageBudgetTests(unittest.TestCase):
    def _budget(self, settings=None, **kwargs):
        args = {"broad_gemma": False, "gemma_capped": False, "gemma_cap_chars": 36000}
        args.update(kwargs)
        settings = settings or _settings()
        with patch.object(files, "get_settings", return_value=settings), \
                patch("app.core.config.get_settings", return_value=settings):
            return files._passage_budget_for_question(**args)

    def test_specific_question_on_a_paid_model_gets_24k_tokens(self):
        self.assertEqual(self._budget(), (36, 72000))

    def test_budget_and_hit_count_follow_env(self):
        self.assertEqual(
            self._budget(_settings(chat_passage_budget_tokens=10000, chat_passage_top_k=20)),
            (20, 30000),
        )

    def test_hit_count_stays_within_the_retriever_ceiling(self):
        self.assertEqual(self._budget(_settings(chat_passage_top_k=500))[0], 48)
        self.assertEqual(self._budget(_settings(chat_passage_top_k=1))[0], 12)

    def test_free_tier_gemma_keeps_its_limits(self):
        self.assertEqual(self._budget(gemma_capped=True), (12, 24000))
        self.assertEqual(self._budget(broad_gemma=True, gemma_capped=True, gemma_cap_chars=36000), (30, 32000))

    def _doc_cap(self, settings):
        with patch.object(files, "get_settings", return_value=settings), \
                patch("app.core.config.get_settings", return_value=settings):
            return files._doc_context_char_budget(
                "When was the FIR registered against the applicants?",
                learning_mode=False, is_deep=False, is_comprehensive=False, model_name="deepseek-v4-flash",
            )

    def test_document_context_cap_leaves_room_for_the_passages(self):
        self.assertGreaterEqual(self._doc_cap(_settings()), self._budget()[1])

    def test_document_context_cap_grows_with_a_larger_passage_budget(self):
        big = _settings(chat_passage_budget_tokens=40000)
        _, passages = self._budget(big)
        self.assertEqual(passages, 120000)
        self.assertGreaterEqual(self._doc_cap(big), passages)


if __name__ == "__main__":
    unittest.main()
