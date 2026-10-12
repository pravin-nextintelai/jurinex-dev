"""Configuration for the central error logger.

Everything is read from environment variables so that a service needs no code
changes beyond the one ``install()`` call. All values have safe defaults; with
no configuration at all the logger stays enabled but has nowhere to write and
only warns once at startup.
"""
from __future__ import annotations

import json
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Set
from urllib.parse import urlsplit

# Hosts -> provider names that every service shares. The env var
# EXTERNAL_PROVIDERS adds to (or overrides) these. Matching is exact on
# ``host`` or ``host:port`` first, then by domain suffix.
DEFAULT_PROVIDERS: Dict[str, str] = {
    "generativelanguage.googleapis.com": "GEMINI",
    "aiplatform.googleapis.com": "GEMINI",
    "indiankanoon.org": "CITATION",
    "api.indiankanoon.org": "CITATION",
    "api.anthropic.com": "ANTHROPIC",
    "api.openai.com": "OPENAI",
    "api.deepseek.com": "DEEPSEEK",
    "documentai.googleapis.com": "DOCUMENT_AI",
    "speech.googleapis.com": "SPEECH",
    "storage.googleapis.com": "GCS",
    "oauth2.googleapis.com": "GOOGLE_AUTH",
    "customsearch.googleapis.com": "GOOGLE_SEARCH",
    "serper.dev": "SERPER",
    "api.brevo.com": "BREVO",
    "api.razorpay.com": "RAZORPAY",
    "api.office-integrator.in": "ZOHO",
    "graph.microsoft.com": "MICROSOFT",
    "login.microsoftonline.com": "MICROSOFT",
}

# Providers whose failures are AI failures (category AI_PROVIDER) rather than
# plain EXTERNAL_API failures.
AI_PROVIDERS: Set[str] = {"GEMINI", "ANTHROPIC", "OPENAI", "DEEPSEEK"}

# Env var names whose values are internal/external base URLs. The provider name
# is derived from the variable name: PAYMENT_SERVICE_URL -> PAYMENT_SERVICE.
_URL_VAR_RE = re.compile(r"^[A-Z][A-Z0-9_]*_(SERVICE_URL|API_URL|BASE_URL|URL)$")
_URL_SUFFIXES = ("_SERVICE_URL", "_API_URL", "_BASE_URL", "_URL")
# Variables that name the citation API, whatever the host is.
_CITATION_VARS = {"IK", "INDIAN_KANOON", "INDIANKANOON", "CITATION_API"}

_TRUE = {"1", "true", "yes", "on", "y"}

# Values read from the service's .env file when the service loads that file
# through pydantic-settings, which does not export to os.environ. Populated by
# ``load()``; os.environ always wins.
_FILE_ENV: Dict[str, str] = {}
_FILE_ENV_KEYS = ("SERVICE_NAME", "ENVIRONMENT", "APP_ENV", "ENV", "EXTERNAL_PROVIDERS")


def _read_dotenv(root: Path) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for name in (".env",):
        path = root / name
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if key.startswith("export "):
                key = key[7:].strip()
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            elif " #" in value:
                value = value.split(" #", 1)[0].rstrip()
            if key and (key.startswith("ERROR_LOG_") or key in _FILE_ENV_KEYS or key.endswith("_URL")):
                out[key] = value
    return out


def _getenv(name: str) -> Optional[str]:
    raw = os.environ.get(name)
    if raw is None:
        raw = _FILE_ENV.get(name)
    return raw


def _bool(name: str, default: bool) -> bool:
    raw = _getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in _TRUE


def _int(name: str, default: int) -> int:
    raw = _getenv(name)
    try:
        return int(raw) if raw not in (None, "") else default
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    raw = _getenv(name)
    try:
        return float(raw) if raw not in (None, "") else default
    except ValueError:
        return default


def _skip_statuses() -> Set[int]:
    raw = _getenv("ERROR_LOG_SKIP_STATUS") or "400,401,403,404,409,422"
    out: Set[int] = set()
    for part in re.split(r"[,\s;]+", raw.strip()):
        if part.isdigit():
            out.add(int(part))
    return out


_DEV_INGEST_KEY = "jurinex-errorlog-dev"
_PROD_ENVS = {"production", "prod", "live"}


def _normalize_ingest_url(raw: Optional[str]) -> Optional[str]:
    """Always POST errors to {origin}/internal/error-logs (drop path prefixes)."""
    if not raw:
        return None
    raw = raw.strip().strip('"')
    if not raw:
        return None
    parts = urlsplit(raw)
    if parts.scheme and parts.netloc:
        path = (parts.path or "").rstrip("/")
        if path.endswith("/internal/error-logs"):
            return f"{parts.scheme}://{parts.netloc}{path}"
        if path.endswith("/internal/audit-logs"):
            prefix = path[: -len("/internal/audit-logs")]
            return f"{parts.scheme}://{parts.netloc}{prefix}/internal/error-logs"
        return f"{parts.scheme}://{parts.netloc}/internal/error-logs"
    u = raw.rstrip("/")
    if u.endswith("/internal/audit-logs"):
        u = u[: -len("/internal/audit-logs")] + "/internal/error-logs"
    elif not u.endswith("/internal/error-logs"):
        u = u + "/internal/error-logs"
    return u


