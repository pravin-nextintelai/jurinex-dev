# Backend Services & Ports Reference

## Frontend expectations (from `frontend/src/config/apiConfig.js`)

| Service | Frontend default URL | Port |
|---------|----------------------|------|
| **Gateway** | `VITE_APP_GATEWAY_URL` / `VITE_APP_API_URL` | **5000** |
| **Auth** | via Gateway `/api/auth` | 5001 (backend) |
| **Document / Files / Mindmap** | via Gateway `/api/doc`, `/api/files`, `/api/content`, `/mindmap` | 5002 or 8080 (see Gateway) |
| **Payment** | via Gateway `/payments` | **5003** |
| **Drafting (Google Docs)** | `VITE_DRAFTING_SERVICE_URL` (direct) | **5005** |
| **Zoho drafting** | via Gateway `/api/drafting` | **5006** |
| **Template Analyzer** | `VITE_APP_TEMPLATE_ANALYZER_URL` (direct) | **5017** |
| **Agent-Draft (templates, drafts, AI)** | `VITE_APP_AGENT_DRAFT_TEMPLATE_URL` (direct) | **8000** |
| **Citation** | `VITE_APP_CITATION_SERVICE_URL` (direct) | **8001** |
| **Chat** | via Gateway `/api/chat` | 8080 (document-service) |
| **Visual (mindmap)** | via Gateway `/visual` | **8081** |
| **Content service direct** | `VITE_DOCUMENT_SERVICE_URL` | **5002** |

## Gateway proxy targets (from `Backend/gateway-service`)

| Gateway path | Backend service | Default target port |
|--------------|-----------------|----------------------|
| `/api/auth` | authservice | **5001** |
| `/api`, `/docs`, `/files`, `/mindmap` | document-service (FILE_SERVICE_URL) | **5002** |
| `/api/chat` | document-service (CHAT_SERVICE_URL) | **8080** |
| `/payments`, `/user-resources` | payment-service | **5003** |
| `/support` | support-service | **5004** |
| `/drafting` (Google) | drafting-service | **5005** |
| `/drafting` (MS Word) | draft-service | **4000** |
| `/api/drafting` (Zoho) | zoho-service | **5006** |
| `/visual` | Visual-Service | **8081** |
| `/api/drafting-ai` | agent-draft (AI_SERVICE_URL) | **5002** |
| `/api/drafting-templates`, `/api/drafts` | drafting-template service | **5010** |
| `/api/template-analysis` | Template Analyzer Agent | **5017** |

**Note:** Frontend calls **Agent-Draft** directly on port **8000** and **Citation** on **8001**. Gateway uses **5002** for files/docs and drafting-ai; you can run document-service on **8080** and set `FILE_SERVICE_URL=http://localhost:8080` so one service serves both.

## Backend services summary (port to run on)

| # | Service | Port | Type |
|---|---------|------|------|
| 1 | gateway-service | 5000 | Node |
| 2 | authservice | 5001 | Node |
| 3 | document-service | 8080 | Node (gateway chat; set FILE_SERVICE_URL=8080 for files) |
| 4 | payment-service | 5003 | Node |
| 5 | Translation-service | 3000 | Node |
| 6 | zoho-service | 5006 | Node |
| 7 | drafting-service | 5005 | Node |
| 8 | draft-service | 4000 | Node |
| 9 | ChatModel | 5007 | Node (optional; gateway chat uses document 8080) |
| 10 | citation-service | 8001 | Python (FastAPI) |
| 11 | agent-draft-service | 8000 | Python (FastAPI) |
| 12 | Visual-Service | 8081 | Python (Flask) |
| 13 | Template Analyzer Agent | 5017 | Python (FastAPI) |
| 14 | judgement-service | 8005 | Python (FastAPI + Google ADK) |

*(No separate support-service or drafting-template service in repo; gateway has placeholders for 5004 and 5010.)*

---

## Commands to run all services

### Option 1: One script (opens each service in a new window)

From repo root:

```powershell
powershell -ExecutionPolicy Bypass -File .\Backend\run-all-backends.ps1
```

### Option 2: Manual commands (run each in its own terminal)

**Node (from repo root; set PORT and run from service folder):**

```powershell
# 1. Gateway (5000)
cd Backend\gateway-service; $env:PORT=5000; npm start

# 2. Auth (5001)
cd Backend\authservice; $env:PORT=5001; npm start

# 3. Document (8080)
cd Backend\document-service; $env:PORT=8080; npm start

# 4. Payment (5003)
cd Backend\payment-service; $env:PORT=5003; npm start

# 5. Translation (3000)
cd Backend\Translation-service; $env:PORT=3000; npm start

# 6. Zoho (5006)
cd Backend\zoho-service; $env:PORT=5006; npm start

# 7. Drafting - Google (5005)
cd Backend\drafting-service; $env:PORT=5005; npm start

# 8. Draft - MS Word (4000)
cd Backend\draft-service; $env:PORT=4000; npm start

# 9. ChatModel (5007) - optional
cd Backend\ChatModel; $env:PORT=5007; npm start
```

**Python (from repo root):**

```powershell
# 10. Citation (8001)
# If you see "did not find executable at '/usr/bin\python.exe'", the venv was created on Linux.
# Fix: recreate venv on Windows, then run:
#   cd Backend\citation-service
#   Rename-Item venv venv.linux.bak  # optional backup
#   py -m venv venv
#   .\venv\Scripts\Activate.ps1
#   pip install -r requirements.txt
cd Backend\citation-service; .\venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8001

# 11. Agent-Draft (8000)
cd Backend\agent-draft-service; python -m uvicorn main:app --host 0.0.0.0 --port 8000

# 12. Visual (8081)
cd Backend\Visual-Service; $env:PORT=8081; python main.py

# 13. Template Analyzer (5017)
cd "Backend\Template Analyzer Agent"; python -m uvicorn main:app --host 0.0.0.0 --port 5017

# 14. Judgement (8005) — ADK legal search pipeline (Citation Research module)
cd Backend\judgement-service; .\venv\Scripts\python.exe -m uvicorn api:app --host 0.0.0.0 --port 8005
```

**Gateway env (optional):** If you run only document-service on 8080 and want files/docs/chat to use it, set before starting gateway:

```powershell
$env:FILE_SERVICE_URL = "http://localhost:8080"
$env:CHAT_SERVICE_URL = "http://localhost:8080"
```
