"""Thin, synchronous google.genai wrappers used by the Deep Research loop.

All calls here are blocking network calls — the orchestrator runs them through its
bounded worker guard. Keeping them synchronous makes them straightforward to reason about and
unit-test. Deep Research creates its own timeout-bounded client while reusing the existing
model-aware Gemini/Gemma API-key selector.
"""

from __future__ import annotations

import math
from typing import Any, Iterator


_DEFAULT_STAGE_TIMEOUT_S = 240.0
_DEFAULT_TRANSPORT_TIMEOUT_S = 210.0
_MIN_STAGE_TIMEOUT_S = 15.0
_MAX_STAGE_TIMEOUT_S = 240.0
_MIN_TRANSPORT_TIMEOUT_S = 5.0
_MAX_TRANSPORT_TIMEOUT_S = 235.0
_TRANSPORT_DEADLINE_MARGIN_S = 5.0


def _transport_timeout_ms(settings: Any) -> int:
    """Return a transport timeout that expires before the orchestration deadline."""

    try:
        stage_timeout_s = float(
            getattr(settings, "deep_research_stage_timeout_s", _DEFAULT_STAGE_TIMEOUT_S)
        )
    except (TypeError, ValueError, OverflowError):
        stage_timeout_s = _DEFAULT_STAGE_TIMEOUT_S
    if not math.isfinite(stage_timeout_s):
        stage_timeout_s = _DEFAULT_STAGE_TIMEOUT_S
    stage_timeout_s = min(
        _MAX_STAGE_TIMEOUT_S,
        max(_MIN_STAGE_TIMEOUT_S, stage_timeout_s),
    )

    try:
        transport_timeout_s = float(
            getattr(
                settings,
                "deep_research_transport_timeout_s",
                _DEFAULT_TRANSPORT_TIMEOUT_S,
            )
        )
    except (TypeError, ValueError, OverflowError):
        transport_timeout_s = _DEFAULT_TRANSPORT_TIMEOUT_S
    if not math.isfinite(transport_timeout_s):
        transport_timeout_s = _DEFAULT_TRANSPORT_TIMEOUT_S

    # Settings validates the stage at >=15s, but retain a defensive lower bound for
    # direct/unit-test callers. The gap prevents the transport and asyncio deadlines
    # from racing and leaving a detached worker exception behind.
    transport_ceiling = max(
        _MIN_TRANSPORT_TIMEOUT_S,
        min(
            _MAX_TRANSPORT_TIMEOUT_S,
            stage_timeout_s - _TRANSPORT_DEADLINE_MARGIN_S,
        ),
    )
    transport_timeout_s = min(
        transport_ceiling,
        max(_MIN_TRANSPORT_TIMEOUT_S, transport_timeout_s),
    )
    return int(transport_timeout_s * 1000)


def _client(model: str):
    """Create a Deep-only client whose transport cannot outlive the stage indefinitely."""

    from google import genai
    from google.genai import types

    from app.core.config import get_settings
    from app.services.adapters import document_ai

    api_key = document_ai._gemini_api_key_for_model(  # noqa: SLF001 - shared key policy
        model
    )
    if not api_key:
        return None
    settings = get_settings()
    return genai.Client(
        api_key=api_key,
        http_options=types.HttpOptions(timeout=_transport_timeout_ms(settings)),
    )


def _close_client(client: Any) -> None:
    close = getattr(client, "close", None)
    if callable(close):
        try:
            close()
        except Exception:
            pass


def client_available(*models: str) -> bool:
    """Return whether every requested model has a configured provider client."""

    names = tuple(str(model or "").strip() for model in models)
    if not names or any(not name for name in names):
        return False
    clients: list[Any] = []
    try:
        for name in dict.fromkeys(names):
            client = _client(name)
            if client is None:
                return False
            clients.append(client)
        return True
    except Exception:
        return False
    finally:
        for client in clients:
            _close_client(client)


def _usage(resp: Any) -> tuple[int, int]:
    um = getattr(resp, "usage_metadata", None)
    if um is None:
        return 0, 0
    inp = int(getattr(um, "prompt_token_count", 0) or 0)
    cand = int(getattr(um, "candidates_token_count", 0) or 0)
    total = int(getattr(um, "total_token_count", 0) or 0)
    # Thinking models (e.g. gemini-3.6-flash) emit hidden reasoning tokens billed at the
    # OUTPUT rate but not counted in candidates_token_count. Fold them into output so the
    # ₹ cost is accurate: Total = Input + Output.
    out = total - inp if total > inp + cand else cand
    return inp, max(0, out)


