-- Retain every parser generation so citations from completed model runs remain resolvable.
ALTER TABLE normalized_documents DROP CONSTRAINT normalized_documents_document_id_parser_version_key;
ALTER TABLE normalized_documents ADD COLUMN generation integer;
WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY document_id ORDER BY created_at, id)::integer AS generation
  FROM normalized_documents
)
UPDATE normalized_documents SET generation = numbered.generation FROM numbered WHERE numbered.id = normalized_documents.id;
ALTER TABLE normalized_documents ALTER COLUMN generation SET NOT NULL;
ALTER TABLE normalized_documents ADD CONSTRAINT normalized_documents_generation_key UNIQUE (document_id, generation);
CREATE UNIQUE INDEX normalized_documents_one_active_idx ON normalized_documents(document_id) WHERE status = 'parsed';

ALTER TABLE filing_documents
  ADD COLUMN stage text NOT NULL DEFAULT 'discovered',
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN excluded_at timestamptz,
  ADD COLUMN exclusion_reason text,
  ADD COLUMN retryable boolean NOT NULL DEFAULT true,
  ADD COLUMN page_count integer;
UPDATE filing_documents SET stage = CASE WHEN status = 'downloaded' THEN 'downloaded' ELSE status END;

CREATE TABLE companyfacts_sources (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sec_url text NOT NULL,
  body_path text NOT NULL,
  content_hash text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'complete',
  error_message text,
  UNIQUE (company_id, content_hash)
);

CREATE TABLE financial_facts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_id bigint NOT NULL REFERENCES companyfacts_sources(id) ON DELETE RESTRICT,
  metric text NOT NULL,
  taxonomy text NOT NULL,
  concept text NOT NULL,
  unit text NOT NULL,
  value numeric NOT NULL,
  period_start date,
  period_end date,
  instant_date date,
  fiscal_year integer,
  fiscal_period text,
  form_type text,
  accession_number text,
  frame text,
  conflict_status text NOT NULL DEFAULT 'selected',
  raw_fact jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX financial_facts_company_metric_period_idx ON financial_facts(company_id, metric, period_end DESC, instant_date DESC);

CREATE TABLE embedding_approvals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  profile_key text NOT NULL,
  corpus_fingerprint text NOT NULL,
  document_count integer NOT NULL,
  token_estimate bigint NOT NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, profile_key, corpus_fingerprint)
);

CREATE TABLE model_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  provider text NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL,
  schema_version text NOT NULL,
  evidence_generation_ids jsonb NOT NULL,
  cited_source_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  token_estimate integer NOT NULL,
  raw_output jsonb,
  validation_status text NOT NULL,
  error_message text,
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
