# Personalization (prompt-pattern profile → generated chat instruction)

Lives in **agentic-document-service** (port 8092) and the document-chat UI
(`ChatInterface.jsx`). Learns *how* a user likes to work from the prompts they
type, and lets them turn that into an instruction the assistant follows.

## Flow

```
User prompt arrives (/api/files/{folder}/intelligent-chat/stream)
   ↓  fire-and-forget (worker thread)
personalization_prompts  (per-user prompt_no, batch_no = (prompt_no-1)//10 + 1)
   ↓  prompt_no % 10 == 0 ?
Profile Builder (background thread)
   reads: previous profile JSON + that batch's 10 prompts
   writes: personalization_profiles (version + 1, prompts_covered)
```

```
"Generate instruction" button (wand icon in the chat composer)
   ↓
latest profile (or DEFAULT_LEGAL_PROFILE for < 10 prompts) + current session's prompts
   ↓
Instruction Generator → structured plain text shown in the modal (editable)
   ↓  "Add to system"  (replace | append to current)
personalization_instructions (is_active = true; older rows deactivated)
   ↓
Every chat message: system prompt = build_document_qa_system_prompt(profile)
                                   + active instruction block (always-on rules)
                                   + memory block (just-in-time topic notes, separate)
```

## Two separate features

**Instructions** are rules the user writes or generates, then “Add to system”.
That block is appended to every chat turn until they turn it off.

**Memory** is a different store: small subject-scoped files
(`/profile.md`, `/preferences.md`, `/topics/`, `/areas/`, `/people/`), not a
transcript dump. Chat injects a lightweight listing, then only reads files
whose descriptions match the message (plus profile and preferences). Explicit
“remember this” writes immediately; implicit filing runs after the turn.

Memory is **files only**, the same shape as a Claude project memory. Raw
conversations are **not** memory: they are never listed in the Memory panel,
never searched, and never injected into a prompt. What survives a chat is
whatever the extractor wrote into a file. `folder_chats` stays the chat-history
store for the chat UI and for the instruction generator — separate features.

Memory is **one switch**, in profile **Settings → Memory** (`SettingsPage.jsx`,
nav id `memory`). On means files can be listed/read/written and durable facts are
filed after a turn; off means none of it. There are no per-behaviour toggles in
the UI: `update_settings(enabled=...)` drives `generate_from_chats`. The
case-page and composer panels show memory FILES only — no switch — and link to
Settings when Memory is off. Incognito on the composer neither reads nor writes
Memory.

`sensitive_data` is deliberately NOT part of the single switch. Health,
political, religious, orientation, caste and financial facts stay unstored
unless a caller sets that flag on purpose through the API; the UI never does.

The style profile (`personalization_profiles`) is used only to generate
Instructions. It is not shown in the Memory card and is not mixed into memory
notes.

## Files

| Layer | File |
|---|---|
| Prompts + default profile | `Backend/agentic-document-service/app/services/personalization_prompts.py` |
| Service (DB, builder, generator, background jobs) | `Backend/agentic-document-service/app/services/personalization_service.py` |
| Routes | `Backend/agentic-document-service/app/api/routes/personalization.py` |
| Chat hooks | `Backend/agentic-document-service/app/api/routes/files.py` (`intelligent_chat_stream`) |
| Instruction DDL | `Backend/agentic-document-service/db/migrations/170_create_personalization_tables.sql` |
| Memory (topic notes, JIT retrieval, chat search) | `Backend/agentic-document-service/app/services/memory_service.py` |
| Memory DDL | `Backend/agentic-document-service/db/migrations/171_create_memory_topics.sql`, `172_memory_files.sql`, `173_project_memory_scope.sql` |
| Project memory isolation test | `Backend/agentic-document-service/tests/test_project_memory_isolation.py` |
| Frontend API client | `frontend/src/services/personalizationService.js` |
| Instructions + Memory UI | `frontend/src/components/Personalization/PersonalizationSections.jsx`, `MemoryPanel.jsx` |
| Modal | `frontend/src/components/Personalization/PersonalizationModal.jsx` |

## API (`/api/files/personalization`, Bearer JWT)

