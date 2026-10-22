# Agent instructions

All agent instructions live in this folder. **One file per agent.**

| File | Agent | Purpose |
|------|--------|--------|
| `orchestrator.txt` | Orchestrator | Coordinates flow: upload → Ingestion; query → Librarian; optional Drafter, Critic, Assembler |
| `ingestion.txt` | Ingestion | Upload → GCS, Document AI, chunk, embed, store in DB |
| `librarian.txt` | Librarian | Fetch relevant chunks for query (vector search); no content generation |
| `drafter.txt` | Drafter | Draft sections from chunks/context |
| `critic.txt` | Critic | Validate draft (citations, contradictions, legal) |
| `assembler.txt` | Assembler | Assemble final document (page breaks, variables, HTML) |

The API loads instructions with: `instructions/{agent_name}.txt` (e.g. `instructions/librarian.txt`).  
Edit the `.txt` file for an agent to change its system prompt; keep one file per agent.
