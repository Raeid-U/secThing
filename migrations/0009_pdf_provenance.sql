ALTER TABLE source_spans
  ADD COLUMN page_start integer CHECK (page_start > 0),
  ADD COLUMN page_end integer CHECK (page_end >= page_start);

ALTER TABLE normalized_documents
  ADD COLUMN page_map jsonb NOT NULL DEFAULT '[]'::jsonb;