| Method | Path | Purpose |
|---|---|---|
| GET | `/status` | prompt count, batch size, prompts until next profile update, latest profile summary, active instruction |
| GET | `/profile` | latest profile JSON (`is_default: true` for a new user) |
| POST | `/profile/rebuild` | run the builder now, folding in a partial batch (`{"allow_partial": true}`) |
| POST | `/import-history` | run OLD chats through the normal flow: `{}` = whole history, or `{"session_id"}` / `{"folder_name"}`. Questions from `folder_chats` are appended to the prompt log in order (counter +1, `batch_no`, original timestamp, `source_ref = folder_chats:<id>` so it is idempotent); completed batches schedule the background Profile Builder. Returns `{imported, prompt_count, batches_completed, rebuild_scheduled}`. Picking a "Past chat" in the UI does this for that chat automatically before generating. |
| POST | `/instructions/generate` | `{"session_id", "scope": "auto" \| "session" \| "history", "import_history": bool}` → `{instruction_text, profile_version, profile_is_default, history_source, history_prompt_count, imported_prompts, model}`. `session`/`auto`: that chat's prompts — an OLDER chat is first imported into the prompt log (memory flow), then used. `history` (the direct "Generate from my past prompts" button): the user's last 60 prompts across chats; with `import_history` every old chat is imported first. |
| POST | `/instructions/polish` | `{"instruction_text"}` (hand-written draft) → `{instruction_text}` rewritten into the standard format, every stated preference kept |
| POST | `/instructions/activate` | `{"instruction_text", "mode": "replace" \| "append", "origin": "manual" \| "generated" \| "polished"}` → active row |
| GET | `/instructions` | history, active first |
| GET | `/instructions/active` | the block currently appended to the chat prompt |
| POST | `/instructions/deactivate` | turn personalization off |
| DELETE | `/instructions/{id}` | delete one row |
| GET | `/prompts?session_id=&limit=` | logged prompts |
| GET | `/memory/settings` | enabled, generate-from-chats, sensitive-data |
| PUT | `/memory/settings` | `{"enabled"}` is the single switch and cascades to `generate_from_chats`; the granular keys still work for API callers |
| GET | `/memory/topics?folder_name=` | memory files (global + this case) |
| GET | `/memory/files?folder_name=` | listing only: path + description |
| GET | `/memory/file?path=` | read one file |
| PUT | `/memory/file` | write one file by path |
| POST | `/memory/remember` | save an explicit note |
| POST | `/memory/forget` | delete notes matching a query |
| PATCH | `/memory/topics/{id}` | edit / pin a note |
| DELETE | `/memory/topics/{id}` | delete one note |
| GET | `/memory/search?q=` | keyword search of memory FILES (no conversations) |
| GET | `/memory/projects/{project_id}` | project listing: slug + description, never content |
| GET | `/memory/projects/{project_id}/{slug}` | read one project file (404 outside that project) |
| DELETE | `/memory/projects/{project_id}/{slug}` | hard-delete one project file |

## Settings (`.env` of agentic-document-service)

| Key | Default | Meaning |
|---|---|---|
| `PERSONALIZATION_ENABLED` | `true` | master switch (logging + prompt injection) |
| `PERSONALIZATION_BATCH_SIZE` | `10` | prompts per profile rebuild |
| `PERSONALIZATION_MODEL` | `gemini-2.5-flash` | builder + generator model; falls back to 2.5-flash → 2.5-pro → 2.0-flash |
| `PERSONALIZATION_MAX_PROMPT_CHARS` | `4000` | per-prompt storage cap |
| `PERSONALIZATION_MEMORY_MAX_INJECT_CHARS` | `2800` | cap on retrieved memory text injected per chat turn |
| `PERSONALIZATION_MEMORY_MAX_RETRIEVE` | `4` | max topic notes loaded for a turn (plus pinned) |
| `PERSONALIZATION_MEMORY_DIRECTIVE_ENABLED` | `true` | run the READ_MEMORY router on project chats |
| `PERSONALIZATION_MEMORY_DIRECTIVE_MODEL` | `gemini-2.5-flash` | model for the router and the post-turn extractor |
| `PERSONALIZATION_MEMORY_DIRECTIVE_TIMEOUT_S` | `6.0` | extra budget the chat route allows for the router call |
| `PERSONALIZATION_MEMORY_TURN_EXTRACT_ENABLED` | `true` | background write-back after a finished turn |

## Case scoping (every case keeps its own prompts)

- Prompts are logged with `folder_name`. `GET /status?folder_name=`, `GET /prompts?folder_name=`
  and `POST /instructions/generate {"folder_name"}` restrict to that case; the case page's
  "Generate from this case's prompts" button and the "This case" pill use it (`history_source: "case"`,
  last section titled "From this case"). "All cases" omits the folder.
- Instructions have a scope: `folder_name` set = applies only to that case; NULL = the user's
  global instruction. Resolution in the chat route (`build_active_instruction_block(user_id, folder_name)`):
  the case's own active instruction wins, else the global one. Activate/replace/append/deactivate
  act within the scope that applies (`POST /instructions/activate {"folder_name"}`,
  `POST /instructions/deactivate {"folder_name"}` → `{deactivated, scope}`). The editor's
  "Apply to: This case | All my cases" toggle picks the scope on save.
- Memory files are scoped the same way (NULL = all cases, folder set = this case only)
  and are retrieved separately via `build_memory_block`. They never replace Instructions.
  Memory is **off by default** and is one switch in profile Settings → Memory.
  Incognito on the composer skips read and write. Files are not generated at toggle
  time. Past chats are looked up as complete sessions.

## Project-scoped memory (hard isolation)

A **project** is a case. The UI calls it a Project, `cases` is its table, and inside this
service it is addressed by `folder_name` — the key the chat route already carries. A
project memory file is a `personalization_memory_topics` row with `folder_name` set;
rows where `folder_name IS NULL` are the user's cross-case memory and are not project
rows. There is no separate `project_memory_files` table.

