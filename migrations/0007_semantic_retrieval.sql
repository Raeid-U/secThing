CREATE TABLE embedding_profiles (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_key text NOT NULL UNIQUE,
  provider text NOT NULL,
  model text NOT NULL,
  dimension integer CHECK (dimension > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chunk_embeddings (
  chunk_id bigint NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  profile_id bigint NOT NULL REFERENCES embedding_profiles(id) ON DELETE CASCADE,
  chunk_hash text NOT NULL,
  embedding vector NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chunk_id, profile_id)
);
CREATE INDEX chunk_embeddings_profile_idx ON chunk_embeddings(profile_id);
CREATE INDEX work_items_embedding_idx ON work_items(document_id) WHERE work_type = 'embed_document';

ALTER TABLE companies ADD COLUMN requested_lookback text;
