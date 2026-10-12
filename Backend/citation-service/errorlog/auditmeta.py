"""Fill audit log ACTION / RESOURCE TYPE / METHOD the way the admin table shows them.

  ACTION         VIEW | CREATE | UPDATE | DELETE
  RESOURCE TYPE  STORAGE FOLDER | CASE | FILE | USER | …
  METHOD         FolderService.list_folders  (real handler, not GET/POST)
  resource_id    only when the URL names one; blank on list endpoints
"""
from __future__ import annotations

import re
from typing import Optional, Tuple

_HTTP_ACTION = {
    "GET": "VIEW",
    "HEAD": "VIEW",
    "POST": "CREATE",
    "PUT": "UPDATE",
    "PATCH": "UPDATE",
    "DELETE": "DELETE",
}

_TYPE_ALIAS = {
    "FOLDER": "STORAGE FOLDER",
    "FOLDER_NAME": "STORAGE FOLDER",
    "STORAGE": "STORAGE FOLDER",
    "STORAGE_FOLDER": "STORAGE FOLDER",
    "CASE": "CASE",
    "CASES": "CASE",
    "CASE_ID": "CASE",
    "FILE": "FILE",
    "FILE_ID": "FILE",
    "DOCUMENT": "FILE",
    "DOC": "FILE",
    "USER": "USER",
    "USERS": "USER",
    "SESSION": "CHAT",
    "CHAT": "CHAT",
    "PROMPT": "PROMPT",
    "PLAN": "PLAN",
    "PAYMENT": "PAYMENT",
    "TICKET": "SUPPORT TICKET",
    "SUPPORT": "SUPPORT TICKET",
}

# Most-specific path wins. `/api/files/cases` must be CASE, not STORAGE FOLDER.
_PATH_RESOURCES: Tuple[Tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"/files/cases(?:/|$)|/cases(?:/|$)", re.I), "CASE"),
    (re.compile(r"/files/folders(?:/|$)|/storage[-_]?folders?(?:/|$)|/folders(?:/|$)", re.I), "STORAGE FOLDER"),
    (re.compile(r"/files/file(?:/|$)|/documents?(?:/|$)|/docs(?:/|$)", re.I), "FILE"),
    (re.compile(r"/files(?:/|$)", re.I), "STORAGE FOLDER"),
    (re.compile(r"/users?(?:/|$)", re.I), "USER"),
    (re.compile(r"/sessions?(?:/|$)|/chats?(?:/|$)", re.I), "CHAT"),
    (re.compile(r"/prompts?(?:/|$)", re.I), "PROMPT"),
    (re.compile(r"/plans?(?:/|$)|/billing(?:/|$)|/subscriptions?(?:/|$)", re.I), "PLAN"),
    (re.compile(r"/payments?(?:/|$)", re.I), "PAYMENT"),
    (re.compile(r"/tickets?(?:/|$)|/support(?:/|$)", re.I), "SUPPORT TICKET"),
    (re.compile(r"/templates?(?:/|$)", re.I), "TEMPLATE"),
    (re.compile(r"/drafts?(?:/|$)", re.I), "DRAFT"),
)

_RESOURCE_SERVICE = {
    "STORAGE FOLDER": "FolderService",
    "CASE": "CaseService",
    "FILE": "FolderService",
    "USER": "UserService",
    "CHAT": "ChatService",
    "PROMPT": "PromptService",
    "PLAN": "PlanService",
    "PAYMENT": "PaymentService",
    "SUPPORT TICKET": "SupportService",
    "TEMPLATE": "TemplateService",
    "DRAFT": "DraftService",
}

_SKIP_OWNERS = frozenset(
    {"app", "api", "src", "routes", "controllers", "hooks", "v1", "main", "server", "index"}
)
_PARAM_RE = re.compile(r"^\{.+\}$")
_UUIDISH_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{4,}$", re.I)


def action_from_http(http_method: Optional[str]) -> Optional[str]:
    if not http_method:
        return None
    return _HTTP_ACTION.get(str(http_method).upper(), str(http_method).upper()[:30])


def _title_service(name: str) -> str:
    parts = re.split(r"[-_]+", (name or "").strip())
    parts = [p for p in parts if p]
    if not parts:
        return "Service"
    return "".join(p[:1].upper() + p[1:] for p in parts)


