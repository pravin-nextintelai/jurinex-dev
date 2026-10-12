"""Gemini SDK hook: patch google-genai (and the legacy google-generativeai) once.

Call sites are untouched. Every ``client.models.<method>`` and
``client.aio.models.<method>`` call, including the ones Google ADK makes, is
timed and inspected:

* SDK / API exceptions      -> AI_PROVIDER (TIMEOUT for deadlines)
* prompt block / finish_reason SAFETY, RECITATION, ... -> AI_SAFETY_BLOCK (WARNING)
* no candidates / no text   -> AI_EMPTY_RESPONSE
* finish_reason MAX_TOKENS  -> AI_EMPTY_RESPONSE (WARNING)
* MALFORMED_FUNCTION_CALL   -> AI_INVALID_OUTPUT (WARNING)
"""
from __future__ import annotations

import functools
import inspect
import logging
import re
import sys
import time
from typing import Any, Dict, List, Optional

from .config import Config
from .context import _in_sdk
from .model import CAT_AI_EMPTY, CAT_AI_INVALID, CAT_AI_SAFETY, SEV_ERROR, SEV_WARNING
from .recorder import Recorder
from .sanitize import truncate

log = logging.getLogger("errorlog")

PROVIDER = "GEMINI"

_BLOCK_FINISH = {
    "SAFETY", "RECITATION", "PROHIBITED_CONTENT", "BLOCKLIST", "OTHER", "SPII", "LANGUAGE",
    "IMAGE_SAFETY", "IMAGE_PROHIBITED_CONTENT", "IMAGE_RECITATION", "IMAGE_OTHER", "MODEL_ARMOR", "JAILBREAK",
}
_INVALID_FINISH = {"MALFORMED_FUNCTION_CALL", "UNEXPECTED_TOOL_CALL"}
_UNSPECIFIED = {None, "", "FINISH_REASON_UNSPECIFIED", "BLOCKED_REASON_UNSPECIFIED", "0", "STOP"}

_CAMEL_RE = re.compile(r"(?<!^)(?=[A-Z])")


def _enum_name(value: Any) -> Optional[str]:
    if value is None:
        return None
    name = getattr(value, "name", None)
    if isinstance(name, str) and name:
        return name.upper()
    text = str(value)
    if "." in text:
        text = text.rsplit(".", 1)[-1]
    return text.upper() or None


def _model_from_call(self_obj: Any, args: tuple, kwargs: dict) -> Optional[str]:
    model = kwargs.get("model")
    if model is None and args and isinstance(args[0], str):
        model = args[0]
    if model is None:
        for attr in ("model_name", "_model_name", "model"):
            val = getattr(self_obj, attr, None)
            if isinstance(val, str):
                model = val
                break
    if isinstance(model, str):
        return model.replace("models/", "")[:100]
    return None


def _usage(resp: Any) -> Dict[str, Any]:
    um = getattr(resp, "usage_metadata", None)
    if um is None:
        return {}
    out: Dict[str, Any] = {}
    for key in ("prompt_token_count", "candidates_token_count", "total_token_count", "cached_content_token_count", "thoughts_token_count", "tool_use_prompt_token_count"):
        val = getattr(um, key, None)
        if isinstance(val, int):
            out[key] = val
    return out


def _parts_of(candidate: Any) -> List[Any]:
    content = getattr(candidate, "content", None)
    parts = getattr(content, "parts", None) if content is not None else None
    return list(parts) if parts else []


def _text_chars(resp: Any) -> int:
    total = 0
    for cand in (getattr(resp, "candidates", None) or []):
        for part in _parts_of(cand):
            text = getattr(part, "text", None)
            if isinstance(text, str):
                total += len(text)
    return total


def _has_content(resp: Any) -> bool:
    for cand in (getattr(resp, "candidates", None) or []):
        for part in _parts_of(cand):
            text = getattr(part, "text", None)
            if isinstance(text, str) and text.strip():
                return True
            for attr in ("function_call", "inline_data", "executable_code", "code_execution_result", "file_data"):
                if getattr(part, attr, None) is not None:
                    return True
    # Legacy SDK responses expose parts through .parts
    parts = getattr(resp, "parts", None)
    if parts:
        for part in parts:
            text = getattr(part, "text", None)
            if isinstance(text, str) and text.strip():
                return True
            if getattr(part, "function_call", None) is not None:
                return True
    return False


