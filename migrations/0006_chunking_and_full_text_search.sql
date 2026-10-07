CREATE TABLE chunks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  filing_id bigint NOT NULL REFERENCES filings(id) ON DELETE CASCADE,
  document_id bigint NOT NULL REFERENCES filing_documents(id) ON DELETE CASCADE,
  normalized_document_id bigint NOT NULL REFERENCES normalized_documents(id) ON DELETE CASCADE,
  section_id bigint NOT NULL REFERENCES filing_sections(id) ON DELETE CASCADE,
  source_span_id bigint NOT NULL REFERENCES source_spans(id) ON DELETE CASCADE,
  start_offset integer NOT NULL CHECK (start_offset >= 0),
  end_offset integer NOT NULL CHECK (end_offset > start_offset),
  chunk_text text NOT NULL CHECK (length(chunk_text) > 0),
  chunk_hash text NOT NULL,
  token_estimate integer NOT NULL CHECK (token_estimate > 0),
  chunk_profile text NOT NULL,
  chunk_profile_version text NOT NULL,
  normalized_text_hash text NOT NULL,
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', chunk_text)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (normalized_document_id, start_offset, end_offset, chunk_profile_version)
);

CREATE INDEX chunks_company_filing_idx ON chunks (company_id, filing_id);
CREATE INDEX chunks_company_document_idx ON chunks (company_id, document_id);
CREATE INDEX chunks_search_vector_idx ON chunks USING GIN (search_vector);

CREATE INDEX work_items_chunk_document_idx ON work_items (document_id)
  WHERE work_type = 'chunk_document';
