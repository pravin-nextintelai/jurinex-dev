# Draft_DB seeds

## 003_template_fields_seed.sql

Seeds **template_fields** so that when a user opens a specific template, the draft form shows the correct fields for that template.

**Requirement:** Templates must already exist in `templates` with these **exact** `template_name` values:

| Category | template_name |
|----------|----------------|
| REAL ESTATE | Rent Agreement, Sale Deed, Lease Deed |
| CORPORATE & BUSINESS | NDA, MoU, Partnership Deed |
| LITIGATION | Civil Petition, Affidavit, Vakalatnama |
| FAMILY LAW | Divorce Petition, Child Custody |
| CRIMINAL LAW | Bail Application, FIR Draft |
| EMPLOYMENT & HR | Employment Contract, Termination Letter |
| INTELLECTUAL PROPERTY | Trademark Application, Copyright |
| GENERAL LEGAL | Power of Attorney, Indemnity Bond |

**How to run:**

```bash
# Set DRAFT_DATABASE_URL, then:
psql "$DRAFT_DATABASE_URL" -f db/seeds/003_template_fields_seed.sql
```

Or from the agent-draft-service root:

```bash
psql $DRAFT_DATABASE_URL -f db/seeds/003_template_fields_seed.sql
```

Rows are inserted only for templates that exist; `ON CONFLICT (template_id, field_name) DO NOTHING` makes the script safe to re-run.

**To create templates first** (if needed), insert into `templates` with `template_id` (UUID), `template_name`, `category`, `status` = 'active', etc., then run this seed.