class GeminiHook:
    def __init__(self, recorder: Recorder, cfg: Config) -> None:
        self.recorder = recorder
        self.cfg = cfg

    # ── recording ─────────────────────────────────────────────────────────

    def record_exception(self, exc: BaseException, *, model: Optional[str], sdk_method: str, started: float) -> None:
        try:
            latency = int((time.perf_counter() - started) * 1000)
            status = getattr(exc, "code", None)
            if not isinstance(status, int):
                status = getattr(exc, "status_code", None)
                if not isinstance(status, int):
                    status = None
            code = getattr(exc, "status", None)
            if not isinstance(code, str):
                grpc = getattr(exc, "grpc_status_code", None)
                code = _enum_name(grpc) if grpc is not None else None
            if not code:
                # google.api_core style class names: ResourceExhausted -> RESOURCE_EXHAUSTED
                name = type(exc).__name__
                if name not in ("APIError", "ClientError", "ServerError", "Exception", "HTTPError"):
                    code = _CAMEL_RE.sub("_", name).upper()
            message = getattr(exc, "message", None)
            if not isinstance(message, str) or not message:
                message = str(exc)
            ev = self.recorder.event_external(
                provider=PROVIDER,
                url=None,
                method_name=f"genai.{sdk_method}",
                status=status,
                error_code=code,
                response_text=truncate(message, 2000),
                exc=exc,
                model=model,
                latency_ms=latency,
            )
            self.recorder.record(ev)
        except Exception as inner:  # noqa: BLE001
            log.debug("errorlog: gemini exception record failed: %s", inner)

    def inspect_response(
        self,
        resp: Any,
        *,
        model: Optional[str],
        sdk_method: str,
        started: float,
        streamed: bool = False,
        saw_content: Optional[bool] = None,
    ) -> None:
        try:
            if resp is None and not streamed:
                return
            latency = int((time.perf_counter() - started) * 1000)
            usage = _usage(resp) if resp is not None else {}
            candidates = list(getattr(resp, "candidates", None) or []) if resp is not None else []
            finish = [_enum_name(getattr(c, "finish_reason", None)) for c in candidates]
            finish_set = {f for f in finish if f}
            pf = getattr(resp, "prompt_feedback", None) if resp is not None else None
            block = _enum_name(getattr(pf, "block_reason", None)) if pf is not None else None
            if block in _UNSPECIFIED:
                block = None
            has_content = bool(saw_content) if streamed else _has_content(resp)
            payload: Dict[str, Any] = {"finish_reasons": sorted(finish_set), "candidates": len(candidates), "streamed": streamed}
            if usage:
                payload["tokens"] = usage
            if self.cfg.store_ai_content and resp is not None:
                try:
                    payload["output_preview"] = truncate(getattr(resp, "text", None) or "", 500)
                except Exception:  # noqa: BLE001
                    pass
            else:
                payload["output_chars"] = _text_chars(resp) if resp is not None else 0

            category = severity = code = error_type = message = None
            if block:
                category, severity, code = CAT_AI_SAFETY, SEV_WARNING, block
                error_type, message = "GeminiPromptBlocked", f"prompt blocked: {block}"
                pf_msg = getattr(pf, "block_reason_message", None)
                if isinstance(pf_msg, str) and pf_msg:
                    payload["block_reason_message"] = truncate(pf_msg, 300)
            elif finish_set & _BLOCK_FINISH:
                code = sorted(finish_set & _BLOCK_FINISH)[0]
                category, severity = CAT_AI_SAFETY, SEV_WARNING
                error_type, message = "GeminiSafetyBlock", f"response stopped: finish_reason={code}"
            elif finish_set & _INVALID_FINISH:
                code = sorted(finish_set & _INVALID_FINISH)[0]
                category, severity = CAT_AI_INVALID, SEV_WARNING
                error_type, message = "GeminiInvalidOutput", f"finish_reason={code}"
            elif "MAX_TOKENS" in finish_set:
                code = "MAX_TOKENS"
                category, severity = CAT_AI_EMPTY, SEV_WARNING
                error_type, message = "GeminiMaxTokens", "response truncated: finish_reason=MAX_TOKENS"
                payload["partial"] = has_content
            elif not candidates or not has_content:
                code = "EMPTY_RESPONSE" if candidates else "NO_CANDIDATES"
                category, severity = CAT_AI_EMPTY, SEV_ERROR
                error_type, message = "GeminiEmptyResponse", "no text or function call in a successful response"
            if category is None:
                return
            ev = self.recorder.event_external(
                provider=PROVIDER,
                url=None,
                method_name=f"genai.{sdk_method}",
                error_code=code,
                model=model,
                latency_ms=latency,
                category=category,
                severity=severity,
                payload=payload,
                error_type=error_type,
                message=message,
            )
            self.recorder.record(ev)
        except Exception as inner:  # noqa: BLE001
            log.debug("errorlog: gemini response inspect failed: %s", inner)

    # ── wrappers ───────────────────────────────────────────────────────────

    def wrap_sync(self, orig, sdk_method: str, kind: str):
        hook = self

        @functools.wraps(orig)
        def wrapper(self_obj, *args, **kwargs):
            model = _model_from_call(self_obj, args, kwargs)
            started = time.perf_counter()
            token = _in_sdk.set(True)
            try:
                result = orig(self_obj, *args, **kwargs)
            except BaseException as exc:
                hook.record_exception(exc, model=model, sdk_method=sdk_method, started=started)
                raise
            finally:
                _in_sdk.reset(token)
            if kind == "stream" or (kind == "generate" and kwargs.get("stream") is True and inspect.isgenerator(result)):
                return _SyncStream(result, hook, model, sdk_method, started)
            if kind == "generate" and kwargs.get("stream") is True:
                return result  # legacy SDK streaming object: left alone
            if kind == "generate":
                hook.inspect_response(result, model=model, sdk_method=sdk_method, started=started)
            return result

        wrapper.__errorlog_wrapped__ = True  # type: ignore[attr-defined]
        return wrapper

    def wrap_async(self, orig, sdk_method: str, kind: str):
        hook = self

        @functools.wraps(orig)
        async def wrapper(self_obj, *args, **kwargs):
            model = _model_from_call(self_obj, args, kwargs)
            started = time.perf_counter()
            token = _in_sdk.set(True)
            try:
                result = await orig(self_obj, *args, **kwargs)
            except BaseException as exc:
                hook.record_exception(exc, model=model, sdk_method=sdk_method, started=started)
                raise
            finally:
                _in_sdk.reset(token)
            if kind == "stream":
                return _AsyncStream(result, hook, model, sdk_method, started)
            if kind == "generate":
                hook.inspect_response(result, model=model, sdk_method=sdk_method, started=started)
            return result

        wrapper.__errorlog_wrapped__ = True  # type: ignore[attr-defined]
        return wrapper


