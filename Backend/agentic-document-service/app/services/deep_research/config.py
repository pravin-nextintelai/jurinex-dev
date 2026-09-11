"""Configuration for a Deep Research run.

All knobs are read from app Settings (environment-overridable) so operators can tune
the cost/quality trade-off without changing code. Search rounds use Google grounding;
the final synthesis is evidence-closed and receives only validated findings plus bounded
private case context. Each provider call receives a lower runtime token cap derived from
the configured application budget.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DeepResearchConfig:
    reasoning_model: str        # planning + gap decisions (cheap, non-grounded)
    search_model: str           # per-round grounded web search (cheap, grounded)
    synthesis_model: str        # final evidence-closed report (quality, streamed)
    max_rounds: int             # hard ceiling on search rounds
    budget_inr: float           # application-enforced rupee ceiling, never above ₹150
    synthesis_reserve_frac: float  # fraction of budget kept back for synthesis
    max_output_tokens: int      # configured ceiling; budget derives a lower per-run cap
    search_usd_per_query: float = 0.014  # Gemini 3 Google Search tool price
    max_sources: int = 24            # maximum unique web sources validated/persisted
    source_concurrency: int = 6      # bounded parallel outbound validations
    source_timeout_s: float = 8.0    # per-source network deadline
    source_max_bytes: int = 750_000  # maximum response bytes sampled for validation/quotes
    source_max_redirects: int = 4    # every redirect hop is revalidated
    stage_timeout_s: float = 240.0   # maximum time for one provider stage
    run_timeout_s: float = 720.0     # maximum wall-clock time for the full Deep run
    synthesis_timeout_retries: int = 1  # full-quality retries before any answer chunk
    queue_timeout_s: float = 5.0     # maximum wait for an in-process Deep run slot
    max_concurrent_runs: int = 2     # per-process Deep run capacity
    temperature: float = 0.2    # plan/search temperature (low = focused)
    # Thinking level for the cheap flash-lite steps (plan/search/gap). Best-effort: auto-falls
    # back to no-thinking if the lite model rejects it (see gemini.py). "" disables.
    reasoning_thinking_level: str = "high"
    # Synthesis-specific generation controls (gemini-3.6-flash is a thinking model).
    synthesis_temperature: float = 1.0
    synthesis_thinking_level: str = "high"  # "" disables; else low|medium|high (Gemma instead needs minimal|high)

    # Character caps on the private-context we feed each step. Feeding the whole case on
    # every round is what makes an agentic loop expensive; these keep spend predictable.
    plan_context_chars: int = 6000
    round_context_chars: int = 8000
    synth_context_chars: int = 12000

    # Hidden reasoning and visible output share one provider allowance. Keep a modest
    # floor so a low shared summarization cap cannot starve synthesis; the reservation-
    # based application budget still derives a lower safe cap per run.
    _SYNTH_OUTPUT_TOKEN_FLOOR = 4096

    @classmethod
    def from_settings(cls, settings, llm_config: dict | None = None) -> "DeepResearchConfig":
        llm_config = llm_config or {}
        _max = int(
            llm_config.get("max_summarization_output_tokens")
            or llm_config.get("max_output_tokens")
            or 32768
        )
        # Prevent a low shared cap from starving synthesis while keeping a firm configured
        # ceiling; the budget reservation may lower this further.
        _synth_max = min(max(_max, cls._SYNTH_OUTPUT_TOKEN_FLOOR), 32768)
        return cls(
            reasoning_model=(str(getattr(settings, "deep_research_reasoning_model", "") or "").strip()
                             or "gemini-3.1-flash-lite"),
            search_model=(str(getattr(settings, "deep_research_search_model", "") or "").strip()
                          or "gemini-3.1-flash-lite"),
            synthesis_model=(str(getattr(settings, "deep_research_synthesis_model", "") or "").strip()
                             or "gemini-3.6-flash"),
            max_rounds=min(8, max(1, int(getattr(settings, "deep_research_max_rounds", 4) or 4))),
            budget_inr=min(
                150.0,
                max(1.0, float(getattr(settings, "deep_research_budget_inr", 90.0) or 90.0)),
            ),
            synthesis_reserve_frac=min(0.9, max(0.1, float(
                getattr(settings, "deep_research_synthesis_reserve_frac", 0.6) or 0.6))),
            max_output_tokens=_synth_max,
            synthesis_temperature=float(
                getattr(settings, "deep_research_synthesis_temperature", 1.0) or 1.0),
            synthesis_thinking_level=str(
                getattr(settings, "deep_research_synthesis_thinking_level", "high") or "high").strip().lower(),
            reasoning_thinking_level=str(
                getattr(settings, "deep_research_reasoning_thinking_level", "high") or "high").strip().lower(),
            search_usd_per_query=min(1.0, max(0.000001, float(
                getattr(settings, "deep_research_search_usd_per_query", 0.014) or 0.014))),
            max_sources=min(32, max(1, int(
                getattr(settings, "deep_research_max_sources", 24) or 24))),
            source_concurrency=min(8, max(1, int(
                getattr(settings, "deep_research_source_concurrency", 6) or 6))),
            source_timeout_s=min(20.0, max(2.0, float(
                getattr(settings, "deep_research_source_timeout_s", 8.0) or 8.0))),
            source_max_bytes=min(1_000_000, max(64_000, int(
                getattr(settings, "deep_research_source_max_bytes", 750_000) or 750_000))),
            source_max_redirects=min(5, max(0, int(
                getattr(settings, "deep_research_source_max_redirects", 4) or 4))),
            stage_timeout_s=min(240.0, max(15.0, float(
                getattr(settings, "deep_research_stage_timeout_s", 240.0) or 240.0))),
            run_timeout_s=min(900.0, max(60.0, float(
                getattr(settings, "deep_research_run_timeout_s", 720.0) or 720.0))),
            synthesis_timeout_retries=min(2, max(0, int(
                getattr(settings, "deep_research_synthesis_timeout_retries", 1)))),
            queue_timeout_s=min(30.0, max(0.1, float(
                getattr(settings, "deep_research_queue_timeout_s", 5.0) or 5.0))),
            max_concurrent_runs=min(8, max(1, int(
                getattr(settings, "deep_research_max_concurrent_runs", 2) or 2))),
        )

    @property
    def synthesis_reserve_inr(self) -> float:
        """Rupees held back so the final report can always be written."""
        return self.budget_inr * self.synthesis_reserve_frac