def _text(resp: Any) -> str:
    t = getattr(resp, "text", None)
    if t:
        return t
    # Fallback: concatenate candidate part texts (thinking parts are skipped by .text anyway).
    out: list[str] = []
    try:
        for cand in getattr(resp, "candidates", None) or []:
            content = getattr(cand, "content", None)
            for part in getattr(content, "parts", None) or []:
                pt = getattr(part, "text", None)
                if pt:
                    out.append(pt)
    except Exception:
        pass
    return "".join(out)


def _grounding_metadata(resp: Any) -> tuple[list[dict[str, Any]], int]:
    """Extract sources, claim support indices, and the billable search-query count."""
    out: list[dict[str, Any]] = []
    queries: set[str] = set()
    support_no = 0
    try:
        for cand in getattr(resp, "candidates", None) or []:
            gm = getattr(cand, "grounding_metadata", None)
            if not gm:
                continue
            for query in getattr(gm, "web_search_queries", None) or []:
                value = str(query or "").strip()
                if value:
                    queries.add(value)
            candidate_sources: list[dict[str, Any]] = []
            for gch in getattr(gm, "grounding_chunks", None) or []:
                web = getattr(gch, "web", None)
                uri = getattr(web, "uri", None) if web else None
                if not uri:
                    candidate_sources.append({})
                    continue
                title = getattr(web, "title", None) if web else None
                source = {
                    "uri": str(uri),
                    "title": str(title or uri),
                    "claim_ids": [],
                    "claim_texts": [],
                }
                candidate_sources.append(source)
            for support in getattr(gm, "grounding_supports", None) or []:
                support_no += 1
                segment = getattr(support, "segment", None)
                claim_text = str(getattr(segment, "text", "") or "").strip()
                claim_id = f"g{support_no}"
                for raw_index in getattr(support, "grounding_chunk_indices", None) or []:
                    try:
                        source = candidate_sources[int(raw_index)]
                    except (IndexError, TypeError, ValueError):
                        continue
                    if not source:
                        continue
                    source["claim_ids"].append(claim_id)
                    if claim_text:
                        source["claim_texts"].append(claim_text)
            out.extend(
                source for source in candidate_sources if source and source["claim_ids"]
            )
    except Exception:
        pass
    for source in out:
        source["claim_ids"] = list(dict.fromkeys(source["claim_ids"]))
        source["claim_texts"] = list(dict.fromkeys(source["claim_texts"]))
    return out, len(queries)


def _thinking_config_rejected(exc: Exception) -> bool:
    """Retry only an explicit client-side rejection of ``thinking_config``."""
    raw_status = getattr(exc, "status_code", None) or getattr(exc, "code", None)
    try:
        status = int(raw_status)
    except (TypeError, ValueError, OverflowError):
        status = 0
    if status != 400:
        return False
    message = str(exc or "").casefold()
    mentions_thinking = "thinking" in message
    unsupported = any(
        marker in message
        for marker in ("not supported", "unsupported", "unknown field", "unrecognized field")
    )
    return mentions_thinking and unsupported


def _generate_with_optional_thinking(client, model: str, prompt: str, *, base_kwargs: dict, thinking_level: str):
    """`generate_content` that requests `thinking_level` when given, but FALLS BACK to a plain
    no-thinking call if the model rejects it.

    gemini-3.1-flash-lite (plan / round-search / gap-check) is NOT confirmed to support
    thinking_level — a lite model can 400 on it. Rather than break the whole Deep Research run,
    we retry the same call once without the thinking_config. ThinkingConfig construction itself is
    also guarded so an older SDK simply runs without it."""
    from google.genai import types

    def _run(use_thinking: bool):
        kw = dict(base_kwargs)
        if use_thinking and thinking_level:
            try:
                kw["thinking_config"] = types.ThinkingConfig(thinking_level=thinking_level)
            except Exception:
                pass  # SDK without ThinkingConfig / unsupported field → run without it
        return client.models.generate_content(
            model=model, contents=prompt, config=types.GenerateContentConfig(**kw),
        )

    try:
        return _run(use_thinking=True)
    except Exception as exc:
        if thinking_level and _thinking_config_rejected(exc):
            # Most likely the model rejected thinking_level at the API layer — retry once plainly
            # so a lite model that lacks thinking still returns a normal answer.
            return _run(use_thinking=False)
        raise


def reason(model: str, prompt: str, *, temperature: float, max_output_tokens: int,
           thinking_level: str = "") -> tuple[str, int, int]:
    """Plain, NON-grounded call for planning / gap decisions. Returns (text, in_tok, out_tok).
    `thinking_level` (low|medium|high for Gemini) is best-effort with a safe no-thinking fallback
    — see `_generate_with_optional_thinking`."""
    client = _client(model)
    if client is None:
        return "", 0, 0
    try:
        resp = _generate_with_optional_thinking(
            client, model, prompt,
            base_kwargs=dict(temperature=temperature, max_output_tokens=max_output_tokens),
            thinking_level=thinking_level,
        )
        it, ot = _usage(resp)
        return _text(resp), it, ot
    finally:
        _close_client(client)