def _parse_providers(raw: Optional[str]) -> Dict[str, str]:
    """Accept JSON (``{"host": "NAME"}``) or ``host=NAME,host2=NAME2``."""
    out: Dict[str, str] = {}
    if not raw or not raw.strip():
        return out
    raw = raw.strip()
    if raw.startswith("{"):
        try:
            data = json.loads(raw)
            if isinstance(data, dict):
                for k, v in data.items():
                    out[str(k).lower().strip()] = str(v).upper().strip()
            return out
        except ValueError:
            return out
    for part in re.split(r"[,;\s]+", raw):
        if "=" in part:
            host, name = part.split("=", 1)
        elif ":" in part and not part.split(":", 1)[1].isdigit():
            host, name = part.split(":", 1)
        else:
            continue
        if host and name:
            out[host.lower().strip()] = name.upper().strip()
    return out


def _providers_from_env() -> Dict[str, str]:
    """Map the hosts of every ``*_URL`` environment variable to a provider name."""
    out: Dict[str, str] = {}
    merged = dict(_FILE_ENV)
    merged.update(os.environ)
    for name, value in merged.items():
        if not _URL_VAR_RE.match(name) or name.startswith("ERROR_LOG_"):
            continue
        value = (value or "").strip().strip('"').strip("'")
        if not value.lower().startswith(("http://", "https://")):
            continue
        try:
            host = (urlsplit(value).netloc or "").lower()
        except ValueError:
            continue
        host = host.rsplit("@", 1)[-1]  # drop userinfo if any
        if not host:
            continue
        provider = name
        for suffix in _URL_SUFFIXES:
            if provider.endswith(suffix):
                provider = provider[: -len(suffix)]
                break
        if provider in _CITATION_VARS or "KANOON" in provider:
            provider = "CITATION"
        if provider in ("DATABASE", "DB", "REDIS", "PAYMENT_DB", "DRAFT_DATABASE"):
            continue
        out.setdefault(host, provider)
        bare = host.split(":", 1)[0]
        out.setdefault(bare, provider)
    return out


def _service_name_default() -> str:
    """Fall back to the name of the service's directory (``Backend/<name>``)."""
    try:
        return Path(os.getcwd()).name or "unknown-service"
    except OSError:
        return "unknown-service"


@dataclass
class Config:
    service_name: str
    environment: str
    enabled: bool = True
    retention_days: int = 90
    store_ai_content: bool = False
    skip_status: Set[int] = field(default_factory=_skip_statuses)
    # Errors from AI/external calls that the request then recovered from (final
    # status 2xx/3xx) are dropped unless this is on: the user never saw them.
    store_recovered_external: bool = False
    # Endpoint prefixes whose 4xx answers (except 401/403/404) are stored as WARNING
    # rows, e.g. "/api/payments" keeps "Invalid payment signature" although it is a 400.
    store_4xx_prefixes: List[str] = field(default_factory=list)
    # Capture-all mode (default): every recorded error is stored, including ones the
    # request recovered from (marked payload.recovered, severity WARNING), and every
    # 4xx/5xx response gets a row. With it off, only errors the user got are kept.
    capture_all: bool = False
    # Path of the browser error-report route on this service, if mounted.
    client_report_path: Optional[str] = None
    # API audit log: one api_audit_logs row per request (who used which service/API).
    audit_enabled: bool = True
    audit_skip_prefixes: List[str] = field(default_factory=list)
    audit_retention_days: int = 90
    providers: Dict[str, str] = field(default_factory=dict)
    database_url: Optional[str] = None
    ingest_url: Optional[str] = None
    ingest_key: Optional[str] = None
    queue_max: int = 10000
    batch_size: int = 50
    flush_interval_s: float = 2.0
    db_connect_timeout_s: float = 5.0
    http_timeout_s: float = 5.0
    own_code_root: Path = field(default_factory=lambda: Path(os.getcwd()))
    debug_routes: bool = False
    retention_enabled: bool = True
    # Record responses this large at most (bytes peeked for user_message).
    body_peek_bytes: int = 4096

    @property
    def is_production(self) -> bool:
        return self.environment.lower() in {"production", "prod", "live"}

    @property
    def has_sink(self) -> bool:
        return bool(self.database_url or self.ingest_url)

    def provider_for_host(self, host: Optional[str]) -> Optional[str]:
        if not host:
            return None
        host = host.lower().strip()
        host_noport = host.split(":", 1)[0]
        for key in (host, host_noport):
            if key in self.providers:
                return self.providers[key]
        # Suffix match: asia-south1-aiplatform.googleapis.com -> GEMINI
        for key, value in self.providers.items():
            if host_noport.endswith("." + key) or host_noport.endswith("-" + key):
                return value
        return None


