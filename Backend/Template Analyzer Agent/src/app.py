import os
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from .routers import analysis
from .routers import generate as generate_router
from .database import engine, Base
# Import all models to register them with Base.metadata
from .models.db_models import UserTemplate, UserTemplateField, UserTemplateAnalysisSection, UserTemplateReferenceDocument

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="User Template Analyser Agent")

# CORS must be added FIRST so it wraps all responses (including errors) and handles preflight OPTIONS
_cors_origins = [
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
    "https://jurinex-dev.netlify.app",
    "https://nexintel.netlify.app",
    "https://ailearn.co.in",
]
_extra = os.environ.get("CORS_ORIGINS", "").strip()
if _extra:
    _cors_origins.extend(o.strip() for o in _extra.split(",") if o.strip())
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_origin_regex=r"https://.*\.netlify\.app|https://.*\.ailearn\.co\.in",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

class RequestLogMiddleware(BaseHTTPMiddleware):
    """Log every incoming request so activity is visible in console."""
    async def dispatch(self, request, call_next):
        path = request.url.path
        method = request.method
        has_auth = "authorization" in [k.lower() for k in request.headers.keys()]
        has_x_user = "x-user-id" in [k.lower() for k in request.headers.keys()]
        print(f"[Template Analyzer] >>> {method} {path} (Auth: {has_auth}, X-User-Id: {has_x_user})", flush=True)
        logger.info(f"Incoming: {method} {path}")
        response = await call_next(request)
        print(f"[Template Analyzer] <<< {method} {path} -> {response.status_code}", flush=True)
        return response

app.add_middleware(RequestLogMiddleware)

@app.on_event("startup")
async def startup():
    # Create tables for AI-generated template models if they don't exist yet.
    # These tables (user_templates, user_template_fields, user_template_analysis_sections)
    # are owned by this service and not managed by external migrations.
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables ensured (User Templates Service).")

app.include_router(analysis.router)
app.include_router(generate_router.router)

# ── Central error capture (docs/error-logging.md). Vendored copy: ../errorlog ──
from errorlog import install as _install_errorlog  # noqa: E402

_install_errorlog(
    app,
    service_name="template-analyzer-agent",
    own_code_root=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    parse_helpers=("src.services.agent_service:AgentService._parse_json",),
)

@app.get("/")
async def root():
    return {"message": "User Template Analyzer Agent is active."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5017)
