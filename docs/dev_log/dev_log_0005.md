# secThing

## Development Changelog

**Prepared:** 2026-10-05  
**Project:** secThing, a local-first, evidence-first SEC filing research workbench  
**Purpose:** This entry continues `dev_log_0004.md` with the verified Windows/WSL2/NVIDIA local-AI deployment, the source-acquisition and deterministic-provenance backend slices, and the agreed transition to a financial-research frontend.

---

## 1. Continuity

`dev_log_0004.md` ended with durable SEC identity, company profile, and filing-catalogue ingestion. It intentionally did not download filings, parse evidence, index content, or invoke AI against company data.

This increment moves the application from a filing catalogue toward an evidence pipeline. It also verifies the intended local inference deployment on the user’s Windows 11 / Docker Desktop / WSL2 / NVIDIA machine.

## 2. Local Ollama Runtime: Target Host Verified

Ollama remains the only supported first local provider. The application module exposes model discovery, chat, embeddings, runtime inspection, bounded timeouts, and a fixed diagnostic chat while hiding Ollama-specific HTTP behavior from callers. The NVIDIA implementation stays in Compose rather than application modules.

The target host completed the full smoke test:

- The NVIDIA Compose profile started Ollama in WSL2.
- `qwen2.5:3b` and `nomic-embed-text` were pulled into the persistent model volume.
- `GET /api/v1/system/ai/status` reported local mode, Ollama availability, and both configured models available.
- `POST /api/v1/system/ai/verify` returned `verified` with the expected `ready` response from `qwen2.5:3b`.
- The cold verification took roughly 18.2 seconds.
- `ollama ps` reported the loaded chat model at `100% GPU`.
- The frontend displayed runtime/model readiness.

This validates secThing backend -> Docker-network Ollama -> NVIDIA GPU via Docker Desktop/WSL2. It does not yet validate worker embeddings, model-run auditing, or generated filing artifacts; those require chunks and retrieval.

## 3. Optional-AI Configuration Repair

The Windows failure was a configuration issue, not a build failure: Compose supplied unset AI variables as empty strings, and the schema rejected them even when AI mode was disabled. Optional AI strings and the embedding dimension now normalize blank Compose values to `undefined`. This restores base/no-AI compatibility with `.env.example`, while enabled local mode still requires its real provider settings. A regression test covers the issue.

## 4. Durable Filing Source Acquisition

`SecClient` now owns filing acquisition behind a small interface. It receives CIK, accession number, form, and the optional SEC primary-document hint; derives the archive directory; fetches `index.json`; confirms the hinted document or selects the form-matching document; rejects unsafe names; downloads it under a content-hash path in `DATA_DIR/sec/filings/<cik>/<accession>/`; and returns immutable metadata.

Migration `0004_filing_source_acquisition.sql` adds `filing_documents` and `work_items.filing_id`. The worker queues source acquisition per supported filing, records archive-index cache metadata, persists URL/path/content type/hash/size, updates filing state to `source_acquired`, and retains retryable failures as `source_acquisition_failed`. The records UI provides filing-level acquire/retry actions.

The target host exercised this workflow: acquired filings show as source-preserved while others remain metadata-only until requested.

## 5. Deterministic Parsing and Provenance

`FilingParser` is the next deep module. Its interface accepts source path, content type, filing form, and data directory. Its implementation deterministically removes non-content HTML, decodes common entities, preserves readable paragraphs, writes hash-addressed normalized text, detects initial section offsets, and returns warnings. It never calls an LLM.

Initial heading recognition covers major 10-K/10-Q sections and numbered 8-K items. Confidence is intentionally `partial`: SEC documents vary substantially, and this is a transparent first heuristic. If detection fails, the system preserves a full-document `unknown` section rather than discarding evidence.

Migration `0005_deterministic_filing_parsing.sql` adds:

- `normalized_documents`, including parser version, source hash, normalized path/hash/length, status, and warnings;
- `source_spans` using offsets into normalized text;
- `filing_sections` linked to those spans;
- `work_items.document_id` for document-level work.

Successful acquisition queues parsing automatically. The worker persists normalized-document metadata and spans/sections transactionally, updates the filing to `parsed`, reports source and parse progress independently, and skips only when parser version and source-content hash match an existing successful parse. Failures keep raw evidence and use `filing_parse_failed` for bounded retry.

New operational endpoints support this phase before the reader UI exists:

- `POST /api/v1/filings/:filingId/parse` queues a targeted parse for an already preserved source.
- `GET /api/v1/filings/:filingId/parsed` returns parse-validated normalized text, warnings, section offsets, and filing identity.

Company details now include `parse_status` per filing.

## 6. Validation

- `npm run check` passed.
- `npm test` passed with 17 tests.
- `npm run build` passed.
- Base and NVIDIA Compose configuration validation passed.
- Source-acquisition tests cover archive URL construction, index-based primary-document selection, and hash-addressed preservation.
- Parser tests cover HTML normalization, entity decoding, normalized-file persistence, form-aware offsets, plain-text support, and unknown-section fallback.
- Disposable pgvector PostgreSQL smoke databases applied all migrations. They confirmed `filing_documents`, `normalized_documents`, `source_spans`, `filing_sections`, and the `work_items` filing/document correlations before removal.

Source acquisition is observed on the target host. The new parser endpoint should still be explicitly exercised there by queuing one preserved filing and reading its normalized result.

## 7. Current Backend Assessment

There is no backend blocker that should delay the frontend redesign. The evidence backbone now includes durable metadata/catalogue ingestion, immutable raw sources, normalized text, provenance spans/sections, retryable worker stages, and a read endpoint.

Intentionally deferred backend work:

- broader parser corpus and stronger section heuristics;
- section-aware chunking and chunk hashes/profile versions;
- embedding profiles, pgvector persistence, and Ollama embeddings in the worker;
- full-text/vector hybrid retrieval and company-scoped semantic search;
- evidence packages, cited RAG, model-run records, structured extraction, summaries, and dashboards;
- deterministic XBRL facts and attributed secondary-source enrichment.

## 8. Next Direction: Financial Research Frontend

The user requested a frontend interval before chunks and retrieval. Build a financial-research desk rather than a literal Bloomberg clone: dark slate workspace, restrained operational colors, compact filing ledger, explicit overflow behavior, company -> filing -> source hierarchy, and a reader pane consuming the existing parsed endpoint. Avoid generic cards, terminal cosplay, and unsourced AI claims.

After that interface is stable, resume backend work with chunks, embeddings, hybrid retrieval, and source-backed semantic search. Finish with Docker/self-hosting hardening, documentation, and a portfolio-ready demonstration flow.
