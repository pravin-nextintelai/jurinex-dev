from __future__ import annotations

import asyncio
import gc
import json
import time
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx

from app.services.deep_research import events
from app.services.deep_research.budget import (
    BudgetExceededError,
    BudgetTracker,
    PricingPolicy,
)
from app.services.deep_research.config import DeepResearchConfig
from app.services.deep_research.orchestrator import (
    _redact_grounded_text,
    _provider_call,
    _reason_call,
    _run_impl,
    _safe_answer_with_sources,
    _search_call,
    _synthesize,
)
from app.services.deep_research.runtime import DeepResearchDeadline, DeepResearchTimeout
from app.services.deep_research.source_validation import (
    SourceAuthority,
    SourceRecord,
    ValidationResult,
    ValidationState,
)


def _config(**overrides):
    values = {
        "reasoning_model": "test-model",
        "search_model": "test-model",
        "synthesis_model": "test-model",
        "max_rounds": 2,
        "budget_inr": 1000.0,
        "synthesis_reserve_frac": 0.1,
        "max_output_tokens": 4096,
        "stage_timeout_s": 1.0,
    }
    values.update(overrides)
    return DeepResearchConfig(**values)


def _budget():
    return BudgetTracker(
        limit_inr=1000.0,
        pricing=PricingPolicy(
            usd_to_inr=80.0,
            model_rates_usd_per_million={"test-model": (0.1, 0.2)},
            tool_rates_usd_per_use={"google_search": 0.014},
            model_cost_usd=None,
        ),
    )


def _payload(raw_sse: str) -> dict:
    return json.loads(raw_sse.removeprefix("data: ").strip())


class DeepAnswerSafetyTests(unittest.TestCase):
    def test_status_phase_and_replaceable_chunk_contracts(self):
        status = _payload(events.status("researching", "Planning", phase="planning"))
        snapshot = _payload(events.chunk("safe preview", replace=True))
        self.assertEqual(status["status"], "researching")
        self.assertEqual(status["phase"], "planning")
        self.assertEqual(snapshot, {"type": "chunk", "text": "safe preview", "replace": True})

    def test_answer_keeps_only_cited_validated_sources_and_strips_active_content(self):
        source = {
            "source_type": "deep_research_web",
            "source_id": "S1",
            "title": '<img src=x onerror="alert(1)"> **Supreme Court order**',
            "canonical_url": "https://www.sci.gov.in/order.pdf",
            "authority_label": "Primary legal authority",
            "claim_ids": ["r1:g1"],
            "claim_texts": ["The supported holding"],
        }
        answer, cited = _safe_answer_with_sources(
            '<style>body{display:none}</style><img src=x onerror=alert(1)> '
            'A [model link](javascript:alert(1)) and https://evil.example [S1] [S999].',
            [source],
            "28 July 2026",
        )
        self.assertNotIn("<img", answer)
        self.assertNotIn("<style", answer)
        self.assertNotIn("javascript:", answer)
        self.assertNotIn("https://evil.example", answer)
        self.assertNotIn("[S999]", answer)
        self.assertIn("[unverified source removed]", answer)
        self.assertIn("https://www.sci.gov.in/order.pdf", answer)
        self.assertNotIn("onerror", answer)
        self.assertEqual([item["source_id"] for item in cited], ["S1"])
        self.assertEqual(cited[0]["domain"], "www.sci.gov.in")

    def test_preview_is_sanitized_without_a_source_register(self):
        source = {
            "source_id": "S1",
            "title": "Court",
            "canonical_url": "https://sci.gov.in/order",
            "authority_label": "Primary legal authority",
        }
        preview, cited = _safe_answer_with_sources(
            "Supported proposition [S1]",
            [source],
            "28 July 2026",
            include_register=False,
        )
        self.assertEqual(preview, "Supported proposition [S1]")
        self.assertEqual(len(cited), 1)
        self.assertNotIn("Validated sources", preview)
        self.assertNotIn("https://", preview)

    def test_grounded_redaction_removes_private_identifiers(self):
        context = (
            "Mr Rahul Sharma of Green Eye Infrastructure Pvt. Ltd. lives at Flat 12, "
            "MG Road. Case No. ABC/1234. Email rahul@example.com; +91 98765 43210."
        )
        redacted = _redact_grounded_text(
            "Find cases for Mr Rahul Sharma and Green Eye Infrastructure Pvt. Ltd., "
            "Case No. ABC/1234, rahul@example.com, +91 98765 43210, Flat 12 MG Road; "
            "include Supreme Court of India authority.",
            context,
        )
        for secret in (
            "Rahul Sharma",
            "Green Eye Infrastructure",
            "ABC/1234",
            "rahul@example.com",
            "98765 43210",
            "Flat 12",
        ):
            self.assertNotIn(secret.casefold(), redacted.casefold())
        self.assertIn("Supreme Court of India", redacted)


