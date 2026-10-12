"""Outgoing HTTP hook for httpx, requests, aiohttp and urllib.

Patched once at the class level so every client instance, including the ones
SDKs create internally, is covered. Records non-2xx responses, timeouts and
connection errors; forwards ``x-request-id``; strips query strings from URLs.
"""
from __future__ import annotations

import functools
import logging
import time
from typing import Any, List, Optional

from .config import Config
from .context import get_context, in_sdk_call, is_internal
from .recorder import Recorder
from .sanitize import host_of, strip_query, truncate

log = logging.getLogger("errorlog")

REQUEST_ID_HEADER = "x-request-id"
_IN_PROCESS_TRANSPORTS = {"ASGITransport", "WSGITransport", "_TestClientTransport", "TestClientTransport"}


class HttpHook:
    def __init__(self, recorder: Recorder, cfg: Config) -> None:
        self.recorder = recorder
        self.cfg = cfg

    def provider(self, url: Optional[str]) -> Optional[str]:
        host = host_of(url)
        name = self.cfg.provider_for_host(host)
        if name:
            return name
        return (host or None) and host.split(":", 1)[0][:50].upper()

    def should_skip(self, url: Optional[str]) -> bool:
        if is_internal():
            return True
        if url and ("/internal/error-logs" in url or "/internal/audit-logs" in url):
            return True
        if in_sdk_call() and self.provider(url) == "GEMINI":
            return True
        return False

    def request_id(self) -> Optional[str]:
        ctx = get_context()
        return ctx.request_id if ctx is not None else None

    def record(
        self,
        *,
        url: Optional[str],
        method: Optional[str],
        status: Optional[int],
        exc: Optional[BaseException],
        started: float,
        response_text: Optional[str] = None,
        reason: Optional[str] = None,
    ) -> None:
        try:
            if exc is None and (status is None or status < 400):
                return
            if self.should_skip(url):
                return
            latency = int((time.perf_counter() - started) * 1000)
            payload = {"http_method": (method or "").upper()[:10]}
            ev = self.recorder.event_external(
                provider=self.provider(url),
                url=strip_query(url),
                status=status,
                exc=exc,
                latency_ms=latency,
                response_text=response_text or reason,
                error_code=(reason[:100] if reason and exc is None and status is None else None),
                payload=payload,
            )
            self.recorder.record(ev)
        except Exception as inner:  # noqa: BLE001
            log.debug("errorlog: http record failed: %s", inner)


def _safe_text(getter, limit: int = 2000) -> Optional[str]:
    try:
        text = getter()
        if isinstance(text, bytes):
            text = text.decode("utf-8", errors="replace")
        return truncate(text, limit) if isinstance(text, str) else None
    except Exception:  # noqa: BLE001
        return None


# ── httpx ────────────────────────────────────────────────────────────────────

def _patch_httpx(hook: HttpHook, patched: List[str]) -> None:
    import httpx

    def inject(request) -> None:
        rid = hook.request_id()
        if rid and REQUEST_ID_HEADER not in request.headers:
            request.headers[REQUEST_ID_HEADER] = rid

    def in_process(client) -> bool:
        # ASGI/WSGI transports (TestClient, in-process mounts) are not external calls.
        transport = getattr(client, "_transport", None)
        return type(transport).__name__ in _IN_PROCESS_TRANSPORTS

    if not getattr(httpx.Client.send, "__errorlog_wrapped__", False):
        orig_send = httpx.Client.send

        @functools.wraps(orig_send)
        def send(self, request, *args, **kwargs):
            if in_process(self):
                return orig_send(self, request, *args, **kwargs)
            url = str(request.url)
            inject(request)
            started = time.perf_counter()
            try:
                response = orig_send(self, request, *args, **kwargs)
            except BaseException as exc:
                if isinstance(exc, Exception):
                    hook.record(url=url, method=request.method, status=None, exc=exc, started=started)
                raise
            if response.status_code >= 400:
                text = None if kwargs.get("stream") else _safe_text(lambda: response.text)
                hook.record(url=url, method=request.method, status=response.status_code, exc=None, started=started, response_text=text, reason=response.reason_phrase)
            return response

        send.__errorlog_wrapped__ = True  # type: ignore[attr-defined]
        httpx.Client.send = send  # type: ignore[assignment]
        patched.append("httpx.Client.send")

    if not getattr(httpx.AsyncClient.send, "__errorlog_wrapped__", False):
        orig_asend = httpx.AsyncClient.send

        @functools.wraps(orig_asend)
        async def asend(self, request, *args, **kwargs):
            if in_process(self):
                return await orig_asend(self, request, *args, **kwargs)
            url = str(request.url)
            inject(request)
            started = time.perf_counter()
            try:
                response = await orig_asend(self, request, *args, **kwargs)
            except BaseException as exc:
                if isinstance(exc, Exception):
                    hook.record(url=url, method=request.method, status=None, exc=exc, started=started)
                raise
            if response.status_code >= 400:
                text = None
                if not kwargs.get("stream"):
                    try:
                        text = truncate(response.text, 2000)
                    except Exception:  # noqa: BLE001
                        text = None
                hook.record(url=url, method=request.method, status=response.status_code, exc=None, started=started, response_text=text, reason=response.reason_phrase)
            return response

        asend.__errorlog_wrapped__ = True  # type: ignore[attr-defined]
        httpx.AsyncClient.send = asend  # type: ignore[assignment]
        patched.append("httpx.AsyncClient.send")


