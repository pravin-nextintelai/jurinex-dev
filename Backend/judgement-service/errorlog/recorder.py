"""Build ErrorEvents, collect them per request, merge and hand them to the writer."""
from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Optional

from . import auditmeta, classify
from .config import Config
from .context import RequestContext, get_context, is_internal
from .frames import (
    first_own_frame_of_exception,
    first_own_frame_of_stack,
    format_stack_trace,
    outermost_frame_of_exception,
)
from .model import (
    AUDIT_FAILED,
    AUDIT_SUCCESS,
    CAT_INTERNAL,
    SEV_CRITICAL,
    SEV_WARNING,
    SEVERITY_RANK,
    SOURCE_EXTERNAL,
    SOURCE_HTTP,
    AuditEvent,
    ErrorEvent,
)
from .sanitize import (
    MAX_ERROR_MESSAGE,
    MAX_EXTERNAL_RESPONSE,
    MAX_STACK,
    mask_text,
    sanitize_payload,
    strip_query,
    tail,
    truncate,
)

log = logging.getLogger("errorlog")

# Exceptions that are not errors to record.
_IGNORED_EXC = (KeyboardInterrupt, SystemExit, GeneratorExit)


def _is_cancelled(exc: BaseException) -> bool:
    return type(exc).__name__ == "CancelledError"


_SEEN_ATTR = "__errorlog_recorded__"


def _is_seen(exc: BaseException) -> bool:
    try:
        return getattr(exc, _SEEN_ATTR, False) is True
    except Exception:  # noqa: BLE001
        return False


def _mark_seen(exc: BaseException) -> None:
    try:
        setattr(exc, _SEEN_ATTR, True)
    except Exception:  # noqa: BLE001 - exceptions with __slots__
        pass


