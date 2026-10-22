# JuriNex Citation Service — Unused and Legacy Code Files Analysis

This document identifies which code files in the `citation-service` are currently unused or represent legacy subsystems, highlighting which can be safely deleted immediately and which are still coupled to API endpoints or frontend features.

---

## 1. Safely Deletable Files (100% Unused)

These files can be deleted immediately. They have zero imports, are not registered as routers, and their absence will not affect the compilation or runtime behavior of the citation service.

```
+==============================================+========================================================================+
| FILE PATH                                    | RATIONALE FOR DELETION                                                 |
+==============================================+========================================================================+
| debug_ik_test.py                             | An ad-hoc query diagnostic script. Completely isolated; not imported.   |
+----------------------------------------------+------------------------------------------------------------------------+
| api/dependencies.py                          | Defines get_settings(), but main.py imports settings directly from     |
|                                              | core.config. Zero imports.                                             |
+----------------------------------------------+------------------------------------------------------------------------+
| api/routes/health.py                         | Placeholder route marker for health check. The live health route      |
|                                              | @app.get("/health") is declared directly inside main.py.              |
+----------------------------------------------+------------------------------------------------------------------------+
| api/routes/citation_report.py                | Placeholder route marker. The live routes are declared in main.py.     |
+----------------------------------------------+------------------------------------------------------------------------+
| api/routes/citation_status.py                | Placeholder route marker. The live status routes are in main.py.       |
+----------------------------------------------+------------------------------------------------------------------------+
| app/__init__.py                              | Empty package directory. No code files reside inside app/.             |
+==============================================+========================================================================+
```

---

## 2. Legacy / Dormant Subsystems (Coupled to Endpoints)

These files are part of the old V1 single-shot agent pipeline or manual research tools. While they are **not used** during standard V2 runs, they **cannot be deleted without refactoring main.py** because they are imported inline inside active endpoints that the frontend calls.

```
+==============================================+========================================================================+
| FILE PATH                                    | ACTIVE DEPENDENCY & FRONTEND COUPLING                                  |
+==============================================+========================================================================+
| agents/                                      | Directory containing the old V1 multi-agent swarm.                     |
|                                              | - main.py imports agents.root_agent at line 1138.                      |
|                                              | - main.py imports agents.proposition_pipeline at lines 2514 and 2562    |
|                                              |   for manual lookup endpoints.                                         |
|                                              | - frontend/src/services/citationApi.js still calls the endpoints:      |
|                                              |   /citation/manual/fetch-case-judgments and                            |
|                                              |   /citation/manual/search-by-keywords.                                 |
+----------------------------------------------+------------------------------------------------------------------------+
| legacy_pipeline.py                           | Implements the V1 pipeline. Imported by pipeline/__init__.py           |
|                                              | as a fallback when use_v2_pipeline() feature flag is False.            |
+----------------------------------------------+------------------------------------------------------------------------+
| instructions/citation.txt                    | Contains system prompts for citation_agent.py.                         |
+----------------------------------------------+------------------------------------------------------------------------+
| citation_agent.py                            | Legacy fallback single-shot LLM agent. Imported in main.py line 31     |
|                                              | and used if use_pipeline=False.                                        |
+----------------------------------------------+------------------------------------------------------------------------+
| report_builder.py                            | The V1 citation builder. Imported in main.py line 1592 during HITL     |
|                                              | approval (though not actively called in the handler body).             |
+==============================================+========================================================================+
```

---

## 3. Active V2 Architecture Files (Do NOT Delete)

These directories and files contain the current V2 engine, database operations, and active configurations.

* **`pipeline/`**: The core stages and orchestrator of the V2 pipeline.
* **`services/`**: Services for pricing, caching, query building, and reranking.
* **`db/`**: Client wrappers for PostgreSQL (`ik_document_assets`) and migrations.
* **`core/`**: Configuration, logging setups, and feature flag controllers.
* **`integrations/`**: API connectors for Gemini and Indian Kanoon.
* **`main.py`**: The primary microservice entry point.
* **`report_builder_claude.py`**: The template engine used for compiling final outputs.
* **`claude_proxy.py`**: Handles proxy requests to Anthropic's endpoints.