class DeepProviderAccountingTests(unittest.IsolatedAsyncioTestCase):
    async def test_synthesis_emits_live_preview_then_settled_result(self):
        chunk = SimpleNamespace(
            text="A" * 200,
            usage_metadata=SimpleNamespace(
                prompt_token_count=10,
                candidates_token_count=20,
                total_token_count=30,
            ),
            candidates=[SimpleNamespace(finish_reason=SimpleNamespace(name="STOP"))],
        )
        with patch(
            "app.services.deep_research.orchestrator.gemini.synthesis_stream",
            return_value=iter([chunk]),
        ):
            items = [
                item
                async for item in _synthesize(
                    DeepResearchDeadline(2.0),
                    _budget(),
                    _config(),
                    prompt="bounded synthesis",
                )
            ]
        self.assertEqual([kind for kind, _ in items], ["preview", "result"])
        answer, partial = items[-1][1]
        self.assertEqual(answer, "A" * 200)
        self.assertFalse(partial)

    async def test_search_query_overrun_settles_maximum_and_stops(self):
        budget = _budget()
        with patch(
            "app.services.deep_research.orchestrator.gemini.search",
            return_value=("finding", [], 20, 30, 5),
        ):
            with self.assertRaises(BudgetExceededError):
                await _search_call(
                    DeepResearchDeadline(2.0),
                    budget,
                    _config(),
                    prompt="search safely",
                    label="Round 1 search",
                )
        self.assertEqual(budget.active_reservations, 0)
        self.assertEqual(budget.calls, 1)
        self.assertEqual(budget.steps[-1]["provider_reported_search_queries"], 5)
        self.assertEqual(budget.steps[-1]["usage_estimate"], "reservation_maximum")

    async def test_timed_out_provider_call_is_conservatively_settled(self):
        class SlowIterator:
            def __iter__(self):
                return self

            def __next__(self):
                time.sleep(0.08)
                return None

            def close(self):
                return None

        budget = _budget()
        with patch(
            "app.services.deep_research.orchestrator.gemini.synthesis_stream",
            return_value=SlowIterator(),
        ):
            with self.assertRaises(DeepResearchTimeout):
                async for _item in _synthesize(
                    DeepResearchDeadline(1.0),
                    budget,
                    _config(stage_timeout_s=0.01),
                    prompt="timeout safely",
                ):
                    pass
        self.assertEqual(budget.active_reservations, 0)
        self.assertEqual(budget.calls, 1)
        self.assertEqual(budget.steps[-1]["usage_estimate"], "reservation_maximum")
        await asyncio.sleep(0.1)

    async def test_late_worker_timeout_is_retrieved_after_stage_deadline(self):
        loop = asyncio.get_running_loop()
        contexts: list[dict] = []
        previous_handler = loop.get_exception_handler()

        def late_timeout():
            time.sleep(0.05)
            raise httpx.ReadTimeout("late provider timeout")

        loop.set_exception_handler(lambda _loop, context: contexts.append(context))
        try:
            with self.assertRaises(DeepResearchTimeout):
                await _provider_call(
                    DeepResearchDeadline(1.0),
                    late_timeout,
                    stage="late_worker",
                    timeout_s=0.01,
                )
            await asyncio.sleep(0.1)
            gc.collect()
            await asyncio.sleep(0)
        finally:
            loop.set_exception_handler(previous_handler)

        self.assertFalse(
            any("never retrieved" in str(item.get("message", "")) for item in contexts),
            contexts,
        )

    async def test_read_timeout_retries_once_without_reducing_quality_settings(self):
        failed_stream = iter([httpx.ReadTimeout("provider read timed out")])

        class RaisingIterator:
            def __iter__(self):
                return self

            def __next__(self):
                error = next(failed_stream)
                raise error

            def close(self):
                return None

        chunk = SimpleNamespace(
            text="R" * 200,
            usage_metadata=SimpleNamespace(
                prompt_token_count=10,
                candidates_token_count=20,
                total_token_count=30,
            ),
            candidates=[SimpleNamespace(finish_reason=SimpleNamespace(name="STOP"))],
        )
        budget = _budget()
        cfg = _config(synthesis_timeout_retries=1)
        with (
            patch(
                "app.services.deep_research.orchestrator.gemini.synthesis_stream",
                side_effect=[RaisingIterator(), iter([chunk])],
            ) as synthesis_stream,
            patch(
                "app.services.deep_research.orchestrator.asyncio.sleep",
                new=AsyncMock(),
            ),
        ):
            items = [
                item
                async for item in _synthesize(
                    DeepResearchDeadline(2.0),
                    budget,
                    cfg,
                    prompt="retry full-quality synthesis",
                )
            ]

        self.assertEqual([kind for kind, _ in items], ["preview", "result"])
        self.assertEqual(items[-1][1], ("R" * 200, False))
        self.assertEqual(synthesis_stream.call_count, 2)
        first = synthesis_stream.call_args_list[0]
        second = synthesis_stream.call_args_list[1]
        self.assertEqual(first.kwargs, second.kwargs)
        self.assertEqual(first.kwargs["thinking_level"], cfg.synthesis_thinking_level)
        self.assertEqual(first.kwargs["max_output_tokens"], cfg.max_output_tokens)
        self.assertEqual(budget.calls, 2)
        self.assertEqual(budget.steps[0]["usage_estimate"], "reservation_maximum")
        self.assertEqual(
            [step["label"] for step in budget.steps],
            ["Synthesis attempt 1 (conservative settlement)", "Synthesis"],
        )

    async def test_started_provider_error_is_conservatively_settled(self):
        budget = _budget()
        cfg = _config()
        deadline = DeepResearchDeadline(30.0)

        with patch(
            "app.services.deep_research.orchestrator.gemini.reason",
            side_effect=RuntimeError("provider disconnected"),
        ):
            with self.assertRaisesRegex(RuntimeError, "provider disconnected"):
                await _reason_call(
                    deadline,
                    budget,
                    cfg,
                    model=cfg.reasoning_model,
                    prompt="plan",
                    max_output_tokens=512,
                    min_output_tokens=128,
                    temperature=0.0,
                    thinking_level="low",
                    label="Plan",
                    keep_back_inr=0.0,
                )

        summary = budget.summary()
        self.assertEqual(summary["active_reservations"], 0)
        self.assertGreater(summary["spent_inr"], 0)
        self.assertEqual(budget.steps[0]["usage_estimate"], "reservation_maximum")