def search(model: str, prompt: str, *, temperature: float, max_output_tokens: int,
           thinking_level: str = "") -> tuple[str, list[dict[str, Any]], int, int, int]:
    """Returns (text, citations, input tokens, output tokens, search-query count).
    `thinking_level` is best-effort with the same safe fallback as `reason`."""
    from google.genai import types
    client = _client(model)
    if client is None:
        return "", [], 0, 0, 0
    try:
        resp = _generate_with_optional_thinking(
            client, model, prompt,
            base_kwargs=dict(
                temperature=temperature,
                max_output_tokens=max_output_tokens,
                tools=[types.Tool(google_search=types.GoogleSearch())],
            ),
            thinking_level=thinking_level,
        )
        it, ot = _usage(resp)
        citations, search_queries = _grounding_metadata(resp)
        return _text(resp), citations, it, ot, search_queries
    finally:
        _close_client(client)


def synthesis_stream(
    model: str, prompt: str, *, temperature: float, max_output_tokens: int,
    thinking_level: str = "", use_google_search: bool = True,
) -> Iterator[Any]:
    """Streaming synthesis, yielded one chunk at a time.

    This MUST be a generator (not `return iter(stream)`): the genai Client owns the
    underlying httpx transport, and if it is only a local it gets garbage-collected the
    moment the function returns — the next streamed read then fails with "Cannot send a
    request, as the client has been closed". Keeping `client` in this generator's frame
    holds it alive for the whole stream.

    `thinking_level` is passed through to ThinkingConfig as-is: Gemini accepts
    low|medium|high, but Gemma ONLY accepts minimal|high (anything else, including
    "low", 400s on the network call — verified live). The caller (DeepResearchConfig)
    is responsible for supplying a value valid for whichever model is configured; this
    function attaches it defensively so an SDK that lacks ThinkingConfig or the field
    simply runs without it rather than erroring.

    ``use_google_search`` controls optional grounding. The production Deep orchestrator
    disables it after source validation so synthesis is evidence-closed; callers enabling
    it must account for search-query cost and validate every returned source.
    """
    from google.genai import types
    client = _client(model)
    if client is None:
        return

    # Free-tier Gemma is rate-limited GLOBALLY per API key (shared with live document
    # chat on the same key) — this call previously went straight to the network,
    # unpaced, and could collide with that traffic. `_pace_gemma_call` is a no-op for
    # non-Gemma models, so this is safe for the existing Gemini synthesis path too.
    from app.services.adapters import document_ai
    document_ai._pace_gemma_call(  # noqa: SLF001 - shared pacer, intentional reuse
        model, est_input_tokens=document_ai._estimate_input_tokens(prompt)
    )

    cfg_kwargs: dict[str, Any] = dict(
        temperature=temperature,
        max_output_tokens=max_output_tokens,
    )
    if use_google_search:
        cfg_kwargs["tools"] = [types.Tool(google_search=types.GoogleSearch())]
    lvl = (thinking_level or "").strip().lower()
    if lvl:
        try:
            cfg_kwargs["thinking_config"] = types.ThinkingConfig(thinking_level=lvl)
        except Exception:
            pass  # older SDK / unsupported field → run without an explicit thinking level

    stream = client.models.generate_content_stream(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(**cfg_kwargs),
    )
    try:
        for chunk in stream:
            yield chunk
    finally:
        close = getattr(stream, "close", None)
        if callable(close):
            close()
        _close_client(client)
    # `client` and `stream` stay referenced until this generator is exhausted.
    _ = client


def chunk_text_and_usage(chunk: Any) -> tuple[str, int, int]:
    """Pull (delta_text, cumulative_in_tok, cumulative_out_tok) from one stream chunk."""
    it, ot = _usage(chunk)
    txt = getattr(chunk, "text", None) or ""
    if not txt:
        txt = _text(chunk)
    return txt, it, ot


def chunk_finish_reason(chunk: Any) -> str:
    """Return a stable provider finish-state label for one streamed chunk."""

    try:
        for candidate in getattr(chunk, "candidates", None) or []:
            value = getattr(candidate, "finish_reason", None)
            if value is None:
                continue
            label = getattr(value, "name", None)
            if not label:
                label = getattr(value, "value", None) or value
            label = str(label or "").strip()
            if label:
                return label.rsplit(".", 1)[-1].upper()
    except Exception:
        return ""
    return ""


def chunk_citations(chunk: Any) -> list[dict[str, Any]]:
    return _grounding_metadata(chunk)[0]


def chunk_search_query_count(chunk: Any) -> int:
    return _grounding_metadata(chunk)[1]
