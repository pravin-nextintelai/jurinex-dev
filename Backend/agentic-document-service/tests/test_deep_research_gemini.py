from __future__ import annotations

import sys
import types as python_types
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import Mock, patch

from app.services.deep_research import gemini


class _GenerateContentConfig:
    def __init__(self, **kwargs) -> None:
        self.kwargs = dict(kwargs)
        for key, value in kwargs.items():
            setattr(self, key, value)


class _ThinkingConfig:
    def __init__(self, *, thinking_level: str) -> None:
        self.thinking_level = thinking_level


class _GoogleSearch:
    pass


class _Tool:
    def __init__(self, *, google_search) -> None:
        self.google_search = google_search


def _fake_google_modules() -> tuple[python_types.ModuleType, python_types.ModuleType]:
    fake_types = python_types.ModuleType("google.genai.types")
    fake_types.GenerateContentConfig = _GenerateContentConfig
    fake_types.ThinkingConfig = _ThinkingConfig
    fake_types.GoogleSearch = _GoogleSearch
    fake_types.Tool = _Tool

    fake_genai = python_types.ModuleType("google.genai")
    fake_genai.types = fake_types
    return fake_genai, fake_types


def _grounded_response():
    chunks = [
        SimpleNamespace(
            web=SimpleNamespace(
                uri="https://www.indiacode.nic.in/act.pdf",
                title="India Code",
            )
        ),
        SimpleNamespace(web=None),
        SimpleNamespace(
            web=SimpleNamespace(
                uri="https://indiankanoon.org/doc/123/",
                title="Indian Kanoon",
            )
        ),
    ]
    supports = [
        SimpleNamespace(
            segment=SimpleNamespace(text="Section 32A governs adjudication."),
            grounding_chunk_indices=[0, 2],
        ),
        SimpleNamespace(
            segment=SimpleNamespace(text="The amendment took effect in 2025."),
            grounding_chunk_indices=[0, 1, 99, "not-an-index"],
        ),
        # Duplicate support text must not create duplicate claim text on a source.
        SimpleNamespace(
            segment=SimpleNamespace(text="Section 32A governs adjudication."),
            grounding_chunk_indices=[0],
        ),
    ]
    metadata = SimpleNamespace(
        grounding_chunks=chunks,
        grounding_supports=supports,
        web_search_queries=[
            "Maharashtra Stamp Act Section 32A",
            "Bombay High Court Section 32A",
            "Maharashtra Stamp Act Section 32A",
            "",
        ],
    )
    return SimpleNamespace(
        candidates=[SimpleNamespace(grounding_metadata=metadata)]
    )


class GroundingAndUsageTests(unittest.TestCase):
    def test_grounding_maps_supported_claims_and_counts_search_queries(self) -> None:
        response = _grounded_response()

        sources, query_count = gemini._grounding_metadata(response)

        self.assertEqual(query_count, 2)
        self.assertEqual(
            sources,
            [
                {
                    "uri": "https://www.indiacode.nic.in/act.pdf",
                    "title": "India Code",
                    "claim_ids": ["g1", "g2", "g3"],
                    "claim_texts": [
                        "Section 32A governs adjudication.",
                        "The amendment took effect in 2025.",
                    ],
                },
                {
                    "uri": "https://indiankanoon.org/doc/123/",
                    "title": "Indian Kanoon",
                    "claim_ids": ["g1"],
                    "claim_texts": ["Section 32A governs adjudication."],
                },
            ],
        )
        self.assertEqual(gemini.chunk_citations(response), sources)
        self.assertEqual(gemini.chunk_search_query_count(response), 2)

    def test_usage_bills_hidden_thinking_tokens_as_output(self) -> None:
        response = SimpleNamespace(
            usage_metadata=SimpleNamespace(
                prompt_token_count=100,
                candidates_token_count=25,
                thoughts_token_count=40,
                total_token_count=165,
            )
        )

        self.assertEqual(gemini._usage(response), (100, 65))

    def test_usage_keeps_candidate_count_when_total_has_no_extra_tokens(self) -> None:
        response = SimpleNamespace(
            usage_metadata=SimpleNamespace(
                prompt_token_count=100,
                candidates_token_count=25,
                total_token_count=125,
            )
        )

        self.assertEqual(gemini._usage(response), (100, 25))


class TransportTimeoutTests(unittest.TestCase):
    def test_default_transport_timeout_leaves_stage_deadline_headroom(self) -> None:
        settings = SimpleNamespace(
            deep_research_stage_timeout_s=240.0,
            deep_research_transport_timeout_s=210.0,
        )

        self.assertEqual(gemini._transport_timeout_ms(settings), 210_000)

    def test_transport_timeout_is_clamped_below_shorter_stage_deadline(self) -> None:
        settings = SimpleNamespace(
            deep_research_stage_timeout_s=120.0,
            deep_research_transport_timeout_s=210.0,
        )

        self.assertEqual(gemini._transport_timeout_ms(settings), 115_000)

    def test_invalid_timeout_values_use_safe_separate_defaults(self) -> None:
        settings = SimpleNamespace(
            deep_research_stage_timeout_s="invalid",
            deep_research_transport_timeout_s=float("nan"),
        )

        self.assertEqual(gemini._transport_timeout_ms(settings), 210_000)


