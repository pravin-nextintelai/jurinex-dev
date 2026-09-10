"""Transient upstream failures must not throw away a whole analysis run.

A single `503 UNAVAILABLE` from Gemini — a capacity blip, not a bad request —
used to propagate out of the ADK runner and fail the entire /analyze call,
discarding every stage that had already succeeded.
"""

import asyncio

import pytest
from google.genai import errors as genai_errors

import agents


def _server_error(code=503, status="UNAVAILABLE"):
    return genai_errors.ServerError(
        code, {"error": {"code": code, "message": "The service is currently "
                                                  "unavailable.", "status": status}})


# ── Which errors are worth retrying ──────────────────────────────────────────

def test_transient_upstream_errors_are_recognised():
    for code in (408, 429, 500, 502, 503, 504):
        assert agents._is_transient_llm_error(_server_error(code)), code


def test_bad_requests_are_not_retried():
    """A 400/404 is our fault or the model's absence — retrying wastes time
    and hides the real problem."""
    bad = genai_errors.ClientError(400, {"error": {"code": 400, "message":
        "Budget 0 is invalid.", "status": "INVALID_ARGUMENT"}})
    missing = genai_errors.ClientError(404, {"error": {"code": 404,
        "message": "model not found", "status": "NOT_FOUND"}})
    assert not agents._is_transient_llm_error(bad)
    assert not agents._is_transient_llm_error(missing)


def test_transient_text_markers_without_a_code():
    assert agents._is_transient_llm_error(RuntimeError("model is overloaded, try again"))
    assert not agents._is_transient_llm_error(RuntimeError("invalid schema"))


# ── The retry itself ─────────────────────────────────────────────────────────

def _patch_attempt(monkeypatch, results):
    calls = {"n": 0}

    async def _fake(agent, message, output_keys):
        i = calls["n"]
        calls["n"] += 1
        outcome = results[i]
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    monkeypatch.setattr(agents, "_run_agent_attempt", _fake)
    # agents.asyncio IS the asyncio module, so capture the real sleep before
    # patching it — otherwise the stand-in calls itself.
    real_sleep = asyncio.sleep
    monkeypatch.setattr(agents.asyncio, "sleep", lambda _d: real_sleep(0))
    return calls


class _Agent:
    name = "issue_split"
    model = "gemini-3.5-flash-lite"


def test_a_503_is_retried_and_the_run_survives(monkeypatch):
    calls = _patch_attempt(monkeypatch, [_server_error(), {"issues": ["ok"]}])
    out = asyncio.run(agents.run_agent_once(_Agent(), "msg", ["issues"]))
    assert out == {"issues": ["ok"]}
    assert calls["n"] == 2


def test_it_gives_up_after_the_configured_attempts(monkeypatch):
    calls = _patch_attempt(monkeypatch, [_server_error()] * 5)
    with pytest.raises(genai_errors.ServerError):
        asyncio.run(agents.run_agent_once(_Agent(), "msg", ["issues"]))
    assert calls["n"] == len(agents._RETRY_DELAYS) + 1


def test_a_bad_request_fails_immediately(monkeypatch):
    bad = genai_errors.ClientError(400, {"error": {"code": 400,
        "message": "bad", "status": "INVALID_ARGUMENT"}})
    calls = _patch_attempt(monkeypatch, [bad, {"issues": []}])
    with pytest.raises(genai_errors.ClientError):
        asyncio.run(agents.run_agent_once(_Agent(), "msg", ["issues"]))
    assert calls["n"] == 1, "a 400 must not be retried"
