-- Cooperative runtime arbitration shared by the backend and workers.
CREATE TABLE ai_runtime_state (
  runtime_key text PRIMARY KEY,
  last_model text
);
CREATE TABLE ai_runtime_queue (
  id bigserial PRIMARY KEY,
  runtime_key text NOT NULL REFERENCES ai_runtime_state(runtime_key) ON DELETE CASCADE,
  model text NOT NULL,
  priority integer NOT NULL CHECK (priority IN (0, 1)),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX ai_runtime_queue_runtime_idx ON ai_runtime_queue(runtime_key, id);

-- A deferred attempt may reuse its retry count, but never its fencing token.
ALTER TABLE work_items ADD COLUMN lease_token uuid;