class _ApiError(Exception):
    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = status_code


class ThinkingFallbackTests(unittest.TestCase):
    def _reason_with_side_effect(self, side_effect):
        fake_genai, fake_types = _fake_google_modules()
        generate = Mock(side_effect=side_effect)
        self.generate = generate
        client = SimpleNamespace(
            models=SimpleNamespace(generate_content=generate)
        )
        modules = {
            "google.genai": fake_genai,
            "google.genai.types": fake_types,
        }
        with patch.dict(sys.modules, modules), patch.object(
            gemini, "_client", return_value=client
        ):
            result = gemini.reason(
                "gemini-test",
                "Plan the research.",
                temperature=0.1,
                max_output_tokens=128,
                thinking_level="low",
            )
        return result, generate

    def test_unsupported_thinking_400_retries_once_without_config(self) -> None:
        success = SimpleNamespace(
            text="plan",
            usage_metadata=SimpleNamespace(
                prompt_token_count=7,
                candidates_token_count=3,
                total_token_count=10,
            ),
        )
        result, generate = self._reason_with_side_effect(
            [
                _ApiError(
                    400,
                    "INVALID_ARGUMENT: thinking_config is not supported by this model",
                ),
                success,
            ]
        )

        self.assertEqual(result, ("plan", 7, 3))
        self.assertEqual(generate.call_count, 2)
        first_config = generate.call_args_list[0].kwargs["config"]
        second_config = generate.call_args_list[1].kwargs["config"]
        self.assertEqual(first_config.thinking_config.thinking_level, "low")
        self.assertNotIn("thinking_config", second_config.kwargs)

    def test_timeout_does_not_retry(self) -> None:
        with self.assertRaisesRegex(TimeoutError, "provider timed out"):
            self._reason_with_side_effect(TimeoutError("provider timed out"))

        self.assertEqual(self.generate.call_count, 1)

    def test_server_error_does_not_retry(self) -> None:
        with self.assertRaisesRegex(_ApiError, "upstream failure"):
            self._reason_with_side_effect(
                _ApiError(500, "thinking_config upstream failure")
            )

        self.assertEqual(self.generate.call_count, 1)

    def test_unrelated_400_does_not_retry(self) -> None:
        with self.assertRaisesRegex(_ApiError, "prompt is too long"):
            self._reason_with_side_effect(
                _ApiError(400, "INVALID_ARGUMENT: prompt is too long")
            )

        self.assertEqual(self.generate.call_count, 1)


class _ClosableStream:
    def __init__(self, chunks) -> None:
        self._chunks = iter(chunks)
        self.close_calls = 0

    def __iter__(self):
        return self

    def __next__(self):
        return next(self._chunks)

    def close(self) -> None:
        self.close_calls += 1


class SynthesisStreamTests(unittest.TestCase):
    def test_close_propagates_and_search_tool_can_be_omitted(self) -> None:
        fake_genai, fake_types = _fake_google_modules()
        stream = _ClosableStream([SimpleNamespace(text="first"), SimpleNamespace(text="second")])
        generate_stream = Mock(return_value=stream)
        client = SimpleNamespace(
            models=SimpleNamespace(generate_content_stream=generate_stream)
        )
        fake_document_ai = SimpleNamespace(
            _pace_gemma_call=Mock(),
            _estimate_input_tokens=Mock(return_value=10),
        )
        modules = {
            "google.genai": fake_genai,
            "google.genai.types": fake_types,
        }

        import app.services.adapters as adapters

        with ExitStack() as stack:
            stack.enter_context(patch.dict(sys.modules, modules))
            stack.enter_context(patch.object(gemini, "_client", return_value=client))
            stack.enter_context(
                patch.object(
                    adapters,
                    "document_ai",
                    fake_document_ai,
                    create=True,
                )
            )
            iterator = gemini.synthesis_stream(
                "gemini-test",
                "Write the report.",
                temperature=0.2,
                max_output_tokens=256,
                thinking_level="",
                use_google_search=False,
            )

            self.assertEqual(next(iterator).text, "first")
            call_config = generate_stream.call_args.kwargs["config"]
            self.assertNotIn("tools", call_config.kwargs)
            iterator.close()

        self.assertEqual(stream.close_calls, 1)
        fake_document_ai._estimate_input_tokens.assert_called_once_with(
            "Write the report."
        )
        fake_document_ai._pace_gemma_call.assert_called_once_with(
            "gemini-test", est_input_tokens=10
        )


if __name__ == "__main__":
    unittest.main()
