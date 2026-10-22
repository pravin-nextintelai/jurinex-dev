# Template Analyzer Agent

FastAPI service that analyzes legal/document templates (PDF or text), extracts sections and fields, and generates AI prompts. It also handles template list/upload with JWT-based access (admin vs user).

---

## How it works (flow)

1. **Run the agent** (e.g. `uvicorn src.app:app --reload`). It connects to your DB and creates tables if needed.
2. **Frontend / backend** call the agent with the same JWT used at login (`Authorization: Bearer <token>`).
3. **List templates** – `GET /analysis/templates`: Admin sees only admin-added templates; users see admin-added + their own.
4. **Upload template** – `POST /analysis/upload-template`: Sends file + metadata; agent extracts text, runs AI, stores template and sets `user_id` from the token.
5. **Get/update/delete** – Other endpoints are documented in [API_DOCUMENTATION.md](./API_DOCUMENTATION.md); access is enforced by role and ownership.

---

## Setup

1. **Go to the agent folder and create a venv:**
   ```powershell
   cd "Template Analyzer Agent"
   python -m venv venv
   .\venv\Scripts\activate
   ```
2. **Install dependencies:**
   ```powershell
   pip install -r requirements.txt
   ```
3. **Configure `.env`** in this folder (copy from example if needed). Required: `DATABASE_URL` (Draft_DB), `JWT_SECRET` (same as your backend), and any keys for GCS/Gemini/Document AI. For role-based template routing set `AUTH_DATABASE_URL` (Auth_DB) so the agent can check `super_admins`/`admin_roles` and `users`; admin/super-admin uploads go to `templates`, user uploads to `user_templates`.
4. **Run:**
   ```powershell
   uvicorn src.app:app --reload
   ```
   API: `http://localhost:8000`. Interactive docs: `http://localhost:8000/docs`.

---

## API documentation

Full API reference, behavior, and **user-side frontend examples** (Fetch & Axios) are in:

**[API_DOCUMENTATION.md](./API_DOCUMENTATION.md)**

It includes:
- How it works and authentication
- All endpoints (list, upload, get one, update, delete)
- User-side API: fetch templates, upload template, get details, with copy-paste examples
