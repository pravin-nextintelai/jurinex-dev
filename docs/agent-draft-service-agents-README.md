# Agents

All agent code lives in this folder. **One folder per agent, separate files per agent.**

| Folder | Agent | Files |
|--------|--------|--------|
| `orchestrator/` | Orchestrator | `agent.py`, `flow_controller.py`, `state_manager.py` |
| `ingestion/` | Ingestion | `agent.py`, `pipeline.py`, `chunker.py` |
| `librarian/` | Librarian | `agent.py`, `tools.py` |
| `drafter/` | Drafter | `__init__.py`, `prompts/` (stub; implement when needed) |
| `critic/` | Critic | `__init__.py` (stub; implement when needed) |
| `assembler/` | Assembler | `__init__.py` (stub; implement when needed) |

- **agent.py** — Entry point (e.g. `run_librarian_agent`, `run_ingestion_agent`). Called by the API or orchestrator.
- **tools.py** (Librarian) — Tool used by the agent (e.g. `fetch_relevant_chunks`).
- **pipeline.py** (Ingestion) — Pipeline logic (e.g. `run_ingestion`, `IngestionInput`, `IngestionResult`).
- **chunker.py** (Ingestion) — Chunking for ingestion.

Instructions for each agent are in **instructions/** (one `.txt` file per agent).  
Shared utilities live in **tools/** and **services/**.
