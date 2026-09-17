# JuriNex Memory and Instructions

How JuriNex remembers, what it sends to the model on every message, what that costs in tokens, and the knobs that control it.

Everything here lives in `Backend/agentic-document-service`, mainly under `app/services/memory/`. Reading and writing memory never blocks or breaks a chat: on any failure the turn goes ahead without it.

---

## In one minute

```text
  WHAT IS REMEMBERED            WHERE IT APPLIES        WHO WRITES IT
  ------------------            ----------------        -------------
  facts about you               all your cases          chat, or you
  standing instructions         all your cases          chat, or you
  case instructions             one case                chat, or you
  case facts                    one case                intake + chat
  chat summary + last turns     one chat                automatic

  ON EVERY MESSAGE
  ----------------
  before the answer:  load the layers above  (2.5s budget, never blocks)
  after  the answer:  read the turn, save what is durable  (12s budget)

  THE THREE RULES THAT KEEP IT SAFE
  ---------------------------------
  1. Case facts never leave their case. The case key is in every query.
  2. Only your own words are stored - never what the assistant said.
  3. Nothing about one matter can reach the "every case" layers:
     dates, case numbers, FIR numbers and party names are refused there.
```

---

## 1. The layers

There are four stored layers plus the conversation itself. They are stacked from the most general to the most specific, and that is also the order they reach the model.

| # | Layer | Holds | Applies to | Written by |
|---|---|---|---|---|
| 1 | **About the advocate** | Facts you state about yourself: practice, clients, how you work, background | Every case | Chat writer, or you in Settings |
| 2 | **Standing instructions** | Rules for how to answer | Every case | You, or saved from chat after repeats |
| 3 | **Case instructions** | Rules for one matter | One case | You, or saved from chat after repeats |
| 4 | **Case memory** | Facts: summary, facts, parties, documents, drafting log, decisions, dates | One case | Case details at intake, plus the chat writer |
| — | **Conversation** | Recent turns in full, older ones as a rolling summary | One chat session | Written after each answer |

```text
WHAT THE MODEL SEES, TOP TO BOTTOM
general first, specific last - where two lines disagree, the later one wins

  +---+------------------------------------------------------+
  | 0 | Platform rules + your professional profile            |
  +---+------------------------------------------------------+
  | 1 | ABOUT YOU  - every case                               |
  +---+------------------------------------------------------+
  | 2 | STANDING INSTRUCTIONS  - every case                   |
  +---+------------------------------------------------------+
  | 3 | CASE INSTRUCTIONS  - this case                        |
  +---+------------------------------------------------------+
  | 4 | CASE MEMORY  - this case                              |
  +---+------------------------------------------------------+
  | 5 | Documents or retrieved passages                       |
  +---+------------------------------------------------------+
  | 6 | Earlier sessions - only if you point back             |
  +---+------------------------------------------------------+
  | 7 | Chat summary + recent turns                           |
  +---+------------------------------------------------------+
  | 8 | YOUR QUESTION                                         |
  +---+------------------------------------------------------+
```

The more specific a layer is, the later it appears, so it wins where two layers disagree. Documents always outrank memory: memory is context, never a source to cite.

**Layer 1 is chosen, not just stored.** What JuriNex knows about you can outgrow what one question can carry, so each question takes the facts that suit it rather than the newest that fit:

```text
   STORED (up to 40 facts)          THIS QUESTION: "Draft the rejoinder"
   ------------------------         ------------------------------------
   Appears at the Aurangabad Bench    score 0.5
   Acts for borrowers, not banks      score 0.5
   Wants the prayer clause last       score 1.9   -->  sent
   Twelve years at the bar            score 0.5

   words in common x2.0  +  what the question is about x1.5  +  recency x0.5
   no model call - term matching, so it costs nothing per turn
```

Which facts a turn carried is counted (`used_count`). A fact that has never been carried is the first to go when room runs out; a fact you typed is never dropped by JuriNex. Near the ceiling the set is merged into fewer, sharper lines instead of stopping at "full" — see §7.

**Two different "summaries".** They are easy to confuse, so:

| | Case memory → **Summary** section | The chat's **running summary** |
|---|---|---|
| Holds | Parties, stage, last action, open items | What this one conversation asked, answered and decided |
| Scope | The case, across every chat | One chat session |
| Written by | Case details at intake, then the chat writer when you state a durable fact | Rewritten after each answer, from the turns that left the recent window |
| Lives in | `case_memory_lines` (section `summary`) | `chat_session_summaries` |
| Lasts | Until you forget it | Goes when the chat goes |
| You can edit it | Yes | No — read only |

