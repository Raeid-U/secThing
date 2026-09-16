CREATE TABLE companies (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cik bigint NOT NULL UNIQUE CHECK (cik > 0),
  legal_name text NOT NULL,
  exchange text,
  sic text,
  fiscal_year_end text,
  former_names jsonb NOT NULL DEFAULT '[]'::jsonb,
  identity_source text NOT NULL,
  identity_fetched_at timestamptz NOT NULL,
  earliest_requested_filing_date date,
  latest_requested_filing_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE company_ticker_aliases (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  ticker text NOT NULL,
  exchange text,
  is_current boolean NOT NULL DEFAULT true,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, ticker)
);

CREATE INDEX company_ticker_aliases_ticker_idx ON company_ticker_aliases (ticker);

CREATE TABLE filings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  cik bigint NOT NULL CHECK (cik > 0),
  accession_number text NOT NULL,
  form_type text NOT NULL,
  filing_date date NOT NULL,
  report_date date,
  primary_document text,
  items text,
  is_xbrl boolean,
  is_inline_xbrl boolean,
  is_supported boolean NOT NULL DEFAULT false,
  filing_status text NOT NULL DEFAULT 'discovered',
  discovered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cik, accession_number)
);

CREATE INDEX filings_company_filing_date_idx ON filings (company_id, filing_date DESC);

CREATE TABLE sec_responses (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  url text NOT NULL,
  method text NOT NULL DEFAULT 'GET',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  response_status integer NOT NULL,
  content_type text,
  body_path text,
  content_hash text,
  source_system text NOT NULL DEFAULT 'sec',
  error_message text
);

CREATE INDEX sec_responses_url_fetched_at_idx ON sec_responses (url, fetched_at DESC);
CREATE UNIQUE INDEX sec_responses_url_content_hash_idx ON sec_responses (url, content_hash) WHERE content_hash IS NOT NULL;

CREATE TABLE jobs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_type text NOT NULL,
  company_id bigint REFERENCES companies(id) ON DELETE SET NULL,
  requested_ticker text,
  requested_start_date date,
  status text NOT NULL DEFAULT 'pending',
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE work_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id bigint NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  work_type text NOT NULL,
  company_id bigint REFERENCES companies(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX work_items_claim_idx ON work_items (status, next_run_at) WHERE status = 'pending';
