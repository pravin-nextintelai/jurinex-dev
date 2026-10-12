"""Throwaway verification routes, mounted only when ENVIRONMENT is not production.

GET /internal/error-logs/_debug/...
  raise            unhandled exception           -> 1 row (user_message + stack)
  http-500         raise HTTPException(500)      -> 1 row
  return-500       route answers 500 itself      -> 1 row (HttpErrorResponse500)
  logged-and-ok    logger.exception then 200     -> no row
  external-fail    failed external call + 500    -> exactly 1 merged row
  gemini-fail      invalid Gemini key + 500      -> 1 merged row (needs network)
  stream-fail      SSE stream dies mid-way       -> 1 row (after_response_start)
  background-fail  BackgroundTask raises         -> 1 row (after_response_start)
  not-found        404                           -> no row
  stats            writer / recorder counters
  recent?limit=N   last rows from the DB (X-Internal-Key required, direct DB sink only)

No ``from __future__ import annotations``: FastAPI needs real types on the
route signatures and the FastAPI imports are local to this module.
"""
import asyncio
import hmac
import logging
from typing import Any, Dict, List, Optional

from .config import Config

log = logging.getLogger("errorlog.debug")  # own prefix: never captured


def _recent_rows(cfg: Config, limit: int, table: str = "error_logs") -> List[Dict[str, Any]]:
    url = cfg.database_url
    if not url:
        return []
    if table == "api_audit_logs":
        cols = (
            "id, created_at, service_name, request_id, user_id, user_email, ip_address, http_method, endpoint, route, "
            "status_code, status, duration_ms, error_log_id, resource_type, resource_id, action, method, payload"
        )
        sql = f"SELECT {cols} FROM api_audit_logs ORDER BY created_at DESC LIMIT %s"
    else:
        cols = (
            "id, created_at, service_name, source, category, severity, status_code, http_method, endpoint, "
            "method, error_type, left(error_message, 300) AS error_message, left(user_message, 300) AS user_message, "
            "external_provider, external_status_code, external_error_code, fingerprint, request_id, user_id, payload"
        )
        sql = f"SELECT {cols} FROM error_logs ORDER BY created_at DESC LIMIT %s"
    try:
        import psycopg
        from psycopg.rows import dict_row

        with psycopg.connect(url, connect_timeout=5, row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute(sql, (limit,))
                return [dict(r) for r in cur.fetchall()]
    except ImportError:
        pass
    try:
        import psycopg2
        import psycopg2.extras

        conn = psycopg2.connect(url, connect_timeout=5)
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(sql, (limit,))
                return [dict(r) for r in cur.fetchall()]
        finally:
            conn.close()
    except ImportError:
        return [{"error": "no psycopg driver available for the debug read"}]


def build_debug_router(handle, cfg: Config):
    from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request
    from fastapi.responses import JSONResponse, StreamingResponse

    router = APIRouter(prefix="/internal/error-logs/_debug", include_in_schema=False)
    svc_log = logging.getLogger("debug_route_service")

    @router.get("/raise")
    async def debug_raise():
        raise ValueError("errorlog debug: unhandled exception")

    @router.get("/http-500")
    async def debug_http_500():
        try:
            {}["missing"]
        except KeyError as exc:
            raise HTTPException(status_code=500, detail=f"errorlog debug: http 500 ({exc})") from exc

    @router.get("/return-500")
    async def debug_return_500():
        try:
            int("not-a-number")
        except ValueError:
            svc_log.exception("errorlog debug: route handled its own error")
        return JSONResponse(status_code=500, content={"detail": "errorlog debug: route returned 500"})

    @router.get("/logged-and-ok")
    async def debug_logged_and_ok():
        try:
            raise RuntimeError("errorlog debug: recovered error")
        except RuntimeError:
            svc_log.exception("errorlog debug: recovered, answering 200")
        return {"ok": True}

    @router.get("/external-fail")
    async def debug_external_fail():
        import httpx

        try:
            # Port 9 (discard) is never listening: connection refused / timeout.
            httpx.get("http://127.0.0.1:9/unreachable?key=SECRET-SHOULD-BE-STRIPPED", timeout=1.0)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail="errorlog debug: upstream call failed") from exc
        return {"ok": True}

    @router.get("/gemini-fail")
    async def debug_gemini_fail():
        try:
            from google import genai  # type: ignore

            client = genai.Client(api_key="invalid-key-for-errorlog-debug")
            await asyncio.get_running_loop().run_in_executor(
                None, lambda: client.models.generate_content(model="gemini-2.5-flash", contents="ping")
            )
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail="errorlog debug: gemini call failed") from exc
        return {"ok": True}

    @router.get("/stream-fail")
    async def debug_stream_fail():
        async def gen():
            yield b"data: first chunk\n\n"
            await asyncio.sleep(0.01)
            raise RuntimeError("errorlog debug: stream died")

        return StreamingResponse(gen(), media_type="text/event-stream")

    @router.get("/background-fail")
    async def debug_background_fail(tasks: BackgroundTasks):
        def boom():
            raise RuntimeError("errorlog debug: background task failed")

        tasks.add_task(boom)
        return {"ok": True, "note": "background task will fail after this response"}

    @router.get("/not-found")
    async def debug_not_found():
        raise HTTPException(status_code=404, detail="errorlog debug: not found")

    @router.get("/stats")
    async def debug_stats():
        return handle.stats()

    @router.get("/recent")
    async def debug_recent(request: Request, limit: int = 20, x_internal_key: Optional[str] = Header(default=None)):
        if cfg.ingest_key and not (x_internal_key and hmac.compare_digest(x_internal_key.strip(), cfg.ingest_key)):
            raise HTTPException(status_code=401, detail="invalid internal key")
        handle.flush(timeout=3.0)
        rows = await asyncio.get_running_loop().run_in_executor(None, lambda: _recent_rows(cfg, max(1, min(limit, 200))))
        return {"count": len(rows), "rows": rows}

    @router.get("/audit-recent")
    async def debug_audit_recent(request: Request, limit: int = 20, x_internal_key: Optional[str] = Header(default=None)):
        if cfg.ingest_key and not (x_internal_key and hmac.compare_digest(x_internal_key.strip(), cfg.ingest_key)):
            raise HTTPException(status_code=401, detail="invalid internal key")
        handle.flush(timeout=3.0)
        rows = await asyncio.get_running_loop().run_in_executor(None, lambda: _recent_rows(cfg, max(1, min(limit, 200)), table="api_audit_logs"))
        return {"count": len(rows), "rows": rows}

    return router