The running summary is shown in the Memory panel under the Summary section, for reading. It reaches the model with the conversation, not with the memory layers, so showing it there does not send it twice.

---

## 2. What happens on one message

### 2.1 Before the answer — assembly

`app/services/memory/assembly.py`, time-boxed to **2.5 s** (`MEMORY_CONTEXT_TIMEOUT_S`).

```text
        your message
             |
             v
  +----------------------------+
  | who are you? which case?   |---- no case ----> answer with no memory
  +----------------------------+
             |
             v
  +----------------------------+
  | switches:                  |---- any off ----> answer with no memory
  | firm AND user AND case     |
  +----------------------------+
             |
             v
  +----------------------------+
  | build the memory block     |
  |   1 about you              |
  |   2 standing instructions  |
  |   3 case instructions      |
  |   4 case memory: summary,  |
  |     index, up to 2 sections|
  +----------------------------+
             |
             v
  +----------------------------+   yes   +--------------------------+
  | does the question point    |-------->| search earlier sessions  |
  | back? "as we discussed"    |         | of THIS case only        |
  +----------------------------+         +--------------------------+
             | no                                     |
             +------------------+---------------------+
                                v
                  chat summary + recent turns
                                |
                                v
                          your question
                                |
                                v
                          model answers
```

Which sections load is decided by keywords: "hearing" or "deadline" pulls **dates**, "draft" pulls the **drafting log**, "who is" pulls **parties**. Drafting turns always get the drafting log and decisions. The summary always loads; the rest are listed by name and size only, so the model knows what exists.

### 2.2 After the answer — the writer

`app/services/memory/writer.py`, on its own threads, after the answer has streamed. Budget **12 s** (`MEMORY_WRITER_TIMEOUT_S`).

```text
     answer delivered to the advocate
             |
             v
     top up case memory from the case details
             |
             v
  +----------------------------+     greeting, under 12 characters,
  | worth reading?             |---> saved prompt, learning mode,
  +----------------------------+     deep research  ->  log why, stop
             | yes
             v
     one extraction call   (gemini-2.5-flash, 20s limit)
             |
     +-------+-----------------+----------------------+
     v                         v                      v
  case facts             standing rules        facts about you
     |                         |                      |
     v                         v                      v
  must be in your          counted, never        no case details,
  own words, no ID         saved on the          no party names,
  numbers, no guesses,     first ask             not deleted before
  not already known            |                      |
     +-------------------------+----------------------+
                               v
              write, each under its own version token
                               |
                               v
         one log row for the turn + a note in the chat
```

The extractor sees: your message, the previous answer, the case's memory with line ids, your saved rules, rules it is still counting, the chat summary, earlier requests, and what it already knows about you. It never records anything that appears only in the assistant's answer.

**Marathi and Hindi.** A message in Marathi or Hindi gives memory lines in that language; the extractor does not translate. Every check that compares a line with its source (your message, a cited document, the turns of a review) reads Devanagari as well as English (`app/services/memory/script.py`):

| Check | English | Devanagari |
|---|---|---|
| Numbers | `4144/2011` | `४१४४/२०११` is the same number |
| Names | `Pawar` | `पवार`, and with a Marathi ending `पवारांचा`, compared by consonants |
| Dates | `28/07/2011`, `28 July 2011` | `२८/०७/२०११`, `२८ जुलै २०११`; a date must appear whole |
| Guesses refused | probably, seems | कदाचित, असावा, शायद |
| Rule words | always, from now on, don't, in a table | नेहमी, यापुढे, नको, तक्त्यात |

Nothing is translated, so an English line from a Marathi message is traceable only through its names, numbers and borrowed words. In a Marathi document, English words for what a document is ("Registration", "Village") cannot be looked up; there a fact rests on its numbers and names.

---

## 3. How a rule becomes an instruction

Nothing is saved the first time you ask.

```text
                              1st ask        2nd ask        3rd ask
  ---------------------------------------------------------------------
  You word it as a rule       suggested      SAVED            -
  "always", "from now on"     right away
  ---------------------------------------------------------------------
  You just keep asking        counted,       suggested      SAVED
  no rule words               not shown
  ---------------------------------------------------------------------
  You press Accept            SAVED at once
  ---------------------------------------------------------------------

  Saved where?
     your words cover all cases ("in all my matters")  ->  every case
     the same ask turns up in a second case            ->  offered for
                                                           every case
     otherwise                                         ->  this case
```