def load(
    service_name: Optional[str] = None,
    own_code_root: Optional[Path] = None,
    *,
    owner: bool = False,
) -> Config:
    """Build a Config from the environment.

    ``owner`` marks the FastAPI service that owns the ``error_logs`` table: when
    no ERROR_LOG_DATABASE_URL is set it falls back to its own DATABASE_URL.
    """
    root = Path(own_code_root) if own_code_root else Path(os.getcwd())
    try:
        root = root.resolve()
    except OSError:
        pass
    _FILE_ENV.clear()
    _FILE_ENV.update(_read_dotenv(root))

    providers = dict(DEFAULT_PROVIDERS)
    providers.update(_providers_from_env())
    providers.update(_parse_providers(_getenv("EXTERNAL_PROVIDERS")))

    database_url = (_getenv("ERROR_LOG_DATABASE_URL") or "").strip().strip('"') or None
    if not database_url and owner:
        database_url = (_getenv("DATABASE_URL") or "").strip().strip('"') or None
    environment = (
        _getenv("ENVIRONMENT")
        or _getenv("APP_ENV")
        or os.environ.get("NODE_ENV")
        or _getenv("ENV")
        or "development"
    ).strip()

    ingest_url = _normalize_ingest_url((_getenv("ERROR_LOG_INGEST_URL") or "").strip().strip('"') or None)
    ingest_key = (_getenv("ERROR_LOG_INGEST_KEY") or "").strip().strip('"') or None
    if not ingest_key and environment.lower() not in _PROD_ENVS:
        ingest_key = _DEV_INGEST_KEY

    capture_all = _bool("ERROR_LOG_CAPTURE_ALL", False)
    # In capture-all mode nothing is skipped unless ERROR_LOG_SKIP_STATUS says so explicitly.
    skip_status = _skip_statuses() if (not capture_all or _getenv("ERROR_LOG_SKIP_STATUS") is not None) else set()

    cfg = Config(
        service_name=(service_name or _getenv("SERVICE_NAME") or _service_name_default()).strip(),
        environment=environment,
        enabled=_bool("ERROR_LOG_ENABLED", True),
        retention_days=_int("ERROR_LOG_RETENTION_DAYS", 90),
        store_ai_content=_bool("ERROR_LOG_STORE_AI_CONTENT", False),
        skip_status=skip_status,
        capture_all=capture_all,
        store_recovered_external=_bool("ERROR_LOG_STORE_RECOVERED_EXTERNAL", False),
        store_4xx_prefixes=[p.strip() for p in re.split(r"[,\s;]+", _getenv("ERROR_LOG_STORE_4XX_PREFIXES") or "") if p.strip()],
        audit_enabled=_bool("ERROR_LOG_AUDIT_ENABLED", True),
        audit_skip_prefixes=[
            p.strip()
            for p in re.split(r"[,\s;]+", _getenv("ERROR_LOG_AUDIT_SKIP_PREFIXES") or "/health,/internal,/api/auth/internal,/api/files/client-errors,/api/payments/client-errors,/docs,/openapi.json,/redoc,/favicon.ico")
            if p.strip()
        ],
        audit_retention_days=_int("ERROR_LOG_AUDIT_RETENTION_DAYS", 90),
        providers=providers,
        database_url=database_url,
        ingest_url=ingest_url,
        ingest_key=ingest_key,
        queue_max=_int("ERROR_LOG_QUEUE_MAX", 10000),
        batch_size=_int("ERROR_LOG_BATCH_SIZE", 50),
        flush_interval_s=_float("ERROR_LOG_FLUSH_INTERVAL_S", 2.0),
        db_connect_timeout_s=_float("ERROR_LOG_DB_CONNECT_TIMEOUT_S", 5.0),
        http_timeout_s=_float("ERROR_LOG_HTTP_TIMEOUT_S", 5.0),
        own_code_root=root,
        retention_enabled=_bool("ERROR_LOG_RETENTION_ENABLED", True),
    )
    cfg.debug_routes = _bool("ERROR_LOG_DEBUG_ROUTES", not cfg.is_production)
    if "ERROR_LOG_RETENTION_ENABLED" in _FILE_ENV and "ERROR_LOG_RETENTION_ENABLED" not in os.environ:
        os.environ["ERROR_LOG_RETENTION_ENABLED"] = _FILE_ENV["ERROR_LOG_RETENTION_ENABLED"]
    return cfg


# Paths that are never "our own code" when looking for the first own-code frame.
FOREIGN_PATH_MARKERS = (
    "site-packages",
    "dist-packages",
    os.sep + "venv" + os.sep,
    os.sep + ".venv" + os.sep,
    os.sep + "errorlog" + os.sep,
    "<frozen",
    "<string>",
)
STDLIB_PREFIXES = tuple(
    {
        getattr(sys, "base_prefix", sys.prefix),
        sys.prefix,
        getattr(sys, "base_exec_prefix", sys.prefix),
    }
)
