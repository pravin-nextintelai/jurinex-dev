# Citation Service — Documentation

> Give it a case (a petition or brief). It finds real Indian court judgments you can
> cite, sorted into **use these**, **the other side will use these**, and **be careful
> with these** — each with a short "how to use this judgment" note.

---

## At a glance

| | |
| --- | --- |
| What it is | A backend service that turns an uploaded case into a list of relevant citations |
| Language / runtime | Python 3.12 · FastAPI |
| The "brain" | Google **Gemini** (`gemini-3.5-flash` for text, `gemini-embedding-001` for matching) |
| The "library" | **Indian Kanoon** REST API (the source of every judgment) |
| Storage | **PostgreSQL** (runs, reports, cost, cached judgments) |
| Pipeline version | **V2** |
| Accuracy today | ~80–83% relevant on real petitions |

---

## What it does

Think of it as a **research assistant on an assembly line**. The case goes in one
end; a finished, sorted citation report comes out the other. In between, the work
passes through ~16 small steps. The service itself sits in the middle and leans on
three outside helpers — a judgment library, an AI brain, and a database.

```text
   ┌────────────────────────┐
   │     React frontend     │
   └────────────────────────┘
              │  start a run / poll for the report
              ▼
   ┌──────────────────────────────────────┐
   │ CITATION SERVICE  (this repo)        │
   │                                      │   ──►  Indian Kanoon API   (search + fetch judgments)
   │ reads the case with AI,              │
   │ searches the judgment library,       │   ──►  Gemini AI           (read case / judge / memos)
   │ and returns a sorted report          │
   │                                      │   ──►  PostgreSQL          (save run / report / cost)
   └──────────────────────────────────────┘
              │  citation report
              ▼
   Recommended   ·   Adverse   ·   Caution
```

*The service reads the case with AI, searches the library, and returns a sorted report.*

---

## Step by step (what happens first, second, …)

Top to bottom is the exact order. The box is the step; the text on the right is what
it does, in plain words.

```text
    Lawyer uploads a case
            │
            ▼
  ┌────────────────────────────────┐
  │ 1. Understand the case         │   fix petitioner vs respondent;
  │   read the uploaded text       │   pull relief, statutes, key facts
  └────────────────────────────────┘
            │
            ▼
  ┌────────────────────────────────┐
  │ 2. Find the legal issues       │   list issues + real search phrases,
  │   Gemini reads the case        │   doctrines, landmark case names
  └────────────────────────────────┘
            │
            ▼
  ┌────────────────────────────────┐
  │ 3. Plan the searches           │   real judgment words (not labels),
  │   build query strings          │   3+ terms, ranked by importance
  └────────────────────────────────┘
            │
            ▼
  ┌────────────────────────────────┐
  │ 4. Search Indian Kanoon        │   top queries always run;
  │   run the queries              │   low-priority skipped if over budget
  └────────────────────────────────┘
            │
            ▼
  ┌────────────────────────────────┐
  │ 5. Filter for free             │   drop the obvious misses;
  │   dedupe + court/age checks    │   remove your own uploaded doc
  └────────────────────────────────┘
            │
            ▼
  ┌────────────────────────────────┐
  │ 6. Read the survivors          │   only the top ~7 cost money to read
  │   excerpt, then full text      │
  └────────────────────────────────┘
            │
            ▼
  ┌────────────────────────────────┐
  │ 7. Judge each one              │   a dismissed petition is ADVERSE,
  │   who won + AI label           │   even if the wording sounded helpful
  └────────────────────────────────┘
            │
            ▼
  ┌────────────────────────────────┐
  │ 8. Sort, clean & explain       │   relevance gate: drop off-topic,
  │   3 buckets, best first        │   move adverse into the Adverse bucket
  └────────────────────────────────┘
            │
            ▼
    Report:  Recommended  ·  Adverse  ·  Caution
```

*Each of these 8 phases is several code "stations" — the full 16-station breakdown is
in [data-flow.md](data-flow.md).*

---

## Why it's built this way (the one idea to remember)

The pipeline is a **funnel that trades a little money for a lot of precision**. It
starts cheap and wide (free text checks on ~80 candidates), then spends money only on
the few that survive (full judgment text, AI judging). The goal is **relevance** — a
wrong citation is useless no matter how cheap, so the engine would rather return 4
on-point cases than 10 noisy ones.

---

## The output

Every run produces one report with three buckets:

| Bucket | Means | For the lawyer |
| --- | --- | --- |
| ⭐ Recommended | Judgments that support your side | Cite these |
| ⚠️ Adverse | Judgments the other side will cite | Prepare to distinguish these |
| 🤔 Use with caution | Borderline / partly relevant | Use carefully; check the fit |

Each citation also carries a one-line verdict and a ~500-word "how to use this
judgment" note.

---

## Where to read next

1. **[architecture.md](architecture.md)** — how the code is organized (the layers),
   what talks to what, and the key design decisions. Start here for the mental model.
2. **[data-flow.md](data-flow.md)** — the full journey of one request, station by
   station, with diagrams.
3. **[code-map.md](code-map.md)** — "where does X live?" From a concept (e.g. *rerank*)
   to the exact file and where it sits in the architecture.

Older reference docs in this folder: [CITATION_PIPELINE_V2.md](CITATION_PIPELINE_V2.md),
[CITATION_PROMPTS_REFERENCE.md](CITATION_PROMPTS_REFERENCE.md),
[COMPLETE_PROCESS_PRICING.md](COMPLETE_PROCESS_PRICING.md).
