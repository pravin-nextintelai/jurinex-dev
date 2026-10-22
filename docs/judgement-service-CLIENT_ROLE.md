# Client Role — Auto / Petitioner / Respondent

*judgement-service — how the "Acting for" selector shapes research and why
only one side's judgments surface. Implemented 2026-08-19.*

## The selector

On step 1 (Research options), the **Acting for** card offers three choices:

| Choice | Meaning |
|---|---|
| **Auto** (default) | the system infers the client's side from the case papers — behaviour identical to before this feature existed |
| **Petitioner** | the client seeks the relief — every stage works FOR the petitioner/applicant |
| **Respondent** | the client opposes it — every stage works FOR the respondent/opposite party |

The chosen role is sent with every analyze request (`role` field on all four
analyze endpoints) and stored on the session's case context
(`CaseContext.client_role`), so re-runs, custom issues, and reopened
sessions all remember it.

---

## Auto mode — how the side is inferred

With no locked role, the extraction stage reads the case papers and decides
per item:

- The issue spotter / grounds extractor identifies who the client is (the
  "ACTING FOR" line you see in the context banner) from the filing itself —
  a quashing petition's client is the applicant, a State reply's client is
  the respondent.
- Every ground/issue gets its own `perspective` (petitioner / respondent /
  neutral) inferred from what THAT question is for.
- Both sides of authority surface: supporting judgments ranked first,
  genuinely adverse ones still shown, labeled **CONTRA — be ready**, with a
  one-line distinction for the hearing (`contra_handling`).

Auto is for when the papers speak for themselves. Locking a role is for
when you want the system to take your side unconditionally.

---

## Locked role — the five stages it flows through

### 1. Extraction framing
Every extraction prompt (grounds, issue spotting, fresh-matter — Claude and
Gemini paths alike) receives a locked-role instruction:

> CLIENT ROLE (locked by the user — overrides anything the material
> suggests): the client is the RESPONDENT. Frame EVERY ground and issue
> from the respondent's side — the questions the respondent needs authority
> on, seeking outcomes that favour the respondent and defeat the petitioner
> — and set perspective='respondent' on every item.

So the very questions researched are the ones your side needs answered.

### 2. Deterministic perspective override
Prompt compliance is never trusted for a locked role: after extraction,
`apply_client_role` **forces** `perspective` to the chosen role on every
item — and it is applied again at run time in `search_run`, which also
covers custom-typed issues and sessions analysed before the role existed.

### 3. Query generation
Query prompts receive the locked role explicitly:

> CLIENT ROLE (locked by the user): the client is the respondent — every
> anchor query MUST chase outcomes that favour the respondent.

For a respondent in a quashing matter that means queries built around
*"quashing refused"*, *"petition dismissed"*, *"no ground to interfere"* —
the petitioner gets the mirror image.

### 4. Verification decides the side — from the judgment's REAL outcome
This is the core guarantee. Which side a judgment serves is **never**
decided by which query found it or what its headnote claims. The verifier
reads the full text, extracts the operative outcome as a **verbatim quote**
(machine-checked as an exact substring of the judgment), and the side is
derived deterministically from `outcome × perspective`:

| Verified outcome | Petitioner sees | Respondent sees |
|---|---|---|
| Relief granted (e.g. FIR quashed) | **SUPPORT** | contra |
| Relief refused / petition dismissed | contra | **SUPPORT** |
| Interim order only | interim | interim |

The respondent row is the inversion that makes role-locking meaningful: a
judgment *refusing* quashing is precisely what a respondent cites.

### 5. Surfacing filter — only your side shows
With a role locked, `_issue_round` drops every `contra` result before
anything is capped or displayed:

- **Shown**: judgments whose verified outcome serves your side, plus
  neutral/interim orders.
- **Dropped**: adverse authority — not demoted, not labeled: excluded.

In Auto mode this filter is off and contra surfaces labeled, as before.

---

## What it looks like

- Cards carry **SUPPORTS YOUR CASE** side badges; with a locked role there
  are no CONTRA cards at all.
- The "Acting for" card's sub-label states the active behaviour: *"Only
  judgments favouring the respondent will be surfaced."*
- Adversarial prep on each card (opponent's strongest objection + your
  counter) is still generated — knowing the other side's argument is part
  of serving yours.

## Interactions worth knowing

- **Custom issues** typed at run time inherit the locked role (perspective
  forced at run).
- **Legacy sessions** (analysed before the feature): role is `None` →
  exact old behaviour.
- **The library-first fetch** is orthogonal: role shapes *which* queries
  are generated and *which* verified judgments surface; the library/IK
  routing only decides where candidates come from.
- **Honest-empty rule**: dropping contra can leave an issue with fewer or
  zero results — the system never pads with the other side's judgments.

## Reference

| Piece | Where |
|---|---|
| `role` request field | all four analyze endpoints, `schemas.py` |
| `CaseContext.client_role` | carried in the session; read by every stage |
| `_role_note` (extraction prompt addendum) | `agents.py` |
| `apply_client_role` (deterministic override) | `agents.py`; also called in `api.search_run` |
| Query-gen role line | `generate_queries` (Claude + Gemini paths) |
| Outcome→side inversion | `tools.side_for_verified_outcome` (pre-existing) |
| Contra filter | `agents._issue_round` (`if context.client_role: … side != "contra"`) |
| UI selector | `CitationResearchPanel.jsx` — Research options → "Acting for" |
