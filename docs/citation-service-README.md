# JuriNex Citation Service

Standalone microservice: **Watchdog -> Fetcher -> Clerk -> Verified Citation Report**.

1. **Watchdog** finds relevant judgements from: local DB -> Indian Kanoon API -> Google (Gemini Grounding by default; Serper when WATCHDOG_USE_CLAUDE_SEARCH or WATCHDOG_GOOGLE_SEARCH_PROVIDER=serper).
2. **Fetcher** fetches full document content for IK and Google candidates.
3. **Clerk** chunks and stores judgements across PostgreSQL, Elasticsearch, Qdrant, and Neo4j.
4. Report is built in the **same format** as the frontend (ALL_CITATIONS) and stored **user-specific** in DB.

## Database (Multi-DB)

- **PostgreSQL** - metadata (table: `judgments`) + user reports (`citation_reports`)
- **Elasticsearch** - full-text index (`judgments`) including paragraphs and extra fields (citations, excerpts)
- **Qdrant** - semantic embeddings (`legal_embeddings`)
- **Neo4j** - citation graph (`Case` nodes, `CITES` relations)

Canonical ID (`canonical_id`) is used across all databases.

## Endpoints

- **GET /** - Service info
- **GET /health** - Health check
- **POST /citation/report** - Body: `query`, `user_id` (optional), `use_pipeline` (default true). Runs full pipeline; returns `report_id`, `report_format` (citations array for frontend).
- **GET /citation/reports?user_id=** - List user's reports
- **GET /citation/reports/:id** - Get one report (same format as frontend React report page)

## Environment

- **GEMINI_API_KEY** (required) - Gemini for citation agent, Clerk, ReportBuilder, and Google Search grounding
- **WATCHDOG_GOOGLE_SEARCH_PROVIDER** (optional) - `google_grounding` (default) or `serper`
- **WATCHDOG_USE_CLAUDE_SEARCH** (optional) - when true, use Serper instead of Gemini grounding
- **SERPER_API_KEY** (optional) - required only when using Serper for Google search
- **INDIAN_KANOON_API_TOKEN** or **IK_API_TOKEN** (optional) - Indian Kanoon API search + doc fetch
- **CITATION_DB_URL** or **DATABASE_URL** (required) - PostgreSQL connection string
- **ELASTICSEARCH_URL** (required) - Elasticsearch endpoint
- **QDRANT_URL** (required) - Qdrant endpoint
- **NEO4J_URI**, **NEO4J_USERNAME**, **NEO4J_PASSWORD** (required) - Neo4j connection
- **CORS_ORIGINS** (optional) - Comma-separated origins

## Run

```bash
cd Backend/citation-service
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```

Frontend: **/citation** (generate form) and **/citation/reports/:reportId** (verified citation report in same format as design).
