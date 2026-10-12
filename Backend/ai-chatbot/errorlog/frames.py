"""Find the first frame of *our own* code in a traceback or the current stack.

"Own code" means a file under the service root that is not inside a virtualenv,
site-packages, the standard library or this package.
"""
from __future__ import annotations

import os
import sys
import traceback
import types
from pathlib import Path
from typing import Iterable, Optional, Tuple

from .config import FOREIGN_PATH_MARKERS, STDLIB_PREFIXES

FrameInfo = Tuple[str, int, str]  # (relative file path, line, "module.function")


def _is_foreign(filename: str) -> bool:
    if not filename:
        return True
    norm = filename.replace("/", os.sep)
    for marker in FOREIGN_PATH_MARKERS:
        if marker in norm:
            return True
    for prefix in STDLIB_PREFIXES:
        if prefix and norm.startswith(prefix) and ("site-packages" in norm or os.sep + "lib" + os.sep in norm.lower()):
            return True
    return False


def _is_own(filename: str, root: Path) -> bool:
    if _is_foreign(filename):
        return False
    try:
        Path(filename).resolve().relative_to(root)
        return True
    except (ValueError, OSError):
        return False


def _module_name(filename: str, root: Path) -> str:
    try:
        rel = Path(filename).resolve().relative_to(root)
    except (ValueError, OSError):
        rel = Path(filename)
    parts = list(rel.with_suffix("").parts)
    if parts and parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(parts) or Path(filename).stem


def _qualname(frame: types.FrameType) -> str:
    code = frame.f_code
    qual = getattr(code, "co_qualname", None)  # Python 3.11+
    if qual:
        return qual.replace("<locals>.", "")
    # Older interpreters: derive Class.method from ``self``/``cls`` when present.
    fn = code.co_name
    loc = frame.f_locals
    owner = loc.get("self", None)
    if owner is not None and fn != "<module>":
        return f"{type(owner).__name__}.{fn}"
    owner = loc.get("cls", None)
    if isinstance(owner, type):
        return f"{owner.__name__}.{fn}"
    return fn


def _describe(frame: types.FrameType, lineno: int, root: Path) -> FrameInfo:
    filename = frame.f_code.co_filename
    try:
        rel = str(Path(filename).resolve().relative_to(root)).replace(os.sep, "/")
    except (ValueError, OSError):
        rel = filename.replace(os.sep, "/")
    method = f"{_module_name(filename, root)}.{_qualname(frame)}"
    return rel, lineno, method


def _walk_tb(tb: Optional[types.TracebackType]) -> Iterable[Tuple[types.FrameType, int]]:
    frames = []
    while tb is not None:
        frames.append((tb.tb_frame, tb.tb_lineno))
        tb = tb.tb_next
    # innermost (closest to the raise) first
    return reversed(frames)


def first_own_frame_of_exception(exc: BaseException, root: Path) -> Optional[FrameInfo]:
    """Innermost own-code frame of ``exc``'s traceback, following __cause__/__context__."""
    seen = set()
    current: Optional[BaseException] = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        for frame, lineno in _walk_tb(current.__traceback__):
            if _is_own(frame.f_code.co_filename, root):
                return _describe(frame, lineno, root)
        current = current.__cause__ or current.__context__
    return None


def outermost_frame_of_exception(exc: BaseException, root: Path) -> Optional[FrameInfo]:
    """Fallback when nothing in the traceback is our code: the innermost frame of any kind."""
    tb = exc.__traceback__
    last = None
    while tb is not None:
        last = (tb.tb_frame, tb.tb_lineno)
        tb = tb.tb_next
    if last is None:
        return None
    return _describe(last[0], last[1], root)


def first_own_frame_of_stack(root: Path, skip: int = 1) -> Optional[FrameInfo]:
    """Innermost own-code frame of the *current* call stack (for non-exception records)."""
    frame = sys._getframe(skip)  # noqa: SLF001
    depth = 0
    while frame is not None and depth < 80:
        if _is_own(frame.f_code.co_filename, root):
            return _describe(frame, frame.f_lineno, root)
        frame = frame.f_back
        depth += 1
    return None


def format_stack_trace(exc: BaseException) -> str:
    try:
        return "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    except Exception:  # noqa: BLE001
        return f"{type(exc).__name__}: {exc}"


def endpoint_method_name(endpoint: object, root: Path) -> Optional[str]:
    """``module.function`` for a route handler object (Starlette ``scope['endpoint']``)."""
    if endpoint is None:
        return None
    fn = getattr(endpoint, "__func__", endpoint)
    code = getattr(fn, "__code__", None)
    qual = getattr(fn, "__qualname__", None) or getattr(fn, "__name__", None)
    if code is not None:
        mod = _module_name(code.co_filename, root)
    else:
        mod = getattr(fn, "__module__", None) or type(endpoint).__module__
    if not qual:
        qual = type(endpoint).__name__
    return f"{mod}.{qual}".replace("<locals>.", "")