class DeepRunSmokeTests(unittest.IsolatedAsyncioTestCase):
    async def test_validated_sources_stream_and_persist_end_to_end(self):
        citation = {
            "uri": "https://sci.gov.in/order",
            "title": "Supreme Court order",
            "claim_ids": ["g1"],
            "claim_texts": ["The court stated the supported proposition."],
        }

        async def fake_reason(*_args, **_kwargs):
            return '{"mode":"legal","chat_reply":"","sub_questions":["public legal issue"]}'

        async def fake_search(*_args, **_kwargs):
            return "The court stated the supported proposition.", [citation]

        async def fake_validate_many(_self, records, concurrency=None):
            self.assertEqual(concurrency, 6)
            source = records[0]
            self.assertIsInstance(source, SourceRecord)
            return [
                ValidationResult(
                    source=source,
                    state=ValidationState.VALID,
                    final_url=source.canonical_url,
                    final_authority=SourceAuthority.PRIMARY_LEGAL_AUTHORITY,
                    status_code=200,
                    mime_type="text/html",
                    body_sample=b"The court stated the supported proposition.",
                )
            ]

        async def fake_synthesis(*_args, **_kwargs):
            yield "preview", "Draft proposition [S1]"
            yield "result", ("Final supported proposition [S1]", False)

        persisted: list[tuple[str, list[dict]]] = []

        async def on_result(answer, sources):
            persisted.append((answer, sources))

        cfg = _config(max_rounds=1)
        with (
            patch("app.services.deep_research.orchestrator._reason_call", new=fake_reason),
            patch("app.services.deep_research.orchestrator._search_call", new=fake_search),
            patch("app.services.deep_research.orchestrator._synthesize", new=fake_synthesis),
            patch(
                "app.services.deep_research.orchestrator.SourceValidator.validate_many",
                new=fake_validate_many,
            ),
            patch("app.services.deep_research.orchestrator.report.log_usage_table"),
        ):
            raw_events = [
                event
                async for event in _run_impl(
                    question="What is the public legal position?",
                    document_context="Private Client Name",
                    session_id="session-1",
                    on_result=on_result,
                    cfg=cfg,
                    budget=_budget(),
                    deadline=DeepResearchDeadline(3.0),
                    run_id="run-1",
                )
            ]

        payloads = [_payload(event) for event in raw_events]
        snapshots = [item for item in payloads if item.get("type") == "chunk"]
        done = payloads[-1]
        self.assertTrue(snapshots)
        self.assertTrue(all(item.get("replace") is True for item in snapshots))
        self.assertEqual(done["type"], "done")
        self.assertEqual(done["result_status"], "complete")
        self.assertEqual(done["citations"][0]["source_id"], "S1")
        self.assertIn("## Validated sources", done["answer"])
        self.assertEqual(len(persisted), 1)
        self.assertEqual(persisted[0][1][0]["source_id"], "S1")


if __name__ == "__main__":
    unittest.main()
