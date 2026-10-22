# Integration Guide: Writ Petition Auto-Population System

## Overview

The auto-population system extracts all input fields from a Writ Petition
template and intelligently populates them from a case context dictionary using
a 5-stage pipeline:

| Stage | Method | Description |
|-------|--------|-------------|
| 1 | Multi-key vector search | Exact/fuzzy lookup across all `vector_db_keys` |
| 2 | Semantic search | Word-overlap relevance for `long_text` fields |
| 2.5 | LLM synthesis (Claude) | AI-generated content for narrative fields |
| 3 | Legal inference | Domain rules (writ→article, templates) |
| 4 | Cross-field extraction | Extract from other populated fields |
| 5 | Fallbacks | current_date, auto_generate, leave_blank |

---

## Quick Start (3 Steps)

### 1. Install
```bash
pip install anthropic pypdf python-dotenv
```

### 2. Configure
```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

### 3. Run
```bash
# Full pipeline: extract fields from template + populate from case data
python -m src.main full \
  --template writ_petition_template.pdf \
  --context data/sample_case_context.json \
  --output result.json

# Or skip LLM for faster/cheaper run
python -m src.main populate \
  --schema schema.json \
  --context data/sample_case_context.json \
  --no-llm
```

---

## Programmatic API

### Basic Usage (no LLM)

```python
import json
from src.extraction.field_extractor import FieldExtractor
from src.population.vector_db_interface import VectorDBInterface
from src.population.complete_autopopulator import ComprehensiveAutoPopulator

# 1. Get field schema (use seed or extract from PDF)
extractor = FieldExtractor()
schema_result = extractor.use_seed_fields()
field_schema = [f.to_dict() for f in schema_result.fields]

# 2. Load case context
with open("data/sample_case_context.json") as f:
    case_context = json.load(f)

# 3. Build VectorDB wrapper
vdb = VectorDBInterface(case_context)

# 4. Run population
populator = ComprehensiveAutoPopulator(vdb, field_schema)
results = populator.populate_all_fields()

print(f"Population rate: {results['metrics']['population_rate']:.1%}")
for field_id, data in results["populated_fields"].items():
    print(f"  {field_id}: {data['value'][:60]}")
```

### With LLM Synthesis (recommended for production)

```python
from src.population.llm_autopopulator import LLMAutoPopulator

populator = LLMAutoPopulator(
    vdb,
    field_schema,
    anthropic_api_key="sk-ant-..."   # or set ANTHROPIC_API_KEY env var
)
results = populator.populate_all_fields()
```

### Extract Fields from PDF

```python
from src.extraction.llm_field_extractor import LLMFieldExtractor

extractor = LLMFieldExtractor(api_key="sk-ant-...")
result = extractor.extract_from_pdf("template.pdf", use_llm=True)
extractor.save_schema(result, "schema.json")
print(f"Extracted {len(result.fields)} fields")
```

---

## API Reference

### FieldExtractor

| Method | Returns | Description |
|--------|---------|-------------|
| `extract_from_pdf(path)` | `ExtractionResult` | Pattern-based PDF extraction |
| `extract_from_text(text)` | `ExtractionResult` | Pattern-based text extraction |
| `use_seed_fields()` | `ExtractionResult` | 16 built-in Writ Petition fields |
| `save_schema(result, path)` | `None` | Save schema to JSON |

### LLMFieldExtractor

| Method | Returns | Description |
|--------|---------|-------------|
| `extract_from_pdf(path, use_llm=True)` | `ExtractionResult` | Claude-powered extraction |
| `extract_from_text(text, use_llm=True)` | `ExtractionResult` | Claude extraction |
| `use_seed_fields()` | `ExtractionResult` | Enriched seed fields |

### VectorDBInterface

| Method | Returns | Description |
|--------|---------|-------------|
| `search(key, threshold=0.70)` | `(value, confidence) \| None` | Exact/fuzzy key lookup |
| `semantic_search(queries, top_k=10)` | `List[Dict]` | Word-overlap chunk search |
| `get_all_keys()` | `List[str]` | All indexed keys |
| `get_value(key)` | `str \| None` | Direct key lookup |

### ComprehensiveAutoPopulator / LLMAutoPopulator

| Method | Returns | Description |
|--------|---------|-------------|
| `populate_all_fields()` | `Dict` | Run full pipeline; return results + metrics |

**Result structure:**
```json
{
  "populated_fields": {
    "petitioner_name": {
      "value": "Rajesh Kumar Singh",
      "formatted_value": "Rajesh Kumar Singh",
      "confidence": 1.0,
      "stage": 1,
      "source": "vector_db_search",
      "metadata": {}
    }
  },
  "empty_fields": ["opposite_party_advocate"],
  "metrics": {
    "total_fields": 16,
    "populated_count": 15,
    "empty_count": 1,
    "population_rate": 0.9375,
    "confidence_distribution": {"high": 10, "medium": 4, "low": 1},
    "stage_breakdown": {1: 8, 3: 4, 4: 2, 5: 1}
  }
}
```

### LegalTextFormatter

| Method | Returns | Description |
|--------|---------|-------------|
| `format_numbered_paragraphs(text)` | `str` | Facts section format |
| `format_lettered_list(text)` | `str` | (a), (b), (c)... |
| `format_roman_numerals(text)` | `str` | (i), (ii), (iii)... |
| `format(text, style)` | `str` | Dispatch by style string |

---

## Integration Patterns

### FastAPI Endpoint

```python
from fastapi import FastAPI
from pydantic import BaseModel
from typing import Dict, Any
import json