- **The wording is tidied before you see it.** What you type in chat is often a half sentence ("at each time give me simple answer to understand with proper"), so a small model rewrites it as one clear directive. You read it, edit it or re-polish it, and only then add it; what gets saved is what you approved, with your original kept in the record. A rule saved automatically is tidied the same way.
- Each message counts once, even if the extractor repeats itself.
- A rule you dismissed, or saved and then deleted, is never saved again.
- A rule is saved **for every case** only when your words say so ("in all my matters"). Ask for the same thing in a second case and it is offered for all cases, never saved silently.
- Thresholds: `MEMORY_RULE_SAVE_AFTER=2`, `MEMORY_RULE_SUGGEST_AFTER=2`, `MEMORY_PATTERN_SAVE_AFTER=3`. Setting the last to `0` means a habit is never saved without you accepting it.

---

## 4. Scope: session, case, everywhere

| Question | Session | Case | Every case |
|---|---|---|---|
| Recent turns and rolling summary | yes | — | — |
| Mute one instruction | yes, for this chat | switch a universal rule off for this case | its own switch |
| Case memory and case instructions | — | yes | — |
| Past-chat recall | searches other sessions **of the same case** | — | never crosses cases |
| Standing instructions | — | — | yes |
| About the advocate | — | — | yes |

**Isolation is structural.** Every case read and write carries the case key in SQL; there is no query that spans cases. Only two things follow the advocate — standing instructions and facts about them — and both refuse case details at write time: dates, case numbers, FIR numbers, "X vs Y", and any party name from any of their cases.

---

## 5. Token usage

### 5.1 How budgets are counted

Budgets are set in **estimated tokens** and converted to characters with a measured ratio of **3.0 characters per token** (`CHARS_PER_TOKEN_ESTIMATE`), measured on English case OCR: 24,000 characters came to 8,081 Gemini tokens. Marathi runs leaner, about 4.35. See `app/services/token_budget.py`.

### 5.2 What memory adds to a prompt

| Block | Default budget | Free-tier Gemma |
|---|---|---|
| About the advocate | 800 | 150 |
| Standing instructions | 2,000 | 270 |
| Case instructions | 3,000 | 400 |
| Case memory summary | 1,500 | 300 |
| Section index | 400 | 85 |
| Each loaded section | 2,500 (max 2) | 335 (max 1) |
| Earlier sessions, on cue only | 3,000 | 400 |
| **Whole memory block** | **10,000 cap** | **1,170 cap** |

Those are **floors, not fixed slices**. A block always gets its budget; above that it may stretch into room the other blocks did not use, up to `MEMORY_BLOCK_STRETCH` (default 3×) times its budget, with the whole-block cap still bounding the lot. So a case with little stored lets what JuriNex knows about you travel further, and a case with a lot leaves it exactly the budget it always had:

```text
ADVOCATE MEMORY: WHAT ONE QUESTION MAY CARRY

  room the case left free   advocate may use
  -----------------------   ----------------
                        0            2,400     <- its budget, always
                    5,000            2,400
                   10,000            3,000
                   20,000            6,000
                   30,000            7,200     <- ceiling, 3x its budget

  Gemma never stretches: its limit is a per-minute rate, not free room.
```

The advocate block is **measured last and printed first**: what goes in is decided once the case has taken what it needs, but the model still reads the layers general-to-specific.

Saved instructions are never cut: if they would not fit, case memory gives up room instead. Within a block the oldest lines drop first.

Typical real usage is **0.5–3K tokens**, well under the cap: the cap is what protects a pathological case, not what a normal turn costs.

Where the tokens actually go on a specific question (each `#` is roughly 1,000 tokens):

```text
  documents / passages   ########################   up to 24,000   <- the bulk
  chat history + summary  ######                     up to  5,700
  memory layers           ###                        0.5 - 3,000   (cap 10,000)
  earlier sessions        ###                        0 or up to 3,000 (on cue)
  your question           #                          usually under 1,000
                          ------------------------------------------------
                          a comprehensive question replaces the first row
                          with the whole case text, which is far larger
```

Read that as: memory is a small slice. What drives the bill is how much of the case goes in.