class _SyncStream:
    """Iterator proxy for ``generate_content_stream`` results."""

    def __init__(self, it, hook: GeminiHook, model: Optional[str], sdk_method: str, started: float) -> None:
        self._it = iter(it)
        self._hook = hook
        self._model = model
        self._method = sdk_method
        self._started = started
        self._last = None
        self._saw = False
        self._done = False

    def __iter__(self):
        return self

    def __next__(self):
        token = _in_sdk.set(True)
        try:
            chunk = next(self._it)
        except StopIteration:
            self._finish()
            raise
        except BaseException as exc:
            if not self._done:
                self._done = True
                self._hook.record_exception(exc, model=self._model, sdk_method=self._method + "[stream]", started=self._started)
            raise
        finally:
            _in_sdk.reset(token)
        self._last = chunk
        if not self._saw and _has_content(chunk):
            self._saw = True
        return chunk

    def _finish(self) -> None:
        if self._done:
            return
        self._done = True
        self._hook.inspect_response(self._last, model=self._model, sdk_method=self._method + "[stream]", started=self._started, streamed=True, saw_content=self._saw)

    def __getattr__(self, name):
        return getattr(self._it, name)


class _AsyncStream:
    def __init__(self, it, hook: GeminiHook, model: Optional[str], sdk_method: str, started: float) -> None:
        self._it = it.__aiter__() if hasattr(it, "__aiter__") else it
        self._hook = hook
        self._model = model
        self._method = sdk_method
        self._started = started
        self._last = None
        self._saw = False
        self._done = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        token = _in_sdk.set(True)
        try:
            chunk = await self._it.__anext__()
        except StopAsyncIteration:
            self._finish()
            raise
        except BaseException as exc:
            if not self._done:
                self._done = True
                self._hook.record_exception(exc, model=self._model, sdk_method=self._method + "[stream]", started=self._started)
            raise
        finally:
            _in_sdk.reset(token)
        self._last = chunk
        if not self._saw and _has_content(chunk):
            self._saw = True
        return chunk

    def _finish(self) -> None:
        if self._done:
            return
        self._done = True
        self._hook.inspect_response(self._last, model=self._model, sdk_method=self._method + "[stream]", started=self._started, streamed=True, saw_content=self._saw)

    def __getattr__(self, name):
        return getattr(self._it, name)


