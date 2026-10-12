"""Hook shared model-output parsers so a parse failure is recorded as
AI_INVALID_OUTPUT. Specs are ``"package.module:function"`` or
``"package.module:Class.method"``. Missing modules are skipped quietly."""
from __future__ import annotations

import functools
import importlib
import inspect
import logging
from typing import Any, Iterable, List

from .config import Config
from .model import CAT_AI_INVALID, SEV_WARNING, SOURCE_HTTP
from .recorder import Recorder
from .sanitize import truncate

log = logging.getLogger("errorlog")


def _input_size(args: tuple, kwargs: dict) -> int:
    for val in list(args) + list(kwargs.values()):
        if isinstance(val, (str, bytes)):
            return len(val)
    return 0


def _wrap(fn, spec: str, recorder: Recorder, cfg: Config):
    is_async = inspect.iscoroutinefunction(fn)

    def _record_none(args, kwargs):
        size = _input_size(args, kwargs)
        if size == 0:
            return
        ev = recorder.event_from_exception(
            ValueError(f"parser returned nothing for {size} chars of model output"),
            source=SOURCE_HTTP,
            category=CAT_AI_INVALID,
            severity=SEV_WARNING,
            payload={"parser": spec, "input_chars": size},
        )
        ev.error_type = "ModelOutputUnparsable"
        ev.external_provider = "GEMINI"
        recorder.record(ev)

    def _record_exc(exc, args, kwargs):
        size = _input_size(args, kwargs)
        payload = {"parser": spec, "input_chars": size}
        if cfg.store_ai_content:
            for val in list(args) + list(kwargs.values()):
                if isinstance(val, str):
                    payload["input_preview"] = truncate(val, 500)
                    break
        ev = recorder.event_from_exception(exc, source=SOURCE_HTTP, category=CAT_AI_INVALID, severity=SEV_WARNING, payload=payload)
        ev.external_provider = "GEMINI"
        recorder.record(ev)

    if is_async:

        @functools.wraps(fn)
        async def awrapper(*args, **kwargs):
            try:
                result = await fn(*args, **kwargs)
            except Exception as exc:
                _record_exc(exc, args, kwargs)
                raise
            if result is None:
                _record_none(args, kwargs)
            return result

        awrapper.__errorlog_wrapped__ = True  # type: ignore[attr-defined]
        return awrapper

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            result = fn(*args, **kwargs)
        except Exception as exc:
            _record_exc(exc, args, kwargs)
            raise
        if result is None:
            _record_none(args, kwargs)
        return result

    wrapper.__errorlog_wrapped__ = True  # type: ignore[attr-defined]
    return wrapper


def install_parse_hooks(recorder: Recorder, cfg: Config, specs: Iterable[str]) -> List[str]:
    patched: List[str] = []
    for spec in specs or ():
        try:
            mod_name, _, attr_path = spec.partition(":")
            if not mod_name or not attr_path:
                continue
            module = importlib.import_module(mod_name)
            parts = attr_path.split(".")
            owner: Any = module
            for part in parts[:-1]:
                owner = getattr(owner, part)
            name = parts[-1]
            fn = getattr(owner, name, None)
            if fn is None or getattr(fn, "__errorlog_wrapped__", False):
                continue
            if isinstance(inspect.getattr_static(owner, name), staticmethod):
                setattr(owner, name, staticmethod(_wrap(fn, spec, recorder, cfg)))
            else:
                setattr(owner, name, _wrap(fn, spec, recorder, cfg))
            patched.append(spec)
        except ImportError:
            continue
        except Exception as exc:  # noqa: BLE001
            log.debug("errorlog: parse hook %s failed: %s", spec, exc)
    return patched
