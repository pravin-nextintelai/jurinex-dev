"""logging.Handler that records ERROR+ log lines carrying an exception."""
from __future__ import annotations

import collections
import logging
from typing import Deque, List

from .config import Config
from .context import is_internal
from .model import SOURCE_LOGGER
from .recorder import Recorder
from .sanitize import truncate

_OWN_PREFIXES = ("errorlog",)
_LOGGERS = ("", "uvicorn", "uvicorn.error", "gunicorn.error", "fastapi", "starlette", "asyncio")


class ErrorLogHandler(logging.Handler):
    def __init__(self, recorder: Recorder, cfg: Config) -> None:
        super().__init__(level=logging.ERROR)
        self.recorder = recorder
        self.cfg = cfg
        self._recent: Deque[int] = collections.deque(maxlen=256)

    def emit(self, record: logging.LogRecord) -> None:  # noqa: D401
        try:
            if is_internal() or record.name.startswith(_OWN_PREFIXES):
                return
            if record.levelno < logging.ERROR:
                return
            info = record.exc_info
            exc = info[1] if isinstance(info, tuple) and len(info) == 3 else None
            if exc is None or not isinstance(exc, BaseException):
                return
            if self.recorder.seen(exc):
                return
            try:
                message = record.getMessage()
            except Exception:  # noqa: BLE001
                message = str(record.msg)
            ev = self.recorder.event_from_exception(
                exc,
                source=SOURCE_LOGGER,
                message=truncate(message, 500),
                payload={"logger": record.name, "level": record.levelname},
            )
            if not ev.method and record.funcName:
                ev.method = f"{record.module}.{record.funcName}"[:255]
            self.recorder.record(ev)
        except Exception:  # noqa: BLE001 - a logging handler must never raise
            return


def install_logging_hook(recorder: Recorder, cfg: Config, extra_loggers=()) -> List[str]:
    handler = ErrorLogHandler(recorder, cfg)
    attached: List[str] = []
    for name in tuple(_LOGGERS) + tuple(extra_loggers or ()):
        logger = logging.getLogger(name) if name else logging.getLogger()
        if any(isinstance(h, ErrorLogHandler) for h in logger.handlers):
            continue
        logger.addHandler(handler)
        attached.append(name or "root")
    # A root level above ERROR would otherwise filter us out before emit().
    root = logging.getLogger()
    if root.level > logging.ERROR:
        root.setLevel(logging.ERROR)
    return attached
