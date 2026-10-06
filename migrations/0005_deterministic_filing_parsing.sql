CREATE TABLE normalized_documents (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id bigint NOT NULL REFERENCES filing_documents(id) ON DELETE CASCADE,
  parser_version text NOT NULL,
  source_content_hash text NOT NULL,
  normalized_text_path text NOT NULL,
  text_hash text NOT NULL,
  text_length integer NOT NULL CHECK (text_length > 0),
  status text NOT NULL,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  parsed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, parser_version)
);

CREATE TABLE source_spans (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  normalized_document_id bigint NOT NULL REFERENCES normalized_documents(id) ON DELETE CASCADE,
  start_offset integer NOT NULL CHECK (start_offset >= 0),
  end_offset integer NOT NULL CHECK (end_offset > start_offset),
  span_text_hash text NOT NULL,
  span_kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX source_spans_document_offsets_idx ON source_spans (normalized_document_id, start_offset, end_offset);

CREATE TABLE filing_sections (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  filing_id bigint NOT NULL REFERENCES filings(id) ON DELETE CASCADE,
  document_id bigint NOT NULL REFERENCES filing_documents(id) ON DELETE CASCADE,
  section_type text NOT NULL,
  section_label text NOT NULL,
  source_span_id bigint NOT NULL REFERENCES source_spans(id) ON DELETE CASCADE,
  confidence_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX filing_sections_filing_idx ON filing_sections (filing_id, document_id);

ALTER TABLE work_items
  ADD COLUMN document_id bigint REFERENCES filing_documents(id) ON DELETE CASCADE;

CREATE INDEX work_items_document_idx ON work_items (document_id) WHERE document_id IS NOT NULL;
