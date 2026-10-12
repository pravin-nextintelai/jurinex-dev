"""End-to-end tests for the errorlog package against a real FastAPI app.

Run from Backend/shared/errorlog/python with any service venv that has pytest,
fastapi and httpx, e.g.::

    ..\\..\\..\\agentic-chat-service\\venv\\Scripts\\python.exe -m pytest tests -q

Set ERROR_LOG_TEST_DATABASE_URL to also exercise the direct PostgreSQL sink.
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import unittest

try:
    import pytest
except ImportError:  # unittest discovery in a venv without pytest: skip this module
    raise unittest.SkipTest("pytest is required for tests/test_errorlog.py (pip install pytest)")

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("SERVICE_NAME", "errorlog-tests")
os.environ.setdefault("ERROR_LOG_CAPTURE_ALL", "true")
os.environ.setdefault("IK_API_URL", "https://api.indiankanoon.org")
os.environ.pop("ERROR_LOG_DATABASE_URL", None)
os.environ.pop("ERROR_LOG_INGEST_URL", None)
os.environ["ERROR_LOG_INGEST_KEY"] = "test-ingest-key"
os.environ["ERROR_LOG_FLUSH_INTERVAL_S"] = "0.05"

import httpx  # noqa: E402
from fastapi import BackgroundTasks, FastAPI, HTTPException  # noqa: E402
from fastapi.responses import JSONResponse, StreamingResponse  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import errorlog  # noqa: E402
from errorlog import gemini as gemini_hook  # noqa: E402
from errorlog import sanitize  # noqa: E402
from errorlog.writer import DbSink, MemorySink, Writer  # noqa: E402

svc_log = logging.getLogger("tests.service")


# ── a fake Gemini SDK surface, patched through the real hook ─────────────────

class FakeGeminiError(Exception):
    def __init__(self, code, status, message):
        super().__init__(message)
        self.code = code
        self.status = status
        self.message = message


def _part(text=None, function_call=None):
    return SimpleNamespace(text=text, function_call=function_call, inline_data=None, executable_code=None, code_execution_result=None, file_data=None)


def _resp(parts, finish="STOP", block=None, tokens=(10, 20)):
    cand = SimpleNamespace(finish_reason=SimpleNamespace(name=finish), content=SimpleNamespace(parts=parts))
    pf = SimpleNamespace(block_reason=SimpleNamespace(name=block), block_reason_message=None) if block else None
    usage = SimpleNamespace(prompt_token_count=tokens[0], candidates_token_count=tokens[1], total_token_count=sum(tokens))
    return SimpleNamespace(candidates=[cand] if parts is not None else [], prompt_feedback=pf, usage_metadata=usage, text=(parts[0].text if parts else None))


class FakeModels:
    mode = "ok"

    def generate_content(self, *, model, contents, config=None):
        if self.mode == "raise":
            raise FakeGeminiError(429, "RESOURCE_EXHAUSTED", "Quota exceeded for gemini-2.5-flash")
        if self.mode == "timeout":
            raise FakeGeminiError(504, "DEADLINE_EXCEEDED", "Deadline expired")
        if self.mode == "safety":
            return _resp([], finish="SAFETY")
        if self.mode == "blocked":
            return _resp([_part("")], finish="STOP", block="PROHIBITED_CONTENT")
        if self.mode == "empty":
            return _resp([_part("")])
        if self.mode == "max_tokens":
            return _resp([_part("partial answer")], finish="MAX_TOKENS")
        if self.mode == "nocands":
            return _resp(None)
        return _resp([_part("The limitation period is three years.")])

    def generate_content_stream(self, *, model, contents, config=None):
        def gen():
            yield _resp([_part("chunk one ")])
            if self.mode == "stream_raise":
                raise FakeGeminiError(503, "UNAVAILABLE", "upstream unavailable")
            yield _resp([_part("chunk two")], finish="MAX_TOKENS" if self.mode == "stream_max" else "STOP")

        return gen()


# ── fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def mem_sink():
    return MemorySink()


@pytest.fixture(scope="session")
def app(mem_sink):
    app = FastAPI()

    @app.get("/ok")
    async def ok():
        return {"ok": True}

    @app.get("/raise")
    async def route_raise():
        raise ValueError("boom: unhandled")

    @app.get("/returns-500")
    async def route_returns_500():
        try:
            int("x")
        except ValueError:
            svc_log.exception("route handled its own failure")
        return JSONResponse(status_code=500, content={"detail": "we failed but handled it"})

    @app.get("/http-500")
    async def route_http_500():
        try:
            {}["k"]
        except KeyError as exc:
            raise HTTPException(status_code=500, detail="lookup failed") from exc

    @app.get("/recovered")
    async def route_recovered():
        try:
            raise RuntimeError("recovered")
        except RuntimeError:
            svc_log.exception("recovered fine")
        return {"ok": True}

    @app.get("/not-found")
    async def route_404():
        raise HTTPException(status_code=404, detail="nope")

    @app.get("/validate/{n}")
    async def route_validate(n: int):
        return {"n": n}

    @app.get("/api/files/folders")
    async def list_folders():
        return {"folders": []}

    @app.get("/api/files/cases")
    async def list_cases():
        return {"cases": []}

    @app.get("/gemini/{mode}")
    async def route_gemini(mode: str, fail: int = 1):
        FakeModels.mode = mode
        models = FakeModels()
        try:
            resp = models.generate_content(model="gemini-2.5-flash", contents="hello")
        except Exception as exc:  # noqa: BLE001
            if fail:
                raise HTTPException(status_code=500, detail="AI call failed") from exc
            return {"ok": False, "recovered": True}
        return {"text": getattr(resp, "text", None)}

    @app.get("/gemini-stream/{mode}")
    async def route_gemini_stream(mode: str):
        FakeModels.mode = mode
        models = FakeModels()
        out = []
        try:
            for chunk in models.generate_content_stream(model="gemini-2.5-pro", contents="hello"):
                out.append(chunk.text)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail="stream failed") from exc
        return {"chunks": out}

    @app.get("/gemini-retry")
    async def route_gemini_retry():
        FakeModels.mode = "raise"
        models = FakeModels()
        last = None
        for _ in range(3):
            try:
                models.generate_content(model="gemini-2.5-flash", contents="hello")
            except Exception as exc:  # noqa: BLE001
                last = exc
        raise HTTPException(status_code=500, detail="AI failed after retries") from last

    @app.get("/citation/{status}")
    async def route_citation(status: int, fail: int = 1):
        def handler(request: httpx.Request) -> httpx.Response:
            if status == 0:
                raise httpx.ConnectTimeout("connect timed out", request=request)
            return httpx.Response(status, json={"error": "upstream broke"})

        with httpx.Client(transport=httpx.MockTransport(handler)) as client:
            try:
                r = client.get("https://api.indiankanoon.org/search/?formInput=x&token=SECRET-TOKEN")
            except Exception as exc:  # noqa: BLE001
                if fail:
                    raise HTTPException(status_code=502, detail="citation provider unreachable") from exc
                return {"recovered": True}
        if r.status_code >= 500 and fail:
            raise HTTPException(status_code=502, detail="citation provider failed")
        return {"status": r.status_code}

    @app.get("/forward")
    async def route_forward():
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["rid"] = request.headers.get("x-request-id")
            return httpx.Response(200, json={"ok": True})

        with httpx.Client(transport=httpx.MockTransport(handler)) as client:
            client.get("http://payment.internal/api/x")
        return seen

    @app.get("/stream-fail")
    async def route_stream_fail():
        async def gen():
            yield b"data: one\n\n"
            await asyncio.sleep(0.01)
            raise RuntimeError("stream died")

        return StreamingResponse(gen(), media_type="text/event-stream")

    @app.get("/background-fail")
    async def route_background_fail(tasks: BackgroundTasks):
        def boom():
            raise RuntimeError("background failed")

        tasks.add_task(boom)
        return {"ok": True}

    @app.get("/secret-leak")
    async def route_secret_leak():
        raise RuntimeError("failed calling https://x.googleapis.com/v1?key=AIzaSyFAKEFAKEFAKEFAKEFAKEFAKEFAKE with password=hunter2")

    # A wildcard registered BEFORE install must not shadow the client-report route.
    @app.post("/api/files/{name}")
    async def wildcard(name: str):
        return {"wild": name}

    handle = errorlog.install(
        app, service_name="errorlog-tests", owner=True, own_code_root=HERE, sink=mem_sink, debug_routes=True,
        client_report_path="/api/files/client-errors",
    )
    # Patch the fake SDK through the real hook machinery.
    hook = gemini_hook.GeminiHook(handle.recorder, handle.cfg)
    gemini_hook._patch_class(FakeModels, hook, gemini_hook._SYNC_METHODS, is_async=False, prefix="models.", patched=[])
    return app


@pytest.fixture(scope="session")
def client(app):
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def clear_rows(app, mem_sink):
    handle = errorlog.get()
    handle.flush(2.0)
    mem_sink.rows.clear()
    mem_sink.audit_rows.clear()
    mem_sink.fail = False
    yield
    handle.flush(2.0)


def test_audit_log_rows(client, mem_sink):
    jwt = "Bearer eyJhbGciOiJIUzI1NiJ9.eyJpZCI6NDIsImVtYWlsIjoiYWR2QGV4YW1wbGUuY29tIn0.sig"
    assert client.get("/ok", headers={"authorization": jwt, "x-forwarded-for": "10.9.8.7"}).status_code == 200
    assert client.get("/raise").status_code == 500
    assert client.get("/validate/7").status_code == 200
    client.options("/ok")
    client.get("/internal/error-logs/_debug/stats")
    rows(mem_sink, 1)
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline and len(mem_sink.audit_rows) < 3:
        errorlog.get().flush(0.5)
        time.sleep(0.02)
    audits = list(mem_sink.audit_rows)
    by_ep = {a.endpoint: a for a in audits}
    assert set(by_ep) == {"/ok", "/raise", "/validate/7"}, [a.endpoint for a in audits]
    ok = by_ep["/ok"]
    assert ok.status == "SUCCESS" and ok.status_code == 200 and ok.http_method == "GET"
    assert ok.user_id == "42" and ok.user_email == "adv@example.com" and ok.ip_address == "10.9.8.7"
    assert ok.route == "/ok" and ok.duration_ms is not None and ok.duration_ms >= 0 and ok.error_log_id is None
    assert ok.service_name == "errorlog-tests" and ok.request_id
    assert ok.action == "VIEW" and ok.method and ok.method.endswith(".ok")
    failed = by_ep["/raise"]
    assert failed.status == "FAILED" and failed.status_code == 500
    assert failed.error_log_id == mem_sink.rows[0].id and failed.request_id == mem_sink.rows[0].request_id
    # the error itself travels with the audit row; empty on success
    assert failed.error_type == "ValueError" and "boom: unhandled" in failed.error_message
    assert failed.user_message == "Internal server error"
    assert failed.stack_trace and "route_raise" in failed.stack_trace
    assert ok.error_type is None and ok.error_message is None and ok.user_message is None and ok.stack_trace is None
    assert failed.action == "VIEW" and failed.method
    assert by_ep["/validate/7"].route == "/validate/{n}" and by_ep["/validate/7"].resource_type is None
    assert by_ep["/validate/7"].action == "VIEW"
    # OPTIONS and the error-log routes themselves are never audited
    assert not any((a.http_method or "") == "OPTIONS" for a in audits)


def test_errors_outside_requests_and_client_reports_get_audit_rows(client, mem_sink):
    handle = errorlog.get()
    # a background job failure: no request, still one FAILED audit row
    try:
        raise RuntimeError("nightly job exploded")
    except RuntimeError as exc:
        handle.record_exception(exc, source="JOB", endpoint="job:nightly")
    # a browser report: the activity is the client error, not the POST that carried it
    jwt = "Bearer eyJhbGciOiJIUzI1NiJ9.eyJpZCI6NDIsImVtYWlsIjoiYWR2QGV4YW1wbGUuY29tIn0.sig"
    r = client.post("/api/files/client-errors", json={"kind": "render", "flow": "chat", "message": "white screen", "error": {"name": "TypeError", "message": "x is undefined", "stack": "TypeError: x\n    at Chat (chat.jsx:1:1)"}}, headers={"authorization": jwt})
    assert r.status_code == 202
    rows(mem_sink, 2)
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline and len(mem_sink.audit_rows) < 2:
        handle.flush(0.5)
        time.sleep(0.02)
    by_ep = {a.endpoint: a for a in mem_sink.audit_rows}
    job = by_ep["job:nightly"]
    assert job.status == "FAILED" and job.error_type == "RuntimeError" and "exploded" in job.error_message
    assert job.error_log_id == next(e.id for e in mem_sink.rows if e.endpoint == "job:nightly") and job.payload["source"] == "JOB"
    rep = by_ep["client:chat"]
    assert rep.status == "FAILED" and rep.user_id == "42" and rep.error_type == "TypeError" and "Chat (chat.jsx" in rep.stack_trace
    assert "/api/files/client-errors" not in by_ep  # the carrier POST itself is not activity


def test_audit_meta_matches_admin_table():
    from errorlog import auditmeta

    folder = auditmeta.enrich(
        http_method="GET",
        endpoint="/api/files/folders",
        route="/api/files/folders",
        route_method="app.api.routes.files.list_folders",
        service_name="agentic-document-service",
    )
    assert folder["action"] == "VIEW"
    assert folder["resource_type"] == "STORAGE FOLDER"
    assert folder["method"] == "FolderService.list_folders"
    assert folder["resource_id"] is None

    case = auditmeta.enrich(
        http_method="GET",
        endpoint="/api/files/cases",
        route="/api/files/cases",
        route_method="app.api.routes.files.list_cases",
        service_name="agentic-document-service",
    )
    assert case["action"] == "VIEW"
    assert case["resource_type"] == "CASE"
    assert case["method"] == "CaseService.list_cases"
    assert case["resource_id"] is None

    created = auditmeta.enrich(
        http_method="POST",
        endpoint="/api/files/create-folder",
        resource_type="FOLDER",
        route_method="app.api.routes.files.create_folder",
    )
    assert created["action"] == "CREATE" and created["resource_type"] == "STORAGE FOLDER"


def test_audit_folders_and_cases_store_user_email(client, mem_sink):
    jwt = "Bearer eyJhbGciOiJIUzI1NiJ9.eyJpZCI6NDIsImVtYWlsIjoiYWR2QGV4YW1wbGUuY29tIn0.sig"
    headers = {"authorization": jwt, "x-user-id": "42", "x-user-email": "adv@example.com"}
    assert client.get("/api/files/folders", headers=headers).status_code == 200
    assert client.get("/api/files/cases", headers=headers).status_code == 200
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline and len(mem_sink.audit_rows) < 2:
        errorlog.get().flush(0.5)
        time.sleep(0.02)
    by_ep = {a.endpoint: a for a in mem_sink.audit_rows}
    folders = by_ep["/api/files/folders"]
    assert folders.action == "VIEW" and folders.resource_type == "STORAGE FOLDER"
    assert folders.method == "FolderService.list_folders"
    assert folders.user_id == "42" and folders.user_email == "adv@example.com"
    assert folders.error_log_id is None and folders.resource_id is None
    cases = by_ep["/api/files/cases"]
    assert cases.action == "VIEW" and cases.resource_type == "CASE"
    assert cases.method == "CaseService.list_cases"
    assert cases.user_id == "42" and cases.user_email == "adv@example.com"
    assert cases.error_log_id is None


def test_audit_ingest_endpoint(client, mem_sink):
    row = {"service_name": "gateway-service", "request_id": "abc", "user_id": "9", "http_method": "GET", "endpoint": "/files/x", "status_code": 502, "status": "FAILED", "duration_ms": 12, "error_log_id": "not-a-uuid"}
    assert client.post("/internal/audit-logs", json=[row]).status_code == 401
    r = client.post("/internal/audit-logs", json=[row, {"bad": True}], headers={"X-Internal-Key": "test-ingest-key"})
    assert r.status_code == 200, r.text
    assert r.json()["accepted"] == 1 and r.json()["rejected_count"] == 1
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline and not any(a.service_name == "gateway-service" for a in mem_sink.audit_rows):
        errorlog.get().flush(0.5)
        time.sleep(0.02)
    got = [a for a in mem_sink.audit_rows if a.service_name == "gateway-service"][0]
    assert got.status == "FAILED" and got.status_code == 502 and got.error_log_id is None and got.user_id == "9"
    assert got.action == "VIEW" and got.resource_type == "STORAGE FOLDER" and got.method


def rows(mem_sink, expect=None, timeout=3.0):
    handle = errorlog.get()
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        handle.flush(0.5)
        if expect is None or len(mem_sink.rows) >= expect:
            break
        time.sleep(0.02)
    return list(mem_sink.rows)


# ── tests ───────────────────────────────────────────────────────────────────

def test_unhandled_exception_row(client, mem_sink):
    r = client.get("/raise", headers={"authorization": "Bearer eyJhbGciOiJIUzI1NiJ9.eyJpZCI6NDIsImVtYWlsIjoiYWR2QGV4YW1wbGUuY29tIn0.sig", "x-forwarded-for": "10.1.2.3, 10.0.0.1"})
    assert r.status_code == 500
    assert r.headers.get("x-request-id")
    body = r.json()
    assert body["detail"] == "Internal server error" and body["request_id"] == r.headers["x-request-id"]
    out = rows(mem_sink, 1)
    assert len(out) == 1, [o.error_type for o in out]
    ev = out[0]
    assert ev.error_type == "ValueError" and "boom: unhandled" in ev.error_message
    assert ev.user_message == "Internal server error"
    assert ev.stack_trace and "route_raise" in ev.stack_trace
    assert ev.status_code == 500 and ev.http_method == "GET" and ev.endpoint == "/raise"
    assert ev.request_id == r.headers["x-request-id"]
    assert ev.user_id == "42" and ev.user_email == "adv@example.com"
    assert ev.ip_address == "10.1.2.3"
    assert ev.method and ev.method.endswith("route_raise")
    assert ev.fingerprint and len(ev.fingerprint) == 64
    assert ev.source == "HTTP" and ev.category == "INTERNAL" and ev.severity == "ERROR"


def test_route_returning_500_itself(client, mem_sink):
    r = client.get("/returns-500")
    assert r.status_code == 500
    out = rows(mem_sink, 1)
    assert len(out) == 1
    ev = out[0]
    assert ev.user_message == "we failed but handled it"
    # the logger.exception inside the route supplied the real error
    assert ev.error_type == "ValueError" and "invalid literal" in ev.error_message
    assert ev.status_code == 500


def test_http_exception_500_records_cause(client, mem_sink):
    r = client.get("/http-500")
    assert r.status_code == 500 and r.json()["detail"] == "lookup failed"
    out = rows(mem_sink, 1)
    assert len(out) == 1
    ev = out[0]
    assert ev.error_type == "KeyError"
    assert ev.user_message == "lookup failed"
    assert ev.payload.get("http_detail") == "lookup failed"


def test_recovered_error_stored_as_warning(client, mem_sink):
    r = client.get("/recovered")
    assert r.status_code == 200
    out = rows(mem_sink, 1)
    assert len(out) == 1
    ev = out[0]
    assert ev.error_type == "RuntimeError" and ev.severity == "WARNING"
    assert ev.payload.get("recovered") is True and ev.status_code == 200


def test_404_and_422_get_rows_in_capture_all(client, mem_sink):
    assert client.get("/not-found").status_code == 404
    assert client.get("/validate/abc").status_code == 422
    assert client.get("/does/not/exist").status_code == 404
    out = rows(mem_sink, 3)
    assert [o.error_type for o in out] == ["HttpErrorResponse404", "HttpErrorResponse422", "HttpErrorResponse404"]
    assert all(o.severity == "WARNING" for o in out)
    assert out[0].user_message == "nope" and out[0].status_code == 404
    assert out[2].endpoint == "/does/not/exist"


def test_capture_all_off_keeps_only_user_facing(mem_sink):
    """With ERROR_LOG_CAPTURE_ALL=false only errors the user got are written."""
    import copy

    from errorlog.context import RequestContext
    from errorlog.recorder import Recorder
    from errorlog.writer import MemorySink, Writer

    cfg = copy.copy(errorlog.get().cfg)
    cfg.capture_all = False
    cfg.skip_status = {400, 401, 403, 404, 409, 422}
    sink = MemorySink()
    rec = Recorder(cfg, Writer(cfg, sink=sink))

    def run(status, external=False):
        ctx = RequestContext(request_id="r1", endpoint="/x", http_method="GET")
        try:
            raise ValueError("inner")
        except ValueError as exc:
            ev = rec.event_from_exception(exc)
            if external:
                ev.source = "EXTERNAL_API"
        ctx.pending.append(ev)
        ctx.status_code = status
        ctx.response_started = True
        return rec.flush_context(ctx)

    assert run(200) == 0            # recovered: dropped
    assert run(200, external=True) == 0
    assert run(404) == 0            # skipped status
    assert run(500) == 1            # the user got it
    assert run(502, external=True) == 1
    rec.writer.flush(2.0)
    assert len(sink.rows) == 2
    rec.writer.shutdown(1.0)


def test_gemini_exception_merged_with_500(client, mem_sink):
    r = client.get("/gemini/raise")
    assert r.status_code == 500
    out = rows(mem_sink, 1)
    assert len(out) == 1, [(o.source, o.error_type) for o in out]
    ev = out[0]
    assert ev.source == "EXTERNAL_API" and ev.category == "AI_PROVIDER" and ev.severity == "CRITICAL"
    assert ev.external_provider == "GEMINI" and ev.external_model == "gemini-2.5-flash"
    assert ev.external_status_code == 429 and ev.external_error_code == "RESOURCE_EXHAUSTED"
    assert ev.external_endpoint == "genai.models.generate_content"
    assert ev.latency_ms is not None
    assert ev.status_code == 500 and ev.user_message == "AI call failed"
    assert ev.error_type == "FakeGeminiError"


def test_gemini_timeout_category(client, mem_sink):
    client.get("/gemini/timeout")
    ev = rows(mem_sink, 1)[0]
    assert ev.category == "TIMEOUT" and ev.external_error_code == "DEADLINE_EXCEEDED"


def test_gemini_safety_block_warning(client, mem_sink):
    r = client.get("/gemini/safety")
    assert r.status_code == 200  # the route answered fine, the block is still captured
    first = rows(mem_sink, 1)
    assert len(first) == 1 and first[0].category == "AI_SAFETY_BLOCK" and first[0].payload.get("recovered") is True
    mem_sink.rows.clear()
    FakeModels.mode = "safety"
    handle = errorlog.get()
    hook = gemini_hook.GeminiHook(handle.recorder, handle.cfg)
    hook.inspect_response(_resp([], finish="SAFETY"), model="gemini-2.5-flash", sdk_method="models.generate_content", started=time.perf_counter())
    ev = rows(mem_sink, 1)[0]
    assert ev.category == "AI_SAFETY_BLOCK" and ev.severity == "WARNING" and ev.external_error_code == "SAFETY"
    assert ev.payload.get("tokens") == {"prompt_token_count": 10, "candidates_token_count": 20, "total_token_count": 30}
    assert "output_preview" not in ev.payload


def test_gemini_prompt_blocked_and_empty_and_max_tokens(mem_sink):
    handle = errorlog.get()
    hook = gemini_hook.GeminiHook(handle.recorder, handle.cfg)
    t0 = time.perf_counter()
    hook.inspect_response(_resp([_part("")], block="PROHIBITED_CONTENT"), model="m", sdk_method="models.generate_content", started=t0)
    hook.inspect_response(_resp([_part("  ")]), model="m", sdk_method="models.generate_content", started=t0)
    hook.inspect_response(_resp(None), model="m", sdk_method="models.generate_content", started=t0)
    hook.inspect_response(_resp([_part("partial")], finish="MAX_TOKENS"), model="m", sdk_method="models.generate_content", started=t0)
    hook.inspect_response(_resp([_part("fine")]), model="m", sdk_method="models.generate_content", started=t0)
    hook.inspect_response(_resp([_part(None, function_call={"name": "f"})]), model="m", sdk_method="models.generate_content", started=t0)
    out = rows(mem_sink, 4)
    cats = [(o.category, o.severity, o.external_error_code) for o in out]
    assert cats == [
        ("AI_SAFETY_BLOCK", "WARNING", "PROHIBITED_CONTENT"),
        ("AI_EMPTY_RESPONSE", "ERROR", "EMPTY_RESPONSE"),
        ("AI_EMPTY_RESPONSE", "ERROR", "NO_CANDIDATES"),
        ("AI_EMPTY_RESPONSE", "WARNING", "MAX_TOKENS"),
    ]


def test_gemini_stream_failure(client, mem_sink):
    r = client.get("/gemini-stream/stream_raise")
    assert r.status_code == 500
    out = rows(mem_sink, 1)
    assert len(out) == 1
    ev = out[0]
    assert ev.external_provider == "GEMINI" and ev.external_endpoint == "genai.models.generate_content_stream[stream]"
    assert ev.external_status_code == 503 and ev.user_message == "stream failed"


def test_gemini_retries_collapse_to_one_row(client, mem_sink):
    r = client.get("/gemini-retry")
    assert r.status_code == 500
    out = rows(mem_sink, 1)
    assert len(out) == 1
    assert out[0].payload.get("attempts") == 3


def test_citation_500_query_stripped(client, mem_sink):
    r = client.get("/citation/500")
    assert r.status_code == 502
    out = rows(mem_sink, 1)
    assert len(out) == 1
    ev = out[0]
    assert ev.source == "EXTERNAL_API" and ev.category == "CITATION_PROVIDER"
    assert ev.external_provider == "CITATION" and ev.external_status_code == 500
    assert ev.external_endpoint == "https://api.indiankanoon.org/search/"
    assert "SECRET-TOKEN" not in (ev.external_endpoint or "") and "SECRET" not in (ev.error_message or "")
    assert "upstream broke" in (ev.external_response or "")
    assert ev.status_code == 502 and ev.user_message == "citation provider unreachable" or ev.user_message == "citation provider failed"


def test_citation_timeout(client, mem_sink):
    r = client.get("/citation/0")
    assert r.status_code == 502
    ev = rows(mem_sink, 1)[0]
    assert ev.category == "TIMEOUT" and ev.external_provider == "CITATION"
    assert ev.error_type == "ConnectTimeout"


def test_citation_failure_recovered_is_kept_as_warning(client, mem_sink):
    r = client.get("/citation/500", params={"fail": 0})
    assert r.status_code == 200
    out = rows(mem_sink, 1)
    assert len(out) == 1
    assert out[0].external_provider == "CITATION" and out[0].severity == "WARNING"
    assert out[0].payload.get("recovered") is True and out[0].status_code == 200


def test_request_id_forwarded(client):
    r = client.get("/forward", headers={"x-request-id": "abc-123"})
    assert r.status_code == 200
    assert r.json()["rid"] == "abc-123"
    assert r.headers["x-request-id"] == "abc-123"
    # browsers may read it on cross-origin responses (the frontend reporter relies on it)
    assert "x-request-id" in r.headers.get("access-control-expose-headers", "").lower()


def test_stream_failure_after_response_start(client, mem_sink):
    try:
        client.get("/stream-fail")
    except Exception:  # noqa: BLE001 - the test client may surface the broken stream
        pass
    out = rows(mem_sink, 1)
    assert len(out) == 1
    ev = out[0]
    assert ev.error_type == "RuntimeError" and "stream died" in ev.error_message
    assert ev.payload.get("after_response_start") is True and ev.payload.get("streaming") is True
    assert ev.status_code == 200


def test_background_task_failure(client, mem_sink):
    try:
        client.get("/background-fail")
    except Exception:  # noqa: BLE001
        pass
    out = rows(mem_sink, 1)
    assert len(out) == 1
    assert "background failed" in out[0].error_message
    assert out[0].payload.get("after_response_start") is True


def test_secrets_masked(client, mem_sink):
    client.get("/secret-leak")
    ev = rows(mem_sink, 1)[0]
    assert "AIzaSy" not in ev.error_message and "hunter2" not in ev.error_message
    assert "***" in ev.error_message
    assert "hunter2" not in (ev.stack_trace or "")


def test_sanitize_payload_rules():
    data = {"password": "x", "nested": {"api_key": "k", "list": list(range(50)), "deep": {"deeper": {"deepest": {"too": 1}}}}, "text": "a" * 900, "key": "v", "monkey": "fine"}
    out = sanitize.sanitize_payload(data)
    assert out["password"] == "***" and out["nested"]["api_key"] == "***" and out["key"] == "***"
    assert out["monkey"] == "fine"
    assert len(out["nested"]["list"]) == 21 and out["nested"]["list"][-1] == "+30 more"
    assert len(out["text"]) <= 500
    assert out["nested"]["deep"]["deeper"]["deepest"] == "…"
    assert sanitize.strip_query("https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=AIza123#frag") == "https://generativelanguage.googleapis.com/v1beta/models/x:generateContent"
    assert sanitize.extract_user_message(b'{"detail": {"message": "inner"}}', "application/json") == "inner"
    assert sanitize.extract_user_message(b"<html><body><h1>Internal Server Error</h1></body></html>", "text/html") == "Internal Server Error"


def test_normalize_ingest_url_uses_origin():
    from errorlog.config import _normalize_ingest_url
    assert _normalize_ingest_url("http://127.0.0.1:8092") == "http://127.0.0.1:8092/internal/error-logs"
    assert _normalize_ingest_url("http://127.0.0.1:8092/api/files") == "http://127.0.0.1:8092/internal/error-logs"
    assert _normalize_ingest_url("http://127.0.0.1:8092/internal/audit-logs") == "http://127.0.0.1:8092/internal/error-logs"
    assert _normalize_ingest_url("http://127.0.0.1:8092/internal/error-logs") == "http://127.0.0.1:8092/internal/error-logs"


def test_ingest_endpoint(client, mem_sink):
    row = {"service_name": "gateway-service", "source": "HTTP", "category": "INTERNAL", "severity": "ERROR", "error_type": "TypeError", "error_message": "x is not a function", "status_code": 500, "user_message": "Internal Server Error", "payload": {"token": "secret", "ok": 1}, "external_endpoint": "https://a.b/c?key=1"}
    assert client.post("/internal/error-logs", json=row).status_code == 401
    assert client.post("/internal/error-logs", json=row, headers={"X-Internal-Key": "wrong"}).status_code == 401
    r = client.post("/internal/error-logs", json=[row, {"bad": True}], headers={"X-Internal-Key": "test-ingest-key"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accepted"] == 1 and body["rejected_count"] == 1
    out = rows(mem_sink, 3)
    ingested = [o for o in out if o.service_name == "gateway-service"]
    assert len(ingested) == 1
    assert ingested[0].payload["token"] == "***" and ingested[0].external_endpoint == "https://a.b/c"
    too_many = client.post("/internal/error-logs", json=[row] * 101, headers={"X-Internal-Key": "test-ingest-key"})
    assert too_many.status_code == 413
    # capture-all: the two 401s and the 413 of the misuse are rows too
    out = rows(mem_sink, 4)
    misuse = sorted(o.error_type for o in out if o.service_name == "errorlog-tests")
    assert misuse == ["HttpErrorResponse401", "HttpErrorResponse401", "HttpErrorResponse413"]
    assert all(o.severity == "WARNING" for o in out if o.service_name == "errorlog-tests")


def test_client_report_endpoint(client, mem_sink):
    jwt = "Bearer eyJhbGciOiJIUzI1NiJ9.eyJpZCI6NDIsImVtYWlsIjoiYWR2QGV4YW1wbGUuY29tIn0.sig"
    # without a token: refused, and the refusal itself is not a row
    assert client.post("/api/files/client-errors", json={"kind": "unhandled"}).status_code == 401
    assert rows(mem_sink, timeout=0.3) == []
    # the wildcard /api/files/{name} registered before install does not shadow us
    r = client.post(
        "/api/files/client-errors",
        json={"kind": "unhandled", "flow": "chat", "message": "Cannot read properties of undefined", "page": "/chat/123",
              "error": {"name": "TypeError", "message": "Cannot read properties of undefined (reading 'map')", "stack": "TypeError: x\n    at ChatPanel (chat.jsx:10:5)"}},
        headers={"authorization": jwt},
    )
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["success"] and body["request_id"]
    out = rows(mem_sink, 1)
    assert len(out) == 1
    ev = out[0]
    assert ev.error_type == "TypeError" and ev.source == "HTTP" and ev.severity == "ERROR"
    assert ev.user_id == "42" and ev.user_email == "adv@example.com"
    assert ev.endpoint == "client:chat" and ev.method == "client.chat.unhandled"
    assert "ChatPanel" in ev.stack_trace and ev.payload["page"] == "/chat/123" and ev.payload["client_report"] is True
    assert ev.user_message == "Cannot read properties of undefined"
    # network kind maps the host to a provider and strips the query string
    r = client.post(
        "/api/files/client-errors",
        json={"kind": "network", "flow": "fetch", "url": "https://api.indiankanoon.org/search/?token=SECRET", "error": {"name": "TypeError", "message": "Failed to fetch"}},
        headers={"authorization": jwt},
    )
    assert r.status_code == 202
    ev = rows(mem_sink, 2)[1]
    assert ev.source == "EXTERNAL_API" and ev.external_provider == "CITATION"
    assert ev.external_endpoint == "https://api.indiankanoon.org/search/" and "SECRET" not in str(ev.payload)
    # payment kinds carry the Razorpay fields
    r = client.post(
        "/api/files/client-errors",
        json={"kind": "cancelled", "flow": "token-topup", "message": "Payment cancelled", "plan_name": "Starter"},
        headers={"authorization": jwt},
    )
    assert r.status_code == 202
    ev = rows(mem_sink, 3)[2]
    assert ev.error_type == "PaymentCancelled" and ev.severity == "WARNING" and ev.external_provider == "RAZORPAY"
    assert ev.external_error_code == "USER_CANCELLED" and ev.payload["plan_name"] == "Starter"
    # the wildcard still works for other names
    assert client.post("/api/files/other-thing").json() == {"wild": "other-thing"}


def test_debug_routes_mounted(client, mem_sink):
    r = client.get("/internal/error-logs/_debug/stats")
    assert r.status_code == 200 and r.json()["service_name"] == "errorlog-tests"
    assert client.get("/internal/error-logs/_debug/raise").status_code == 500
    assert client.get("/internal/error-logs/_debug/external-fail").status_code == 500
    out = rows(mem_sink, 2)
    assert len(out) == 2
    ext = [o for o in out if o.source == "EXTERNAL_API"][0]
    assert ext.external_endpoint == "http://127.0.0.1:9/unreachable" and ext.status_code == 500


def test_logger_never_raises_when_db_down():
    from errorlog import config as cfgmod

    os.environ["ERROR_LOG_DATABASE_URL"] = "postgresql://nobody:nothing@127.0.0.1:1/none"
    try:
        cfg = cfgmod.load("down-test", HERE)
        cfg.db_connect_timeout_s = 1
        cfg.flush_interval_s = 0.05
        sink = DbSink(cfg)
        writer = Writer(cfg, sink=sink)
        writer.start()
        ev = errorlog.recorder.Recorder(cfg, writer).event_from_exception(RuntimeError("db is down"))
        assert writer.enqueue(ev) is True
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline and writer.failed_batches == 0:
            time.sleep(0.05)
        assert writer.failed_batches >= 1
        assert writer.stats()["thread_alive"]
        writer.shutdown(timeout=2)
    finally:
        os.environ.pop("ERROR_LOG_DATABASE_URL", None)


def test_memory_sink_failure_is_contained(client, mem_sink):
    mem_sink.fail = True
    r = client.get("/raise")
    assert r.status_code == 500
    time.sleep(0.3)
    handle = errorlog.get()
    assert handle.writer.failed_batches >= 1
    mem_sink.fail = False


def test_queue_overflow_drops_and_counts():
    from errorlog import config as cfgmod

    cfg = cfgmod.load("overflow-test", HERE)
    cfg.queue_max = 100
    sink = MemorySink()
    writer = Writer(cfg, sink=sink)
    # do not start the thread: the queue fills up
    rec = errorlog.recorder.Recorder(cfg, writer)
    writer._thread = object()  # type: ignore[assignment]  # pretend started so enqueue does not start it
    for i in range(150):
        writer.enqueue(rec.event_from_exception(RuntimeError(str(i))))
    assert writer.dropped == 50 and writer.q.qsize() == 100


@pytest.mark.skipif(not os.environ.get("ERROR_LOG_TEST_DATABASE_URL"), reason="ERROR_LOG_TEST_DATABASE_URL not set")
def test_direct_db_sink_roundtrip():
    from errorlog import config as cfgmod

    os.environ["ERROR_LOG_DATABASE_URL"] = os.environ["ERROR_LOG_TEST_DATABASE_URL"]
    try:
        cfg = cfgmod.load("errorlog-db-test", HERE)
        sink = DbSink(cfg)
        rec = errorlog.recorder.Recorder(cfg, Writer(cfg, sink=sink))
        try:
            raise RuntimeError("roundtrip row from pytest")
        except RuntimeError as exc:
            ev = rec.event_from_exception(exc)
        ev.payload = {"token": "secret", "n": 1}
        ev.user_message = "Internal server error"
        rec._fingerprint(ev)  # noqa: SLF001
        sink.write([ev])
        import psycopg

        with psycopg.connect(cfg.database_url) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT error_type, payload->>'token', user_message FROM error_logs WHERE id = %s", (ev.id,))
                got = cur.fetchone()
                assert got == ("RuntimeError", "***", "Internal server error")
                cur.execute("DELETE FROM error_logs WHERE id = %s", (ev.id,))
                conn.commit()
    finally:
        os.environ.pop("ERROR_LOG_DATABASE_URL", None)
