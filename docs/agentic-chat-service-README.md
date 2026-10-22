# Agentic Chat Service

Python **FastAPI** service that replaces the Node.js **ChatModel** using the official [**Google ADK**](https://google.github.io/adk-docs/) (Agent Development Kit).

## Agents (registered keys)

| Key | Agent | Role |
|-----|--------|------|
| `query_classifier` | Query Classifier | Classifies chat request and routing strategy |
| `file_based` | File Based Agent | Document Q&A for uploaded files |
| `legal_case_content` | Legal Case Content | Secret / preset prompt flows |
| `general_content` | General Content | General legal Q&A without documents |

Pipeline: `query_classifier` → route → `file_based` | `legal_case_content` | `general_content`

## API (same as ChatModel)

All routes are mounted at **`/api/chat/*`** so the existing frontend works unchanged.

- `GET /health`
- `GET /api/chat/limits`
- `POST /api/chat/ask`, `/ask/stream`
- `POST /api/chat/ask/general/stream`
- Upload: `/upload-document/initiate`, `/upload-document/complete`
- History, sessions, secrets, Gemini cache routes

## Run locally

```bash
cd Backend/agentic-chat-service
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Environment is loaded from:

1. `Backend/agentic-chat-service/.env`
2. `Backend/ChatModel/.env` (shared secrets)

```bash
uvicorn main:app --reload --port 8096
```

## Frontend

Set in `Frontend/.env`:

```env
VITE_APP_AGENTIC_CHAT_SERVICE_URL=http://localhost:8096
```

The app uses this URL instead of the legacy ChatModel service when set.

## ADK + context caching

- Default model: `ADK_MODEL=gemini-2.5-pro`
- ADK `App` + `InMemoryRunner` execute document Q&A against Gemini explicit context caches.
- Document Q&A uses Gemini explicit cache APIs: create/get/update/delete.
- PostgreSQL stores cache sessions, token usage, query history, TTL, and cost metrics.

## ADK reference

- Docs: https://google.github.io/adk-docs/
- Context caching: https://adk.dev/context/caching/
- Install: `pip install "google-adk>=1.15.0"`

If `google-adk` is not installed, the service falls back to direct Python routing (same API responses).