### 5.3 What the conversation adds

| Part | Budget |
|---|---|
| Latest answer, in full | 3,000 tokens |
| Each older recent turn | 700 tokens |
| Recent turns kept | 3 (`CHAT_HISTORY_RECENT_TURNS`), capped by the plan's `max_conversation_history` — Basic allows 2 |
| Rolling summary of everything before | 1,000 tokens (`CHAT_SUMMARY_MAX_TOKENS`) |
| Turns between the summary and the recent ones | up to 6, answers shortened |

Each turn appears in exactly one of those rows. Folding holds back `CHAT_HISTORY_RECENT_TURNS` turns whatever the plan allows, so a turn the plan still sends in full can never also be inside the summary; a turn between the two windows is sent shortened as the gap.

**Measured on this deployment:** a 22-turn chat that would have sent 8,730 tokens of history now sends **4,718**, of which the summary is 993. The saving grows with the length of the chat.

### 5.4 What documents add — by far the largest part

| Question type | What is sent |
|---|---|
| Comprehensive ("tell me about this case") | The whole case text |
| Specific ("what is the FIR number") | Passages up to **24,000 tokens** (`CHAT_PASSAGE_BUDGET_TOKENS`), about 36 top passages (`CHAT_PASSAGE_TOP_K`, clamped 12–48) |
| Broad question on free-tier Gemma | A smaller focused set, to stay inside the per-minute limit |

**Measured:** raising the passage budget took one FIR question from 30 passages (~5K tokens) to 65 (~9.1K), and a High Court order question from 33 (~1.4K) to 91 (~6.1K).

### 5.5 Extra model calls per turn

| Call | Model | When | Cost |
|---|---|---|---|
| Memory extraction | `gemini-2.5-flash` | Every substantive turn | A few thousand input tokens, at most 4,096 output, 20 s timeout |
| Rolling summary | `gemini-3.8-flash`, thinking low | When a chat has turns older than the recent ones | Input is up to 12 turns with answers capped at 2,500 tokens; output at most 1,000 |
| Polish an instruction | `gemini-3.1-flash-lite` | Only when you press Polish | One sentence |
| Merge facts about you | `gemini-3.8-flash` | Only at 80% of the ceiling, at most once an hour | The stored facts in, a shorter set out; at most 2,048 output |

Choosing which facts a question carries costs **nothing**: it is term matching, no model call and no embedding service, so it adds neither tokens nor latency to a turn.

The background calls all run after the answer, so they add nothing to the wait. **Net effect:** memory adds a bounded amount per turn and removes the need to re-explain the case or re-read long histories, so in a long-running matter total usage falls.

---

## 6. Storage

| Table | Holds | Key |
|---|---|---|
| `advocate_memory_sets` / `advocate_memory_lines` | Facts about the advocate, and what they deleted so it is not learned again | `user_id` |
| `memory_instruction_sets` / `memory_instructions` | Instructions, one per row, universal or per case | `(scope_type, scope_id)` |
| `memory_instruction_overrides` | One item off or on for a case, or muted for a chat | `(instruction_id, type, id)` |
| `case_memory_sections` / `case_memory_lines` | Case facts; the section row carries the version token | `case_key` |
| `memory_settings` | The six switches at firm, user and case level | `(scope_type, scope_id)` |
| `memory_proposals` | Suggestions and the count of how often each rule was asked for | `case_key` |
| `memory_assembly_log` | One row per turn: what was loaded and what was written | `case_key` |
| `chat_session_summaries` | The rolling summary per chat | `(folder, user, session)` |

Migrations `170`–`175` in `db/migrations/`. Most tables are also created on first use; the recall indexes in `171` must be applied by hand.

**Line tags:** `stated` (the advocate said it), `extracted` (a document shows it), `status` (pipeline state). There is deliberately no `inferred` tag — a model conclusion is offered as a suggestion, never stored as a fact.

**Caps**

| Thing | Cap |
|---|---|
| One memory line | 300 characters |
| Summary section | 12 lines / 1,500 characters |
| Any other section | 60 lines |
| One case, all sections | 40,000 characters |
| Case instructions | 40 items, 400 characters each, 4,000 in total |
| Standing instructions | 40 items, 2,000 characters in total |
| About the advocate | 40 facts, 3,000 characters in total |
| Per turn | 8 memory writes, 3 rule suggestions, 3 facts about the advocate |