def _singular(word: str) -> str:
    w = (word or "").replace("-", "_")
    if w.endswith("ies") and len(w) > 3:
        return w[:-3] + "y"
    if w.endswith("sses"):
        return w[:-2]
    if w.endswith("s") and not w.endswith("ss") and len(w) > 1:
        return w[:-1]
    return w


def _path_segments(endpoint: Optional[str], route: Optional[str]) -> list:
    raw = (route or endpoint or "").split("?")[0]
    return [s for s in raw.strip("/").split("/") if s]


def _function_from_handler(route_method: Optional[str]) -> Optional[str]:
    raw = (route_method or "").strip()
    if not raw:
        return None
    if " " in raw and "<locals>" not in raw:
        return raw.split()[-1]
    cleaned = raw.replace("\\", "/").replace("/", ".")
    parts = [p for p in cleaned.split(".") if p and p != "<locals>"]
    return parts[-1] if parts else None


def _function_from_path(
    http_method: Optional[str],
    endpoint: Optional[str],
    route: Optional[str],
) -> Optional[str]:
    segs = _path_segments(endpoint, route)
    if not segs:
        return None
    static = [s for s in segs if not _PARAM_RE.match(s) and not _UUIDISH_RE.match(s) and not s.isdigit()]
    last = static[-1] if static else segs[-1]
    last = last.replace("-", "_")
    if last in ("api", "files", "v1"):
        return None
    verb = (http_method or "GET").upper()
    has_id = any(_PARAM_RE.match(s) or _UUIDISH_RE.match(s) or s.isdigit() for s in segs)
    if verb in ("GET", "HEAD"):
        if has_id:
            return f"get_{_singular(last)}"
        return f"list_{last}" if last not in ("get", "list") else last
    if verb == "POST":
        if last.startswith("create_") or last.startswith("list_") or last.startswith("get_"):
            return last
        if last in ("create", "upload", "import"):
            return last
        return f"create_{_singular(last)}"
    if verb in ("PUT", "PATCH"):
        return f"update_{_singular(last)}"
    if verb == "DELETE":
        return f"delete_{_singular(last)}"
    return last


def display_method(
    route_method: Optional[str],
    *,
    service_name: Optional[str] = None,
    http_method: Optional[str] = None,
    resource_type: Optional[str] = None,
    endpoint: Optional[str] = None,
    route: Optional[str] = None,
) -> Optional[str]:
    """Handler label for the METHOD column: ``FolderService.list_folders``."""
    fn = _function_from_handler(route_method) or _function_from_path(http_method, endpoint, route)
    svc = _RESOURCE_SERVICE.get(resource_type or "")
    if not svc:
        svc = _title_service((service_name or "service").replace("-service", "_service"))
    if not fn:
        if not service_name and not http_method:
            return None
        fn = (http_method or "GET").lower()
    if fn in _SKIP_OWNERS:
        fn = (http_method or "GET").lower()
    return f"{svc}.{fn}"[:255]


def resource_from_request(
    *,
    endpoint: Optional[str] = None,
    route: Optional[str] = None,
    resource_type: Optional[str] = None,
    resource_id: Optional[str] = None,
) -> Tuple[Optional[str], Optional[str]]:
    rid = resource_id if resource_id not in ("", None) else None
    if resource_type:
        key = str(resource_type).replace("-", "_").replace(" ", "_").upper()
        return (_TYPE_ALIAS.get(key) or str(resource_type).upper()[:50], rid)
    hay = f"{route or ''} {endpoint or ''}"
    for rx, name in _PATH_RESOURCES:
        if rx.search(hay):
            return name, rid
    return None, rid


def enrich(
    *,
    http_method: Optional[str],
    endpoint: Optional[str] = None,
    route: Optional[str] = None,
    resource_type: Optional[str] = None,
    resource_id: Optional[str] = None,
    action: Optional[str] = None,
    route_method: Optional[str] = None,
    service_name: Optional[str] = None,
) -> dict:
    rtype, rid = resource_from_request(
        endpoint=endpoint, route=route, resource_type=resource_type, resource_id=resource_id
    )
    return {
        "action": action or action_from_http(http_method),
        "resource_type": rtype,
        "resource_id": rid,
        "method": display_method(
            route_method,
            service_name=service_name,
            http_method=http_method,
            resource_type=rtype,
            endpoint=endpoint,
            route=route,
        ),
    }
