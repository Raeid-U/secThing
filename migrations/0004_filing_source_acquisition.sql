CREATE TABLE filing_documents (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  filing_id bigint NOT NULL REFERENCES filings(id) ON DELETE CASCADE,
  document_name text NOT NULL,
  document_type text NOT NULL,
  sec_url text NOT NULL,
  local_path text,
  content_type text,
  content_hash text,
  byte_size bigint,
  status text NOT NULL DEFAULT 'discovered',
  last_error text,
  fetched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (filing_id, document_name)
);

CREATE INDEX filing_documents_filing_status_idx ON filing_documents (filing_id, status);

ALTER TABLE work_items
  ADD COLUMN filing_id bigint REFERENCES filings(id) ON DELETE CASCADE;

CREATE INDEX work_items_filing_idx ON work_items (filing_id) WHERE filing_id IS NOT NULL;