class Recorder:
    def __init__(self, cfg: Config, writer) -> None:
        self.cfg = cfg
        self.writer = writer
        self.recorded_total = 0

    # ── building events ────────────────────────────────────────────────────────

    def _base(self, **kw: Any) -> ErrorEvent:
        return ErrorEvent(service_name=self.cfg.service_name, environment=self.cfg.environment, **kw)

    def event_from_exception(
        self,
        exc: BaseException,
        *,
        source: str = SOURCE_HTTP,
        category: Optional[str] = None,
        severity: Optional[str] = None,
        message: Optional[str] = None,
        payload: Optional[Dict[str, Any]] = None,
        after_response_start: bool = False,
        method: Optional[str] = None,
        endpoint: Optional[str] = None,
    ) -> ErrorEvent:
        cat, sev = classify.classify_exception(exc)
        frame = first_own_frame_of_exception(exc, self.cfg.own_code_root)
        if frame is None:
            frame = outermost_frame_of_exception(exc, self.cfg.own_code_root)
        if frame is None:
            frame = first_own_frame_of_stack(self.cfg.own_code_root, skip=2)
        err_msg = str(exc) if str(exc) else type(exc).__name__
        if message:
            err_msg = f"{message} | {err_msg}" if err_msg != type(exc).__name__ else message
        ev = self._base(
            source=source,
            category=category or cat,
            severity=severity or sev,
            error_type=type(exc).__name__[:255],
            error_message=truncate(mask_text(err_msg), MAX_ERROR_MESSAGE) or "",
            stack_trace=tail(mask_text(format_stack_trace(exc)), MAX_STACK),
            method=(method or (frame[2] if frame else None)),
            frame=(f"{frame[0]}:{frame[1]}" if frame else None),
            endpoint=endpoint,
            payload=dict(payload or {}),
            exc_obj=exc,
            exc_id=id(exc),
            after_response_start=after_response_start,
        )
        if ev.method:
            ev.method = ev.method[:255]
        # Chain: a wrapped exception keeps the original in payload.cause.
        cause = exc.__cause__ or exc.__context__
        if cause is not None and cause is not exc:
            ev.payload.setdefault("cause", f"{type(cause).__name__}: {truncate(mask_text(str(cause)), 300)}")
        return ev

    def event_external(
        self,
        *,
        provider: Optional[str],
        url: Optional[str],
        method_name: Optional[str] = None,
        status: Optional[int] = None,
        error_code: Optional[str] = None,
        response_text: Optional[str] = None,
        exc: Optional[BaseException] = None,
        model: Optional[str] = None,
        latency_ms: Optional[int] = None,
        category: Optional[str] = None,
        severity: Optional[str] = None,
        payload: Optional[Dict[str, Any]] = None,
        error_type: Optional[str] = None,
        message: Optional[str] = None,
    ) -> ErrorEvent:
        timeout = bool(exc and classify.is_timeout(exc)) or classify.is_timeout_code(status, error_code)
        cat = category or classify.category_for_provider(provider, timeout=timeout)
        sev = severity or classify.severity_for_external(provider, status, error_code)
        if exc is not None:
            ev = self.event_from_exception(exc, source=SOURCE_EXTERNAL, category=cat, severity=sev, payload=payload)
            if message:
                ev.error_message = truncate(mask_text(f"{message} | {ev.error_message}"), MAX_ERROR_MESSAGE) or ""
        else:
            frame = first_own_frame_of_stack(self.cfg.own_code_root, skip=2)
            msg = message or f"{provider or 'external'} call failed"
            if status is not None:
                msg = f"{msg} (HTTP {status})"
            if error_code:
                msg = f"{msg} [{error_code}]"
            ev = self._base(
                source=SOURCE_EXTERNAL,
                category=cat,
                severity=sev,
                error_type=(error_type or f"HttpStatus{status}" if status else (error_type or "ExternalError"))[:255],
                error_message=truncate(mask_text(msg), MAX_ERROR_MESSAGE) or "",
                method=(frame[2] if frame else None),
                frame=(f"{frame[0]}:{frame[1]}" if frame else None),
                payload=dict(payload or {}),
            )
        if error_type:
            ev.error_type = error_type[:255]
        ev.external_provider = (provider or None) and str(provider)[:50]
        ev.external_endpoint = (strip_query(url) or method_name or None)
        if ev.external_endpoint:
            ev.external_endpoint = ev.external_endpoint[:500]
        if method_name and url:
            ev.payload.setdefault("sdk_method", method_name)
        ev.external_model = (model or None) and str(model)[:100]
        ev.external_status_code = status
        ev.external_error_code = (error_code or None) and str(error_code)[:100]
        ev.external_response = truncate(mask_text(response_text), MAX_EXTERNAL_RESPONSE) if response_text else None
        ev.latency_ms = latency_ms
        return ev

    # ── recording ─────────────────────────────────────────────────────────────

    def record(self, event: ErrorEvent) -> Optional[ErrorEvent]:
        """Queue an event on the current request, or write it now when outside one."""
        if not self.cfg.enabled or is_internal():
            return None
        try:
            # One exception object is recorded once, however many hooks see it
            # (our handler, the server's "Exception in ASGI application" log,
            # a logger.exception in the route). A marker on the object itself
            # is used rather than id(): ids are reused once objects are freed.
            exc = event.exc_obj
            if exc is not None:
                if _is_seen(exc):
                    return None
                _mark_seen(exc)
            ctx = get_context()
            if ctx is not None:
                if not ctx.flushed:
                    ctx.pending.append(event)
                    return event
                # The request already flushed (e.g. uvicorn logging after the
                # response). Anything new still belongs to that request.
                self._apply_context(event, ctx)
                self._finalize_and_write([event])
                return event
            self._finalize_and_write([event])
            return event
        except Exception as exc:  # noqa: BLE001 - the logger never raises
            log.debug("errorlog: record failed: %s", exc)
            return None

    def record_exception(self, exc: BaseException, **kw: Any) -> Optional[ErrorEvent]:
        if isinstance(exc, _IGNORED_EXC) or _is_cancelled(exc):
            return None
        if not self.cfg.enabled or is_internal():
            return None
        try:
            return self.record(self.event_from_exception(exc, **kw))
        except Exception as inner:  # noqa: BLE001
            log.debug("errorlog: record_exception failed: %s", inner)
            return None

    def seen(self, exc: BaseException) -> bool:
        return _is_seen(exc)

    # ── flushing a request ────────────────────────────────────────────────────

    def _apply_context(self, ev: ErrorEvent, ctx: RequestContext) -> None:
        ev.request_id = ev.request_id or ctx.request_id
        ev.user_id = ev.user_id or ctx.user_id
        ev.user_email = ev.user_email or ctx.user_email
        ev.ip_address = ev.ip_address or ctx.ip_address
        ev.endpoint = ev.endpoint or ctx.endpoint
        ev.http_method = ev.http_method or ctx.http_method
        ev.status_code = ctx.status_code if ctx.status_code is not None else ev.status_code
        if ctx.user_message and ctx.status_code is not None and ctx.status_code >= 400:
            ev.user_message = ctx.user_message
        ev.action = ev.action or ctx.action
        ev.resource_type = ev.resource_type or ctx.resource_type
        ev.resource_id = ev.resource_id or ctx.resource_id
        had_method = bool(ev.method)
        if not ev.method:
            ev.method = ctx.method_override or ctx.extra.get("route_method")
        meta = auditmeta.enrich(
            http_method=ctx.http_method,
            endpoint=ctx.endpoint,
            route=ctx.route_template,
            resource_type=ev.resource_type,
            resource_id=ev.resource_id,
            action=ev.action,
            route_method=ev.method,
            service_name=self.cfg.service_name,
        )
        ev.action = meta["action"]
        ev.resource_type = meta["resource_type"]
        ev.resource_id = meta["resource_id"]
        if not had_method and meta["method"]:
            ev.method = meta["method"]
        if ctx.route_template:
            ev.payload.setdefault("route", ctx.route_template)
        if ctx.user_agent:
            ev.payload.setdefault("user_agent", truncate(ctx.user_agent, 300))
        if ctx.streaming:
            ev.payload.setdefault("streaming", True)
        if ev.after_response_start:
            ev.payload.setdefault("after_response_start", True)
        if ctx.extra:
            for k, v in ctx.extra.items():
                if k != "route_method":
                    ev.payload.setdefault(k, v)
        ev.payload.setdefault("duration_ms", int((time.perf_counter() - ctx.started_at) * 1000))

    def _synthetic_http_error(self, ctx: RequestContext) -> ErrorEvent:
        """A route caught its own error and answered 4xx/5xx: no exception reached us."""
        status = ctx.status_code or 500
        return self._base(
            source=SOURCE_HTTP,
            category=CAT_INTERNAL,
            severity=SEV_WARNING if status < 500 else "ERROR",
            error_type=f"HttpErrorResponse{status}",
            error_message=truncate(ctx.user_message or f"HTTP {status} returned by the route", MAX_ERROR_MESSAGE) or "",
            method=ctx.method_override or ctx.extra.get("route_method"),
        )

    def _stored_by_prefix(self, ctx: RequestContext, status: int) -> bool:
        """4xx on an endpoint under ERROR_LOG_STORE_4XX_PREFIXES (never 401/403/404)."""
        if status < 400 or status >= 500 or status in (401, 403, 404):
            return False
        endpoint = ctx.endpoint or ""
        return any(endpoint.startswith(p) for p in self.cfg.store_4xx_prefixes)

    def record_now(self, event: ErrorEvent) -> Optional[str]:
        """Write now, whatever the current request ends with. Returns the request id."""
        if not self.cfg.enabled:
            return None
        try:
            ctx = get_context()
            if ctx is not None:
                self._apply_context(event, ctx)
            before = len(ctx.written_ids) if ctx is not None else 0
            self._finalize_and_write([event])
            if ctx is not None:
                # The POST that carried a browser report did not fail itself.
                del ctx.written_ids[before:]
                del ctx.written_events[before:]
            # A client report is its own activity (client:chat …), not the POST that carried it.
            self._audit_from_error(event)
            return event.request_id
        except Exception as exc:  # noqa: BLE001
            log.debug("errorlog: record_now failed: %s", exc)
            return None

    def _audit_from_error(self, ev: ErrorEvent) -> None:
        """Audit row for an error with no request of its own (job, process, browser report)."""
        if not self.cfg.audit_enabled:
            return
        try:
            a = AuditEvent(
                service_name=self.cfg.service_name,
                environment=self.cfg.environment,
                request_id=ev.request_id,
                user_id=ev.user_id,
                user_email=ev.user_email,
                ip_address=ev.ip_address,
                http_method=ev.http_method,
                endpoint=(ev.endpoint or f"{ev.source.lower()}:{ev.method or 'unknown'}")[:500],
                status_code=ev.status_code,
                status=AUDIT_FAILED,
                error_log_id=ev.id,
                resource_type=ev.resource_type,
                resource_id=ev.resource_id,
                action=ev.action,
                method=(ev.method or "")[:255] or None,
                error_type=ev.error_type,
                error_message=truncate(ev.error_message, MAX_ERROR_MESSAGE),
                user_message=ev.user_message,
                stack_trace=ev.stack_trace,
                error_summary=ev.error_summary,
                error_code=ev.error_code,
                what_happened=ev.what_happened,
                suggested_fix=ev.suggested_fix,
                payload={"source": ev.source, "category": ev.category, "severity": ev.severity},
            )
            if ev.external_provider:
                a.payload["external_provider"] = ev.external_provider
            self.writer.enqueue(a)
        except Exception as exc:  # noqa: BLE001
            log.debug("errorlog: audit-from-error failed: %s", exc)

    def flush_context(self, ctx: RequestContext) -> int:
        if ctx.flushed:
            return 0
        ctx.flushed = True
        if not self.cfg.enabled:
            return 0
        try:
            return self._flush(ctx)
        except Exception as exc:  # noqa: BLE001
            log.debug("errorlog: flush failed: %s", exc)
            return 0

    # ── API audit log ─────────────────────────────────────────────────────────

    def should_audit(self, ctx: RequestContext) -> bool:
        if not self.cfg.enabled or not self.cfg.audit_enabled or ctx.suppress:
            return False
        if (ctx.http_method or "").upper() in ("OPTIONS", "HEAD"):
            return False
        endpoint = ctx.endpoint or ""
        if any(endpoint.startswith(p) for p in self.cfg.audit_skip_prefixes):
            return False
        if ctx.status_code is None and not ctx.written_ids:
            return False  # client left before any response and nothing went wrong
        return True

    def audit_request(self, ctx: RequestContext) -> Optional[AuditEvent]:
        """One api_audit_logs row for the request: who used which API, and how it went."""
        try:
            if not self.should_audit(ctx):
                return None
            status = ctx.status_code
            failed = ctx.escaped_exception or bool(ctx.written_ids) or (status is not None and status >= 400)
            route_method = ctx.method_override or ctx.extra.get("route_method")
            meta = auditmeta.enrich(
                http_method=ctx.http_method,
                endpoint=ctx.endpoint,
                route=ctx.route_template,
                resource_type=ctx.resource_type,
                resource_id=ctx.resource_id,
                action=ctx.action,
                route_method=route_method,
                service_name=self.cfg.service_name,
            )
            ev = AuditEvent(
                service_name=self.cfg.service_name,
                environment=self.cfg.environment,
                request_id=ctx.request_id,
                user_id=ctx.user_id,
                user_email=ctx.user_email,
                ip_address=ctx.ip_address,
                http_method=ctx.http_method,
                endpoint=(ctx.endpoint or "")[:500] or None,
                route=(ctx.route_template or "")[:500] or None,
                status_code=status,
                status=AUDIT_FAILED if failed else AUDIT_SUCCESS,
                duration_ms=int((time.perf_counter() - ctx.started_at) * 1000),
                error_log_id=(ctx.written_ids[0] if failed and ctx.written_ids else None),
                user_agent=truncate(ctx.user_agent, 300) if ctx.user_agent else None,
                resource_type=meta["resource_type"],
                resource_id=meta["resource_id"],
                action=meta["action"],
                method=meta["method"],
            )
            if failed:
                # The error travels with the audit row; empty on success.
                primary = ctx.written_events[0] if ctx.written_events else None
                if primary is not None:
                    ev.error_type = primary.error_type
                    ev.error_message = truncate(primary.error_message, MAX_ERROR_MESSAGE)
                    ev.user_message = primary.user_message or ctx.user_message
                    ev.stack_trace = primary.stack_trace
                    ev.error_summary = primary.error_summary
                    ev.error_code, ev.suggested_fix = primary.error_code, primary.suggested_fix
                    ev.what_happened = classify.explain(ev, frame=primary.frame)[1]
                else:
                    ev.error_type = f"HttpErrorResponse{status}" if status else None
                    ev.error_message = ctx.user_message
                    ev.user_message = ctx.user_message
                    ev.error_summary = classify.summarize(source="HTTP", category="INTERNAL", severity="WARNING", error_type=ev.error_type, error_message=ctx.user_message, status_code=status)[:500]
                    ev.error_code, ev.what_happened, ev.suggested_fix = classify.explain(ev)
            if ctx.streaming:
                ev.payload["streaming"] = True
            if meta["method"]:
                ev.payload["method"] = meta["method"]
            elif route_method:
                ev.payload["method"] = route_method
            if len(ctx.written_ids) > 1:
                ev.payload["error_log_ids"] = ctx.written_ids[:10]
            ev.payload = sanitize_payload(ev.payload) if ev.payload else {}
            self.writer.enqueue(ev)
            return ev
        except Exception as exc:  # noqa: BLE001
            log.debug("errorlog: audit failed: %s", exc)
            return None

    def _flush(self, ctx: RequestContext) -> int:
        status = ctx.status_code
        events: List[ErrorEvent] = list(ctx.pending)
        ctx.pending.clear()
        if ctx.suppress:
            return 0

        if self.cfg.capture_all:
            # Everything is kept. A request that still answered < 400 recovered
            # from its errors: they are stored as WARNING with payload.recovered.
            skipped = status is not None and status in self.cfg.skip_status
            if not events and status is not None and status >= 400 and not skipped:
                events.append(self._synthetic_http_error(ctx))
            if status is not None and status < 400:
                for e in events:
                    if not e.after_response_start:
                        e.payload["recovered"] = True
                        if e.severity != SEV_CRITICAL:
                            e.severity = SEV_WARNING
            if skipped:
                events = [e for e in events if e.after_response_start or e.source != SOURCE_HTTP or e.exc_obj is not None]
        else:
            if status is None:
                # No response at all: either nothing went wrong and the client left,
                # or we crashed before answering. Only exceptions are worth keeping.
                stored_status = any(e.source != SOURCE_EXTERNAL for e in events)
            else:
                stored_status = (
                    status >= 500
                    or (status >= 400 and status not in self.cfg.skip_status)
                    or self._stored_by_prefix(ctx, status)
                )

            # A route that answered 5xx (or a 4xx on a stored prefix) without any
            # exception reaching us still gets a row. Other 4xx only ride along
            # with the errors recorded during the request.
            if not events and status is not None and (status >= 500 or self._stored_by_prefix(ctx, status)):
                events.append(self._synthetic_http_error(ctx))

            if not stored_status:
                kept = [e for e in events if e.after_response_start]
                if self.cfg.store_recovered_external:
                    for e in events:
                        if e.source == SOURCE_EXTERNAL and e not in kept:
                            e.severity = SEV_WARNING
                            e.payload["recovered"] = True
                            kept.append(e)
                events = kept

        if not events:
            return 0

        for e in events:
            self._apply_context(e, ctx)

        # Same fingerprint repeated (retries) -> one row with payload.attempts.
        groups: Dict[str, List[ErrorEvent]] = {}
        order: List[str] = []
        for e in events:
            self._fingerprint(e)
            key = e.fingerprint or e.id
            if key not in groups:
                groups[key] = []
                order.append(key)
            groups[key].append(e)

        primaries: List[ErrorEvent] = []
        for key in order:
            grp = groups[key]
            head = grp[0]
            if len(grp) > 1:
                head.payload["attempts"] = len(grp)
                # keep the latest latency / status details from the last attempt
                last = grp[-1]
                head.latency_ms = last.latency_ms if last.latency_ms is not None else head.latency_ms
            primaries.append(head)

        externals = [e for e in primaries if e.source == SOURCE_EXTERNAL]
        if externals and status is not None and status >= 500:
            externals.sort(key=lambda e: (-SEVERITY_RANK.get(e.severity, 1), e.created_at))
            primary = externals[0]
            others = [e for e in primaries if e is not primary]
            if others:
                primary.payload["related"] = [
                    {
                        "error_type": o.error_type,
                        "category": o.category,
                        "method": o.method,
                        "message": truncate(o.error_message, 200),
                    }
                    for o in others[:10]
                ]
                # The internal exception behind the 500 travels with the row too.
                internal = next((o for o in others if o.source != SOURCE_EXTERNAL), None)
                if internal is not None and internal.stack_trace and not primary.payload.get("internal_stack"):
                    primary.payload["internal_error"] = f"{internal.error_type}: {truncate(internal.error_message, 500)}"
                    primary.payload["internal_stack"] = tail(internal.stack_trace, 3000)
            primary.status_code = status
            primary.user_message = ctx.user_message
            return self._finalize_and_write([primary])

        return self._finalize_and_write(primaries)

    # ── writing ───────────────────────────────────────────────────────────────

    def _fingerprint(self, ev: ErrorEvent) -> None:
        if not ev.fingerprint:
            ev.fingerprint = classify.fingerprint(
                self.cfg.service_name, ev.error_type, ev.method, ev.frame,
                ev.external_provider, ev.external_error_code,
            )

    def _finalize_and_write(self, events: List[ErrorEvent]) -> int:
        n = 0
        ctx = get_context()
        for ev in events:
            try:
                self._fingerprint(ev)
                if not ev.error_summary:
                    ev.error_summary = classify.summarize(
                        source=ev.source, category=ev.category, severity=ev.severity, error_type=ev.error_type,
                        error_message=ev.error_message, status_code=ev.status_code, external_provider=ev.external_provider,
                        external_status_code=ev.external_status_code, external_error_code=ev.external_error_code,
                    )[:500]
                if not ev.error_code:
                    ev.error_code, ev.what_happened, ev.suggested_fix = classify.explain(ev)
                ev.payload = sanitize_payload(ev.payload) if ev.payload else {}
                if ev.user_message:
                    ev.user_message = truncate(mask_text(ev.user_message), 1000)
                if self.writer.enqueue(ev):
                    n += 1
                    self.recorded_total += 1
                    if ctx is not None:
                        ctx.written_ids.append(ev.id)
                        ctx.written_events.append(ev)
                    else:
                        # Outside any request (job, thread, process): the error is the activity.
                        self._audit_from_error(ev)
            except Exception as exc:  # noqa: BLE001
                log.debug("errorlog: finalize failed: %s", exc)
        return n