_SYNC_METHODS = (("generate_content", "generate"), ("generate_content_stream", "stream"), ("embed_content", "other"), ("count_tokens", "other"), ("compute_tokens", "other"))


def _patch_class(cls: Any, hook: GeminiHook, methods, *, is_async: bool, prefix: str, patched: List[str]) -> None:
    for name, kind in methods:
        orig = getattr(cls, name, None)
        if orig is None or getattr(orig, "__errorlog_wrapped__", False):
            continue
        if is_async:
            wrapped = hook.wrap_async(orig, f"{prefix}{name}", kind)
        else:
            wrapped = hook.wrap_sync(orig, f"{prefix}{name}", kind)
        setattr(cls, name, wrapped)
        patched.append(f"{cls.__module__}.{cls.__name__}.{name}")


def install_gemini_hooks(recorder: Recorder, cfg: Config) -> List[str]:
    hook = GeminiHook(recorder, cfg)
    patched: List[str] = []
    try:
        import google.genai.models as gm  # type: ignore

        _patch_class(gm.Models, hook, _SYNC_METHODS, is_async=False, prefix="models.", patched=patched)
        _patch_class(gm.AsyncModels, hook, _SYNC_METHODS, is_async=True, prefix="aio.models.", patched=patched)
    except ImportError:
        pass
    except Exception as exc:  # noqa: BLE001
        log.debug("errorlog: google-genai patch failed: %s", exc)
    # The legacy SDK is deprecated and prints a banner on import: only patch it
    # when the service itself already imported it (Visual-Service does).
    if "google.generativeai" not in sys.modules:
        return patched
    try:
        import google.generativeai.generative_models as ogm  # type: ignore

        _patch_class(
            ogm.GenerativeModel, hook,
            (("generate_content", "generate"), ("count_tokens", "other")),
            is_async=False, prefix="legacy.", patched=patched,
        )
        if hasattr(ogm.GenerativeModel, "generate_content_async"):
            _patch_class(ogm.GenerativeModel, hook, (("generate_content_async", "generate"),), is_async=True, prefix="legacy.", patched=patched)
        chat_cls = getattr(ogm, "ChatSession", None)
        if chat_cls is not None:
            _patch_class(chat_cls, hook, (("send_message", "generate"),), is_async=False, prefix="legacy.chat.", patched=patched)
            if hasattr(chat_cls, "send_message_async"):
                _patch_class(chat_cls, hook, (("send_message_async", "generate"),), is_async=True, prefix="legacy.chat.", patched=patched)
    except ImportError:
        pass
    except Exception as exc:  # noqa: BLE001
        log.debug("errorlog: google-generativeai patch failed: %s", exc)
    return patched
