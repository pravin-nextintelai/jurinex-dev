"""Process- and job-level hooks: sys.excepthook, threading.excepthook, the
asyncio loop exception handler, context propagation into thread pools."""
from __future__ import annotations

import asyncio
import contextvars
import functools
import logging
import sys
import threading
import weakref
from typing import Callable, List

from .config import Config
from .model import SOURCE_JOB, SOURCE_PROCESS
from .recorder import Recorder

log = logging.getLogger("errorlog")


def install_process_hooks(recorder: Recorder, cfg: Config, writer) -> List[str]:
    installed: List[str] = []

    prev_sys = sys.excepthook

    def excepthook(exc_type, exc, tb):
        try:
            if exc is not None and not isinstance(exc, (KeyboardInterrupt, SystemExit)):
                recorder.record_exception(exc, source=SOURCE_PROCESS, endpoint="sys.excepthook")
                writer.flush(timeout=3.0)
        except Exception:  # noqa: BLE001
            pass
        prev_sys(exc_type, exc, tb)

    if not getattr(prev_sys, "__errorlog_wrapped__", False):
        excepthook.__errorlog_wrapped__ = True  # type: ignore[attr-defined]
        sys.excepthook = excepthook
        installed.append("sys.excepthook")

    prev_thread = getattr(threading, "excepthook", None)
    if prev_thread is not None and not getattr(prev_thread, "__errorlog_wrapped__", False):

        def thread_hook(args):
            try:
                exc = args.exc_value
                if exc is not None and not isinstance(exc, SystemExit):
                    name = getattr(args.thread, "name", None) or "thread"
                    recorder.record_exception(exc, source=SOURCE_JOB, endpoint=f"thread:{name}")
            except Exception:  # noqa: BLE001
                pass
            prev_thread(args)

        thread_hook.__errorlog_wrapped__ = True  # type: ignore[attr-defined]
        threading.excepthook = thread_hook
        installed.append("threading.excepthook")

    return installed


def make_loop_hook(recorder: Recorder) -> Callable[[], None]:
    """Return a function that installs the asyncio exception handler on the
    running loop the first time it is called from inside that loop."""
    hooked: "weakref.WeakSet" = weakref.WeakSet()

    def ensure() -> None:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        if loop in hooked:
            return
        hooked.add(loop)
        prev = loop.get_exception_handler()

        def handler(loop_, context):
            try:
                exc = context.get("exception")
                if exc is not None and isinstance(exc, Exception):
                    fut = context.get("future") or context.get("task") or context.get("handle")
                    name = None
                    get_name = getattr(fut, "get_name", None)
                    if callable(get_name):
                        try:
                            name = get_name()
                        except Exception:  # noqa: BLE001
                            name = None
                    recorder.record_exception(
                        exc,
                        source=SOURCE_JOB,
                        endpoint=f"task:{name or 'unknown'}",
                        message=str(context.get("message") or "")[:300] or None,
                    )
            except Exception:  # noqa: BLE001
                pass
            if prev is not None:
                prev(loop_, context)
            else:
                loop_.default_exception_handler(context)

        loop.set_exception_handler(handler)

    return ensure


def install_executor_context_propagation() -> bool:
    """Copy contextvars into ThreadPoolExecutor jobs.

    ``loop.run_in_executor`` does not propagate context, so a Gemini call made
    through an executor (the pattern these services use) would lose the request
    it belongs to. ``asyncio.to_thread`` already does this; we extend it to
    every executor submission.
    """
    try:
        from concurrent.futures import ThreadPoolExecutor
    except ImportError:  # pragma: no cover
        return False
    if getattr(ThreadPoolExecutor.submit, "__errorlog_wrapped__", False):
        return True
    orig_submit = ThreadPoolExecutor.submit

    @functools.wraps(orig_submit)
    def submit(self, fn, /, *args, **kwargs):
        ctx = contextvars.copy_context()
        return orig_submit(self, ctx.run, fn, *args, **kwargs)

    submit.__errorlog_wrapped__ = True  # type: ignore[attr-defined]
    ThreadPoolExecutor.submit = submit  # type: ignore[assignment]
    return True
