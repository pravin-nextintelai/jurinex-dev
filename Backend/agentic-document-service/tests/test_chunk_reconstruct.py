"""The model call that repairs a fragmented chunk: which model, how it thinks, and never losing text."""
from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.services.adapters import document_ai as ai

BROKEN = "The Krish n aji paid Rs . 25 , 00 , 000 at 18 % p .a . to the Ltd . on 202 5 . " * 4
FIXED = "The Krishnaji paid Rs. 25,00,000 at 18% p.a. to the Ltd. on 2025. " * 4


def response(text: str, finish: str = "STOP"):
    return SimpleNamespace(
        text=text,
        candidates=[SimpleNamespace(finish_reason=SimpleNamespace(name=finish))],
    )


class Case(unittest.TestCase):
    def setUp(self) -> None:
        self.client = MagicMock()
        self.client.models.generate_content.return_value = response(FIXED)
        self.settings = SimpleNamespace(chunk_autoheal_model="", chunk_autoheal_thinking_level="")
        self.config = MagicMock(return_value="CONFIG")
        for target, kwargs in (
            ("_gemini_client", {"return_value": self.client}),
            ("_build_gemini_config", {"side_effect": self.config}),
        ):
            patcher = patch.object(ai, target, **kwargs)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = patch("app.core.config.get_settings", side_effect=lambda: self.settings)
        patcher.start()
        self.addCleanup(patcher.stop)

    def call(self, text: str = BROKEN) -> str:
        return ai.reconstruct_chunk_text(text)


class ModelTests(Case):
    def test_repair_uses_flash_lite_with_thinking_at_minimal(self) -> None:
        self.assertEqual(self.call(), FIXED.strip())
        self.assertEqual(self.client.models.generate_content.call_args.kwargs["model"], "gemini-3.1-flash-lite")
        gen_kwargs, llm_params = self.config.call_args.args
        self.assertEqual(llm_params, {"thinking_level": "minimal"})
        self.assertEqual(self.config.call_args.kwargs["model_name"], "gemini-3.1-flash-lite")
        self.assertEqual(gen_kwargs["temperature"], 0.0)

    def test_the_client_is_chosen_for_that_model(self) -> None:
        self.call()
        ai._gemini_client.assert_called_with("gemini-3.1-flash-lite")

    def test_model_and_thinking_come_from_the_environment(self) -> None:
        self.settings = SimpleNamespace(chunk_autoheal_model="gemini-3.8-flash", chunk_autoheal_thinking_level="LOW")
        self.call()
        self.assertEqual(self.client.models.generate_content.call_args.kwargs["model"], "gemini-3.8-flash")
        self.assertEqual(self.config.call_args.args[1], {"thinking_level": "low"})

    def test_unreadable_settings_fall_back_to_the_defaults(self) -> None:
        with patch("app.core.config.get_settings", side_effect=RuntimeError("no env")):
            self.assertEqual(ai._reconstruct_settings(), ("gemini-3.1-flash-lite", "minimal"))


class NeverLoseTextTests(Case):
    def test_output_cut_off_at_the_token_limit_is_thrown_away(self) -> None:
        """Long enough to pass the length check, but it stopped mid-chunk: saving it would drop the rest."""
        self.client.models.generate_content.return_value = response(FIXED[: int(len(FIXED) * 0.8)], "MAX_TOKENS")
        self.assertEqual(self.call(), BROKEN)

    def test_a_chunk_too_long_to_send_whole_is_never_sent(self) -> None:
        long_chunk = BROKEN * (ai._RECONSTRUCT_MAX_CHARS // len(BROKEN) + 2)
        self.assertGreater(len(long_chunk), ai._RECONSTRUCT_MAX_CHARS)
        self.assertEqual(self.call(long_chunk), long_chunk)
        self.client.models.generate_content.assert_not_called()

    def test_the_whole_chunk_is_sent_not_a_slice(self) -> None:
        chunk = BROKEN * (ai._RECONSTRUCT_MAX_CHARS // len(BROKEN))
        self.assertLessEqual(len(chunk), ai._RECONSTRUCT_MAX_CHARS)
        self.call(chunk)
        self.assertTrue(self.client.models.generate_content.call_args.kwargs["contents"].endswith(chunk))

    def test_a_much_shorter_answer_is_thrown_away(self) -> None:
        self.client.models.generate_content.return_value = response("Sorry, I cannot help.")
        self.assertEqual(self.call(), BROKEN)

    def test_a_failed_call_keeps_the_original(self) -> None:
        self.client.models.generate_content.side_effect = RuntimeError("400 thinking level not supported")
        self.assertEqual(self.call(), BROKEN)

    def test_no_client_keeps_the_original(self) -> None:
        ai._gemini_client.return_value = None
        self.assertEqual(self.call(), BROKEN)

    def test_a_code_fence_around_the_answer_is_removed(self) -> None:
        self.client.models.generate_content.return_value = response(f"```text\n{FIXED.strip()}\n```")
        self.assertEqual(self.call(), FIXED.strip())

    def test_blank_text_never_reaches_the_model(self) -> None:
        self.assertEqual(self.call("   "), "   ")
        self.client.models.generate_content.assert_not_called()


class TokenLimitTests(unittest.TestCase):
    def test_finish_reasons_are_read_however_the_sdk_shapes_them(self) -> None:
        self.assertTrue(ai._stopped_at_token_limit(response("x", "MAX_TOKENS")))
        self.assertTrue(ai._stopped_at_token_limit(SimpleNamespace(candidates=[SimpleNamespace(finish_reason="FinishReason.MAX_TOKENS")])))
        self.assertFalse(ai._stopped_at_token_limit(response("x", "STOP")))
        self.assertFalse(ai._stopped_at_token_limit(SimpleNamespace(candidates=None)))
        self.assertFalse(ai._stopped_at_token_limit(SimpleNamespace()))


if __name__ == "__main__":
    unittest.main()