**Concurrency:** every write carries the version it last read. A stale write is rejected with the current content, so an edit in another window is never silently overwritten; the writer reloads, re-checks and retries once.

---

## 7. Case lifecycle

```text
  intake folder            case created              first chats
  (temp-xxxxxxxx)  ----->  memory moves to  ----->   filled in from case
                           the case id               details, chronology
                                                     and documents
                                                            |
                                                            v
                                                  chat adds facts,
                                                  decisions and rules
                                                            |
                +-------------------------------------------+
                v                                           v
     "Forget everything about                        case deleted
      this case"                                     every row for that
      wipes it and stops the                         case is removed
      automatic refill

     In both cases, what JuriNex knows about YOU is untouched.
```

"Forget everything about this case" also stops automatic refilling, so the case does not quietly repopulate from its details on the next chat. Deleting a case removes its memory, instructions, suggestions and log. Facts about the advocate are untouched.

### 7.1 When "about you" fills up

It never stops at "full". At 80% of the ceiling (`ADVOCATE_CONSOLIDATE_AT`), with at least 4 facts and at most once an hour, the set is rewritten once as fewer, sharper lines:

```text
  Mostly appears before the Aurangabad Bench     \
  Files land acquisition matters at Aurangabad    >--> Appears before the Aurangabad
  Practises mainly in land acquisition           /     Bench, mainly in land acquisition
  Usually acts for borrowers, not banks          ----> Usually acts for borrowers, not banks

  4 facts, 158 chars                                   2 facts, 106 chars
```

Three rules make that safe to do without asking:

| Rule | What it stops |
|---|---|
| Every merged line must be traceable to words already stored | The model inventing a fact you never stated |
| Every merged line faces the rules a typed one faces | A case number, date or party name appearing in an every-case layer |
| The set as it stood is kept | A merge you dislike being permanent — one press puts it back |

If any rule fails, or the model is unavailable, **nothing changes** and you are told the set is full instead. Merging is tried before anything is dropped; only if it cannot help does a fact JuriNex learned but never used make way — never one you typed, and never more than two per turn.

---

## 8. Controls

**Settings → Memory**
- Master switch, plus: search past chats, generate memory from chats, apply case instructions, include sensitive details, **remember me across cases**.
- Firm admins get the same switches for the whole firm. Effective value = firm AND user AND case, so a case can narrow but never widen.
- **What JuriNex knows about you**: add, edit, forget one, or forget everything.
- **Standing instructions**, and rules noticed across your cases waiting to be accepted.

**Inside a case** — the Memory button next to Chronology: facts by section, this case's instructions, suggestions, per-case switches, export and import.

**After each answer** a short note says what was remembered, saved or suggested.

---

## 9. API

Base `/api/memory`, all routes behind a verified token. A case you cannot see returns 404, never an empty result.

| Route | Purpose |
|---|---|
| `GET/POST/PATCH/DELETE /advocate` | What JuriNex knows about you |
| `GET/POST/PATCH/DELETE /instructions` | Instructions, `?scope=user\|case` |
| `PUT /instructions/{id}/override` | Off for one case, or muted for one chat |
| `POST /instructions/polish` | Tidy the wording; saves nothing |
| `GET /cases/{folder}` | Panel overview |
| `GET/POST/DELETE /cases/{folder}/sections/...` | Case facts |
| `GET /cases/{folder}/proposals`, `POST .../accept\|reject` | Suggestions for one case |
| `GET /suggestions`, `POST /suggestions/{id}/accept\|reject` | Cross-case suggestions |
| `GET/PUT /settings?scope=user\|case\|firm` | The switches |
| `GET /cases/{folder}/turns/{chat_id}` | What memory did after one answer |
| `GET /cases/{folder}/chat-summary?session_id=` | One chat's running summary, read only |
| `POST /advocate/consolidate`, `POST .../undo` | Merge overlapping facts about you, and put them back |
| `GET /cases/{folder}/export`, `POST .../import`, `POST .../seed` | Lifecycle |

Conflicts return **409** with the current content; a rejected write returns **422** with the rule it broke.

---

## 10. Settings

All read from `.env`.