| Concept | Column |
|---|---|
| `project_id` | `folder_name` (never NULL for a project row) |
| `slug` | `topic_key` |
| `description` | `description` |
| `content` | `content` |
| `version` | `version` (bumped on every write; migration `173`) |

### The boundary

Four functions in `memory_service.py` make up the project store:

```
list_project_memory(user_id, project_id)                      -> [{slug, description, ...}]
read_project_memory(user_id, project_id, slug)                -> row | None
write_project_memory(user_id, project_id, slug, description, content, *, expected_version=None)
delete_project_memory(user_id, project_id, slug)              -> bool
```

Every statement they issue carries `WHERE user_id = %s AND folder_name = %s`, so one
project can never read or write another's rows. The filter is in SQL, not in the prompt
layer. `_require_project` raises on a blank project rather than letting it widen into
`folder_name IS NULL`, which is the global store. `_resolve_path_scope` closes the same
hole on the path-addressed routes: while you are in project B, a path spelling
`/cases/<project A>/...` is refused instead of resolving.

`tests/test_project_memory_isolation.py` asserts both the behaviour (a fact written to
project A is invisible to project B through listing, read and delete) and the structure
(no project statement is missing the filter). Run it with:

```
cd Backend/agentic-document-service
PYTHONPATH=. .venv/Scripts/python.exe -m unittest tests.test_project_memory_isolation -v
```

### READ_MEMORY round-trip (two Gemini calls, project chats only)

1. `build_memory_block_with_directive` runs the existing deterministic retrieval, then
   puts the project listing (`- slug: description` per line) in the system prompt.
2. A cheap router call on `PERSONALIZATION_MEMORY_DIRECTIVE_MODEL` sees that listing plus
   the user's message and replies either `READ_MEMORY: <slug>` or `NONE`.
3. On a directive the slug is read through `read_project_memory`, so the hard filter
   applies to whatever the model named, and the file is injected before the answer call.

A chat with no `folder_name` never reaches the router and calls Gemini exactly as it did
before. Any failure (no key, timeout, unknown slug) falls back to the listing-only block.
Files the deterministic pass already injected are skipped so nothing is read twice.

### Write-back after the turn

`schedule_turn_extract` runs on the personalization thread pool once the answer has
streamed and the chat is persisted, so the user never waits on it. Unlike the
prompt-time pass it sees the assistant reply, which is what lets it separate a decision
the user confirmed from a suggestion the assistant merely floated. It saves nothing for
small talk, search results or unconfirmed suggestions.

The prompt-time pass now runs with `explicit_only=True`: "remember this" and "forget
that" still land immediately, and the LLM extraction moved to the post-turn job.

## Behaviour analysis (what the generator "notices")

`/instructions/generate` is one structured Gemini call whose schema puts a
`behaviour_analysis` object BEFORE `instruction_markdown`, so the model reads the
user's behaviour first and derives every rule from it. The analysis covers:

| Aspect | Read from |
|---|---|
| tone | register of the prompts: terse commands, politeness, ALL CAPS/urgency, Hinglish, formal legal phrasing |
| response_shape | tables / points / headings / drafts / "in 3 points" / answer-first |
| depth_and_length | "short", "brief", "in detail", "explain why", per-task variation |
| language | prompt language + requested reply language |
| expertise_level | vocabulary: sections, case names, Latin, procedure vs layman phrasing |
| communication_style | questions vs orders, paste-and-analyse, corrections, follow-ups |
| priorities[] | what the user insists on repeatedly |
| dislikes[] | "don't", "no need", "stop", "again", "why did you" — treated as hard rules |

Each finding carries `confidence` (0.3 once / 0.5 consistent / 0.7+ repeated) and
1-2 verbatim `evidence` fragments; confidence ≥ 0.5 becomes an "Always/Never"
rule, lower becomes "Prefer". The instruction has explicit **Tone** and
**Response shape** sections, written as structured plain text (section titles
and hyphen bullets — no markdown headings or bold). The analysis is returned to the UI ("What we
noticed about you"), sent back on `/instructions/activate` as
`behaviour_analysis`, and stored in `personalization_instructions.behaviour_json`.
The Profile Builder learns the same dimensions cumulatively (profile schema v2
adds `response_expectations`, `communication_style`, `expertise_signals`).

## Behaviour notes

- Preset (secret) prompts log their **label**, never the secret body; custom prompts log the user's own text.
- The builder never stores case facts: the prompt forbids party names, amounts, case numbers; patterns carry ≤ 3 short verbatim examples.
- Numbering is serialised per user with `pg_advisory_xact_lock`, so concurrent prompts cannot share a `prompt_no`.
- Rebuilds are deduplicated per user in-process and self-heal: the catch-up loop processes every uncovered batch, so a missed run is picked up on the next trigger.
- The active block is cached 30 s per user in-process and invalidated on activate/deactivate/delete.
- Learning mode uses its own agent system prompt, so the personal instruction is not applied there; normal, research, deep-research and draft-from-template turns all get it.
- Table names are prefixed `personalization_*` to avoid colliding with the shared DB's `users`/profile tables.
