"""form_population_agent (intake auto-fill + chronology) takes its model and thinking
level from .env and is never clamped by the llm_max_tokens registry."""
from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.services.adapters import document_ai as dai


def _agent_cfg(model: str = "gemini-2.5-pro", **params):
    return SimpleNamespace(
        model_name=model,
        temperature=0.7,
        llm_parameters=dict(params),
        prompt="",
        source="default",
        db_id=None,
        agent_type="",
    )


def _settings(model: str = "gemini-3.8-flash", level: str = "medium"):
    return SimpleNamespace(intake_extraction_model=model, intake_extraction_thinking_level=level)


class GenerationConfigTests(unittest.TestCase):
    def _config(self, agent_name: str, cfg, settings):
        with patch("app.services.agent_config_service.get_agent_config", return_value=cfg), \
                patch("app.core.config.get_settings", return_value=settings), \
                patch("app.services.llm_models_catalog.get_gemini_claude_models_map", return_value={}):
            return dai._generation_config(agent_name=agent_name)

    def test_extraction_uses_env_model_level_and_full_budget(self):
        model, gen_kwargs, params = self._config(
            dai._AGENT_EXTRACTION, _agent_cfg(max_output_tokens=2000), _settings()
        )
        self.assertEqual(model, "gemini-3.8-flash")
        self.assertEqual(params["thinking_level"], "medium")
        self.assertFalse(params["thinking_mode"])
        self.assertTrue(params[dai._NO_OUTPUT_TOKEN_CLAMP])
        self.assertEqual(gen_kwargs["max_output_tokens"], dai.DEFAULT_MAX_OUTPUT_TOKENS)

    def test_env_level_can_be_changed(self):
        _, _, params = self._config(dai._AGENT_EXTRACTION, _agent_cfg(), _settings(level="HIGH"))
        self.assertEqual(params["thinking_level"], "high")

    def test_empty_env_model_keeps_configured_model(self):
        model, _, _ = self._config(
            dai._AGENT_EXTRACTION, _agent_cfg("gemini-3.6-flash"), _settings(model="  ")
        )
        self.assertEqual(model, "gemini-3.6-flash")

    def test_unknown_level_falls_back_to_medium(self):
        _, _, params = self._config(dai._AGENT_EXTRACTION, _agent_cfg(), _settings(level="turbo"))
        self.assertEqual(params["thinking_level"], "medium")

    def test_other_agents_are_unchanged(self):
        model, gen_kwargs, params = self._config(
            "grounded_retrieval_agent", _agent_cfg(max_output_tokens=2000), _settings()
        )
        self.assertEqual(model, "gemini-2.5-pro")
        self.assertEqual(gen_kwargs["max_output_tokens"], 2000)
        self.assertNotIn(dai._NO_OUTPUT_TOKEN_CLAMP, params)
        self.assertNotIn("thinking_level", params)


class OutputClampTests(unittest.TestCase):
    def _build(self, params):
        with patch.object(dai, "_model_max_output_tokens", return_value=4000):
            return dai._build_gemini_config(
                {"temperature": 0.7, "max_output_tokens": dai.DEFAULT_MAX_OUTPUT_TOKENS},
                params,
                model_name="gemini-3.8-flash",
            )

    def test_extraction_is_not_clamped_and_thinks_at_medium(self):
        config = self._build({"thinking_level": "medium", dai._NO_OUTPUT_TOKEN_CLAMP: True})
        self.assertEqual(config.max_output_tokens, dai.DEFAULT_MAX_OUTPUT_TOKENS)
        self.assertEqual(str(config.thinking_config.thinking_level).lower().rsplit(".", 1)[-1], "medium")

    def test_other_calls_still_follow_the_registry(self):
        config = self._build({})
        self.assertEqual(config.max_output_tokens, 4000)


if __name__ == "__main__":
    unittest.main()