| Key | Default | What it does |
|---|---|---|
| `MEMORY_ENABLED` | `true` | Whole feature, deployment-wide |
| `MEMORY_WRITE_ENABLED` | `true` | Learning from chat |
| `MEMORY_EXTRACTION_MODEL` | `gemini-2.5-flash` | The post-turn extractor |
| `MEMORY_POLISH_MODEL` | `gemini-3.1-flash-lite` | Polish |
| `MEMORY_RULE_SAVE_AFTER` | `2` | Requests before a stated rule is saved |
| `MEMORY_RULE_SUGGEST_AFTER` | `2` | Requests before a habit is shown |
| `MEMORY_PATTERN_SAVE_AFTER` | `3` | Requests before a habit is saved; `0` never |
| `MEMORY_CONTEXT_TIMEOUT_S` | `2.5` | Read budget, in the critical path |
| `MEMORY_WRITER_TIMEOUT_S` | `12` | Write budget, after the answer |
| `MEMORY_SUFFIX_TOKENS` | `10000` | Cap on the whole memory block |
| `MEMORY_ADVOCATE_TOKENS` | `800` | About-you budget |
| `MEMORY_SUMMARY_TOKENS` | `1500` | Case summary budget |
| `MEMORY_SECTION_TOKENS` | `2500` | Each loaded section |
| `MEMORY_RECALL_TOKENS` | `3000` | Earlier sessions, on cue |
| `MEMORY_BLOCK_STRETCH` | `3.0` | How far a block may stretch into free room; `1.0` fixes the budgets |
| `ADVOCATE_CONSOLIDATE_ENABLED` | `true` | Merging overlapping facts near the ceiling |
| `ADVOCATE_CONSOLIDATE_AT` | `0.8` | How full before a merge is worth its call |
| `ADVOCATE_CONSOLIDATE_MODEL` | `gemini-3.8-flash` | The merge model |
| `ADVOCATE_CONSOLIDATE_MIN_INTERVAL_S` | `3600` | Quiet time between merges, per advocate |
| `CHARS_PER_TOKEN_ESTIMATE` | `3.0` | Characters per token for budgets |
| `CHAT_PASSAGE_BUDGET_TOKENS` | `24000` | Passages for a specific question |
| `CHAT_PASSAGE_TOP_K` | `36` | Passages retrieved |
| `CHAT_HISTORY_RECENT_TURNS` | `3` | Turns sent in full |
| `CHAT_HISTORY_LATEST_ANSWER_TOKENS` | `3000` | Latest answer |
| `CHAT_HISTORY_OLDER_ANSWER_TOKENS` | `700` | Older recent answers |
| `CHAT_SUMMARY_ENABLED` | `true` | Rolling summary |
| `CHAT_SUMMARY_MODEL` | `gemini-3.8-flash` | Summary model |
| `CHAT_SUMMARY_THINKING_LEVEL` | `low` | Summary thinking |
| `CHAT_SUMMARY_MAX_TOKENS` | `1000` | Summary size |
| `CHAT_SUMMARY_TIMEOUT_S` | `60` | Summary timeout |

---

## 11. When things go wrong

Memory never fails a chat. Each path returns empty and records why.

| Reason in the log | Meaning |
|---|---|
| `no_scope` | The folder has no case, or the user is anonymous |
| `disabled_by_user` | A switch is off at firm, user or case level |
| `mode_learning`, `mode_deep_research` | Those modes run their own pipelines |
| `too_short`, `greeting`, `saved_prompt` | Not worth reading |
| `nothing_durable` | The extractor found nothing to keep |
| `extractor_error` | The extraction call failed; the answer is unaffected |
| `advocate_*` | A fact about the advocate was refused, with the rule appended |

Useful log lines:

```
[Memory] assembled case_key=… advocate=2 universal=v3 instructions=v2 sections=[summary,dates] suffix_chars=…
[Memory] post-turn case_key=… writes=1 instructions_saved=0 advocate=1 proposals=0 skipped=None
```

Every turn also writes a row to `memory_assembly_log`: which versions were loaded, what was written, what was refused. That is the answer to "why did this answer change".

---

## 12. Known limits

- Memory applies to **case chat** only. Quick Chat has no case, so it gets none.
- Facts about the advocate come from what they **say about themselves**. JuriNex does not infer them from behaviour.
- Retrieval is keyword-based for section routing and full-text for past-chat recall; there is no semantic search over memory lines yet.
- Case memory is never used as a citation source, by design. Citations come from documents.
- Of Indian scripts, only Devanagari (Marathi, Hindi) is matched against English. Gujarati, Tamil and other scripts are compared as written.
