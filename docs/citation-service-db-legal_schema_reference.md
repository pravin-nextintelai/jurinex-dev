# Legal schema reference (PostgreSQL)

The citation service expects these tables to exist. The code is aligned to the following schema.

## judgments
- `judgment_uuid` UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `canonical_id` VARCHAR(200) UNIQUE NOT NULL
- `case_name` TEXT NOT NULL
- `court_code` VARCHAR(20) NOT NULL
- `court_tier` VARCHAR(10)
- `judgment_date` DATE, `year` SMALLINT
- `doc_type` VARCHAR(20) DEFAULT 'judgment'
- `outcome` VARCHAR(50), `bench_size` SMALLINT, `bench_type` VARCHAR(20)
- `source_type` VARCHAR(20)
- `verification_status` VARCHAR(20), `confidence_score` DECIMAL(4,3)
- `citation_frequency` INT, `qdrant_vector_id` BIGINT, `neo4j_node_id` BIGINT
- `es_doc_id` VARCHAR(100)
- `ingested_at` TIMESTAMPTZ, `last_verified_at` TIMESTAMPTZ

Source link (Indian Kanoon / Google URL) is stored in **Elasticsearch** (`source_url`, `official_source_url`), not in this table.

## citation_aliases
- `alias_id` UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `judgment_uuid` UUID REFERENCES judgments(judgment_uuid) ON DELETE CASCADE
- `alias_string` VARCHAR(300) NOT NULL
- `reporter_type` VARCHAR(50), `normalized` VARCHAR(300) UNIQUE
- `created_at` TIMESTAMPTZ

## judges
- `judge_id` BIGSERIAL PRIMARY KEY
- `canonical_name` VARCHAR(500) UNIQUE NOT NULL
- `honorific` VARCHAR(50), `name_variants` TEXT[]

## judgment_judges
- `judgment_uuid` UUID REFERENCES judgments(judgment_uuid)
- `judge_id` BIGINT REFERENCES judges(judge_id)
- `role` VARCHAR(50)
- PRIMARY KEY (judgment_uuid, judge_id)

## statutes_cited
- `statute_id` BIGSERIAL PRIMARY KEY
- `judgment_uuid` UUID REFERENCES judgments(judgment_uuid)
- `act_name` VARCHAR(500), `act_short` VARCHAR(100)
- `section` VARCHAR(50), `sub_section` VARCHAR(50)
- `india_code_url` TEXT

Insert uses DEFAULT for `statute_id` (do not pass).