# ── requests ─────────────────────────────────────────────────────────────────

def _patch_requests(hook: HttpHook, patched: List[str]) -> None:
    import requests

    if getattr(requests.Session.send, "__errorlog_wrapped__", False):
        return
    orig_send = requests.Session.send

    @functools.wraps(orig_send)
    def send(self, request, **kwargs):
        url = getattr(request, "url", None)
        try:
            rid = hook.request_id()
            if rid and request.headers is not None and REQUEST_ID_HEADER not in {k.lower() for k in request.headers}:
                request.headers[REQUEST_ID_HEADER] = rid
        except Exception:  # noqa: BLE001
            pass
        started = time.perf_counter()
        try:
            response = orig_send(self, request, **kwargs)
        except BaseException as exc:
            if isinstance(exc, Exception):
                hook.record(url=url, method=getattr(request, "method", None), status=None, exc=exc, started=started)
            raise
        status = getattr(response, "status_code", None)
        if isinstance(status, int) and status >= 400:
            text = None if kwargs.get("stream") else _safe_text(lambda: response.text)
            hook.record(url=url, method=getattr(request, "method", None), status=status, exc=None, started=started, response_text=text, reason=getattr(response, "reason", None))
        return response

    send.__errorlog_wrapped__ = True  # type: ignore[attr-defined]
    requests.Session.send = send  # type: ignore[assignment]
    patched.append("requests.Session.send")


# ── aiohttp ──────────────────────────────────────────────────────────────────

def _patch_aiohttp(hook: HttpHook, patched: List[str]) -> None:
    import aiohttp

    if getattr(aiohttp.ClientSession._request, "__errorlog_wrapped__", False):  # noqa: SLF001
        return
    orig = aiohttp.ClientSession._request  # noqa: SLF001

    @functools.wraps(orig)
    async def _request(self, method, str_or_url, **kwargs):
        url = str(str_or_url)
        try:
            rid = hook.request_id()
            if rid:
                headers = kwargs.get("headers")
                if headers is None:
                    kwargs["headers"] = {REQUEST_ID_HEADER: rid}
                elif REQUEST_ID_HEADER not in {str(k).lower() for k in headers.keys()}:
                    try:
                        headers[REQUEST_ID_HEADER] = rid
                    except Exception:  # noqa: BLE001
                        pass
        except Exception:  # noqa: BLE001
            pass
        started = time.perf_counter()
        try:
            response = await orig(self, method, str_or_url, **kwargs)
        except BaseException as exc:
            if isinstance(exc, Exception):
                hook.record(url=url, method=method, status=None, exc=exc, started=started)
            raise
        status = getattr(response, "status", None)
        if isinstance(status, int) and status >= 400:
            # The body is not read here: that would consume it for the caller.
            hook.record(url=url, method=method, status=status, exc=None, started=started, reason=getattr(response, "reason", None))
        return response

    _request.__errorlog_wrapped__ = True  # type: ignore[attr-defined]
    aiohttp.ClientSession._request = _request  # type: ignore[assignment]  # noqa: SLF001
    patched.append("aiohttp.ClientSession._request")


# ── urllib ───────────────────────────────────────────────────────────────────

def _patch_urllib(hook: HttpHook, patched: List[str]) -> None:
    import urllib.error
    import urllib.request

    if getattr(urllib.request.OpenerDirector.open, "__errorlog_wrapped__", False):
        return
    orig_open = urllib.request.OpenerDirector.open

    @functools.wraps(orig_open)
    def open_(self, fullurl, data=None, timeout=urllib.request.socket._GLOBAL_DEFAULT_TIMEOUT):  # type: ignore[attr-defined]  # noqa: SLF001
        if isinstance(fullurl, urllib.request.Request):
            req = fullurl
            url = req.full_url
            method = req.get_method()
            try:
                rid = hook.request_id()
                if rid and not req.has_header("X-request-id"):
                    req.add_header("X-Request-Id", rid)
            except Exception:  # noqa: BLE001
                pass
        else:
            url = str(fullurl)
            method = "POST" if data is not None else "GET"
        started = time.perf_counter()
        try:
            return orig_open(self, fullurl, data, timeout)
        except urllib.error.HTTPError as exc:
            # The body is left unread so the caller can still read it.
            hook.record(url=url, method=method, status=int(getattr(exc, "code", 0) or 0) or None, exc=None, started=started, reason=str(getattr(exc, "reason", "")))
            raise
        except Exception as exc:  # noqa: BLE001
            hook.record(url=url, method=method, status=None, exc=exc, started=started)
            raise

    open_.__errorlog_wrapped__ = True  # type: ignore[attr-defined]
    urllib.request.OpenerDirector.open = open_  # type: ignore[assignment]
    patched.append("urllib.request.OpenerDirector.open")


def install_http_hooks(recorder: Recorder, cfg: Config) -> List[str]:
    hook = HttpHook(recorder, cfg)
    patched: List[str] = []
    for name, fn in (("httpx", _patch_httpx), ("requests", _patch_requests), ("aiohttp", _patch_aiohttp), ("urllib", _patch_urllib)):
        try:
            fn(hook, patched)
        except ImportError:
            continue
        except Exception as exc:  # noqa: BLE001
            log.debug("errorlog: %s patch failed: %s", name, exc)
    return patched