app = FastAPI()

class PopulateRequest(BaseModel):
    case_context: Dict[str, Any]
    use_llm: bool = True

@app.post("/api/auto-populate")
async def auto_populate(req: PopulateRequest):
    from src.extraction.field_extractor import FieldExtractor
    from src.population.vector_db_interface import VectorDBInterface
    from src.population.llm_autopopulator import LLMAutoPopulator

    extractor = FieldExtractor()
    field_schema = [f.to_dict() for f in extractor.use_seed_fields().fields]

    vdb = VectorDBInterface(req.case_context)
    populator = LLMAutoPopulator(vdb, field_schema)
    return populator.populate_all_fields()
```

### Celery Background Task

```python
from celery import Celery
import json

celery_app = Celery("tasks", broker="redis://localhost:6379")

@celery_app.task
def populate_petition_task(case_context: dict, schema_path: str) -> dict:
    from src.population.vector_db_interface import VectorDBInterface
    from src.population.llm_autopopulator import LLMAutoPopulator

    with open(schema_path) as f:
        schema_data = json.load(f)

    vdb = VectorDBInterface(case_context)
    populator = LLMAutoPopulator(vdb, schema_data["fields"])
    return populator.populate_all_fields()

# Call it:
# result = populate_petition_task.delay(case_context, "schema.json")
```

### AWS Lambda Handler

```python
import json, os

def lambda_handler(event, context):
    from src.extraction.field_extractor import FieldExtractor
    from src.population.vector_db_interface import VectorDBInterface
    from src.population.llm_autopopulator import LLMAutoPopulator

    case_context = event.get("case_context", {})
    extractor = FieldExtractor()
    field_schema = [f.to_dict() for f in extractor.use_seed_fields().fields]

    vdb = VectorDBInterface(case_context)
    populator = LLMAutoPopulator(
        vdb, field_schema,
        anthropic_api_key=os.environ["ANTHROPIC_API_KEY"]
    )
    results = populator.populate_all_fields()
    return {"statusCode": 200, "body": json.dumps(results)}
```

---

## Case Context Format

The `case_context` JSON should have multiple aliases for the same data to
maximise search hit rate:

```json
{
  "petitioner_name": "Rajesh Kumar Singh",
  "petitioner": "Rajesh Kumar Singh",
  "applicant_name": "Rajesh Kumar Singh",

  "case_facts": "Long narrative text...",
  "factual_background": "Alternative key for same facts...",
  "background": "Another alias...",

  "writ_type": "MANDAMUS",
  "constitutional_article": "32",

  "filing_date": "15.03.2024",
  "date_of_filing": "15.03.2024"
}
```

See `data/sample_case_context.json` for a complete example with all 16 fields.

---

## Error Handling

| Error | Cause | Solution |
|-------|-------|---------|
| `ImportError: anthropic` | Package missing | `pip install anthropic` |
| `ANTHROPIC_API_KEY not set` | Env var missing | `export ANTHROPIC_API_KEY=...` |
| Schema file not found | Wrong path | Check `--schema` argument |
| `population_rate < 0.70` | Sparse context | Add more aliased keys to context |
| LLM timeout | API latency | Use `--no-llm` or implement retry |
| `pypdf` not installed | Missing dep | `pip install pypdf` for PDF extraction |

---

## Performance Tuning

| Scenario | Recommendation |
|----------|---------------|
| Simple forms (< 10 fields) | Use `ComprehensiveAutoPopulator` (no LLM) |
| Rich narrative fields | Use `LLMAutoPopulator` |
| Batch processing | Build `VectorDBInterface` once, reuse |
| Cost-sensitive | `--no-llm` flag; LLM only for long_text |
| High volume | Implement Redis cache for LLM responses |
| Offline use | Pattern extractor + seed fields (no API) |

---

## Cost Estimation

| Operation | Approx. tokens | Approx. cost |
|-----------|----------------|--------------|
| Field extraction (LLM, 1 template) | ~3,000 | ~$0.015 |
| Per long-text field synthesis | ~1,500 | ~$0.008 |
| Full Writ Petition (5 LLM fields) | ~10,000 | ~$0.05 |
| Basic population (no LLM) | 0 | Free |

*Costs based on Claude Sonnet pricing. Use `--no-llm` to eliminate API costs entirely.*

---

## Running Tests

```bash
cd Backend/agent-draft-service

# All tests
pytest tests/ -v

# Specific module
pytest tests/test_autopopulator.py -v

# With coverage
pytest tests/ --cov=src --cov-report=term-missing
```

Expected results: **≥85% population rate** with `data/sample_case_context.json`.
