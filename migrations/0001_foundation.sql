CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE system_metadata (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO system_metadata (key, value)
VALUES ('schema_identity', '{"application":"secThing","phase":1}'::jsonb)
ON CONFLICT (key) DO NOTHING;

