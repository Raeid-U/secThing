# secThing — Development Log 6, Part 2

**Prepared:** 2026-10-14  
**Scope:** Evidence lifecycle repairs, research workspace overhaul, guided intake, semantic retrieval, and Compose startup/model provisioning.  
**Previous checkpoint:** [Development log 6](dev_log_0006.md), published 2026-10-07. That published record remains intact; this continuation preserves the user's requested log number.  
**Repository checkpoint:** Work through `04e2ae6` is user-committed. This publication changes documentation only and does not create a Git commit.

## 1. Product direction and continuity

The previous checkpoint established preserved SEC sources, normalized HTML/text, provenance, an initial filing browser, and a validated local Ollama deployment. Subsequent work established chunking/full-text retrieval, repaired evidence replacement, and replaced the growing ledger interface with a research workspace.

The user's direction was specific: company intake belongs in a guided modal; opening a source must display it immediately; the research frame stays fixed while individual lists and document panes scroll. A paired original/extracted reader should make the actual evidence available to semantic retrieval and eventual RAG inspectable. The user has now reviewed the new UI positively and requested this publication plus an assessment of the next work.

Authoritative requirements remain [BRD/PRD](../BRD-PRD.md) and [FRD](../FRD.md). `docs/plan.md` is superseded. Preserve evidence before generation, deterministic extraction before model inference, local-first operation, company-scoped retrieval, and useful partial progress. This increment deliberately stops before generated summaries, financial facts, chat, and dashboards.

## 2. Evidence lifecycle and full-text foundation

`packages/platform/src/evidence-pipeline.ts` now owns reusable parse/chunk persistence and deterministic backfill, rather than leaving those policies embedded in worker handlers.

Reparsing an already indexed document previously failed because chunks referenced sections/spans through non-cascading foreign keys. Replacement now locks the document, validates source identity, deletes dependent chunks before sections/spans, supersedes old normalized records, persists the current parse, and queues chunking within one transaction. A persistence failure rolls back the replacement instead of leaving partially deleted evidence.

Chunk writes use the same document lock, require the current source/parser/normalized generation, verify normalized-file integrity, and atomically replace chunks/spans and processing status. Sections must belong to the current normalized version. Retrieval excludes stale source, parser, text, and chunk-profile generations.

Backfill is idempotent, checks current identities, skips active parse/chunk work, and avoids duplicate company jobs. Company reindexing is exposed through `POST /api/v1/companies/:companyId/search/reindex`; per-filing chunking uses the shared policy. Pipeline status remains running while work is pending even when another filing has failed, then reports partial success after work drains.

Important migrations in this reporting period are `0006_chunking_and_full_text_search.sql` and `0007_semantic_retrieval.sql`. Real PostgreSQL integration tests were added for replacement, rollback, backfill, and stale-evidence behavior.

## 3. Fixed-frame research workspace

The `/records` route now renders a dedicated workspace instead of a header, introduction, expanding ledger, and appended reader. The bounded layout applies to research; the home page retains its normal scrolling.

The workspace includes a collapsible company library, company coverage controls, search and filters, year-grouped filings, and search passages grouped by filing. Selecting a document or result opens the reader immediately in the central work area and collapses the company rail to provide reading space. Lists and reader panes scroll independently.

Important frontend seams under `apps/frontend/app/`:

| File | Responsibility |
| --- | --- |
| `records/page.tsx` | Workspace route entry |
| `company-workbench.tsx` | Company controls, library, search, filters, results |
| `research/use-workspace.ts` | Request cancellation, polling, URL/history state |
| `research/add-company.tsx` | Guided native-dialog intake |
| `research/document-reader.tsx` | Original/extracted comparison and evidence inspection |
| `research/types.ts` | Frontend contracts and request helpers |
| `research/workspace.css` | Bounded layout, reading surfaces, responsive behavior |

Company, filing/document, query, search mode, metadata filters, text hash, and passage offsets are URL-backed. Back/forward restores selection. Keeping the results list mounted preserves its scroll position during inspection. Polling refreshes coverage without clearing the reader; obsolete requests are aborted. Explicitly repeating the same query refetches results after indexing changes.

The visual direction uses compact dark navigation, light reading surfaces, restrained blue selection, system UI fonts, and Georgia for extracted text. It introduces no remote fonts or generated artwork.

## 4. Guided company intake

The modal proceeds through ticker lookup and identity confirmation, research-window selection, then review and start. Options include 3/5/10/20/50 years, all available, or a custom start date. Existing companies can be opened, expanded to older history, or explicitly refreshed. Background work continues after the modal closes.

`POST /api/v1/companies/resolve` returns an existing local identity immediately or queues an official `resolve_company_preview` lookup through the SEC worker. Preview completion stores the resolved identity without creating the company or starting acquisition. Cancelling the modal therefore does not add an issuer. Confirmation checks a recent completed official preview, valid for 24 hours, before creating a new issuer; mismatched identity is rejected. The older unconfirmed intake API path remains available.

Company creation accepts `confirmedCik`, `lookback`, and `refresh`. The requested coverage policy is stored in `companies.requested_lookback`. All-available starts at 1900-01-01 to include the available historical catalogue; requested coverage does not imply every historical filing is available or processed.

Native-dialog focus restoration was corrected for React Strict Mode effect replay. Escape closes the dialog and focus returns to its trigger after closure.

## 5. Inspectable original and extracted evidence

Desktop comparison places original source on the left and normalized extraction on the right, with independently scrolling panes and a pointer/keyboard-resizable divider. Controls include original/extracted/compare views, section navigation, text sizing, previous/next passage, and an evidence drawer containing actual indexed text and provenance. Mobile uses pane tabs and hides the list while reading.

Extracted rendering uses exact section boundaries, preserves text before the first detected heading, and highlights retrieved offsets. Reader provenance includes source URL/hash, parser version, normalized identity/hash, and passage ranges.

`GET /api/v1/documents/:documentId/source?contentHash=...` resolves storage paths from the database, verifies raw-source identity, and serves a sanitized HTML viewing copy using `sanitize-html`. CSP and iframe sandboxing restrict execution; scripts, forms, remote assets, and navigable links are removed. Stored original bytes are preserved. Plain text is also supported.

The parsed-document API validates the selected document/text hash, current parser/source generation, and normalized-file integrity under a consistent document lock. Stale references receive a conflict response instead of displaying unrelated evidence.

This is an HTML/text source viewer. Binary PDF ingestion/extraction, original asset reconstruction, precise DOM/page alignment, and synchronized source/extraction scrolling remain unimplemented. Reader scroll positions do not persist across full reloads, although source/hit selection is URL-backed.

## 6. Semantic and hybrid retrieval

`packages/platform/src/retrieval.ts` owns semantic status, queueing, embedding, and search. Migration 0007 introduces embedding profiles and chunk embeddings tied to chunk/profile/content identity, plus embedding work indexes and requested lookback storage.

An embedding profile includes provider, endpoint, configured model, dimension, input version, and chunk-profile version. Configured dimensions are enforced; otherwise the first valid response establishes the dimension transactionally. Invalid vector counts, nonfinite values, zero vectors, and dimension mismatches are rejected. Separate profiles cannot silently mix embeddings.

The worker queues `embed_document` work at startup, after chunking, and through bounded idle scans. Batches of 16 are inferred outside the database transaction, then written only after locking and revalidating the evidence generation. In-flight inference cannot restore embeddings for retired evidence. Completed batches survive retries and are skipped on resume.

Embedding work uses three-attempt retries. Terminal failures are not automatically queued forever for the same generation; Update index explicitly retries them. Coverage counts use the latest work for current normalized evidence so an old failed attempt does not remain counted after success.

Company search supports:

| UI mode | Retrieval behavior |
| --- | --- |
| Keyword | PostgreSQL full-text retrieval; no AI call |
| Meaning | Exact cosine vector retrieval; explicit runtime failure |
| Combined | Reciprocal-rank fusion; explicit keyword fallback when semantic retrieval is unavailable |

Queries support company scope, form, section, date, and result limits. Results include chunk text, scores, current evidence identity/hash, offsets, and filing metadata. React renders snippets as escaped text, promoting only the supported highlight markers.

Embedding configuration works independently of chat configuration and can use a separate endpoint. External mode remains rejected under `LOCAL_ONLY=true`. Coverage distinguishes configured capability from runtime readiness and ready/pending/failed evidence.

Replacing model weights behind an unchanged tag is not detected automatically. Use a distinct model tag when changing weights until digest-aware invalidation exists. Approximate vector indexing and reranking remain deferred pending corpus and latency measurements.

## 7. Docker dependency repair and automatic model provisioning

The reported backend `ERR_MODULE_NOT_FOUND: sanitize-html` came from a persistent `node-modules` volume that predated the new dependency. The previous frontend-only install could not repair it before backend startup because frontend waited for backend health. Rebuilding an image does not replace the mounted dependency volume.

Compose now has a one-shot `dependencies` service running `npm ci --no-audit --no-fund`. Backend, worker, and frontend wait for successful completion. The frontend's separate install/cache-deletion startup command was removed. The Dockerfile also uses the lockfile and `npm ci`, and build context excludes frontend caches and browser artifacts.

For CPU/NVIDIA profiles, `ollama-models` waits for daemon health and runs `scripts/pull-ollama-models.sh` using the configured chat and embedding model names. It skips blank, duplicate, and cached models, pulls missing models into the daemon's persistent `ollama-data` volume, and fails clearly on download errors. Provisioning applies only to local Ollama at the bundled endpoint; separately hosted runtimes are not provisioned.

The worker optionally waits for provisioning to finish, preventing inference retries from being exhausted during initial downloads. Backend/UI can start while models download. Base AI-free Compose remains valid without Ollama services. Shell files use LF through `.gitattributes` and the bootstrap script is invoked with `sh` for Windows/WSL checkout compatibility. README and `.env.example` describe the startup behavior.

The PostgreSQL `schema_migrations already exists, skipping` notice is normal idempotent migration output. It was unrelated to the missing package; resetting database or model volumes is unnecessary.

## 8. Validation record and limits

The accumulated implementation record reports:

- A combined implementation rerun passed **42 unit/integration tests**, **3 browser tests**, workspace type checks, and production build.
- PostgreSQL integration tests applied migrations through 0007 against disposable pgvector PostgreSQL 16 with isolated schemas. Coverage includes keyword filters, replacement rollback, stale evidence, semantic ordering, hybrid fusion, vector validation, profile isolation, in-flight invalidation, retry/backfill, reader hashes, sanitized sources, and issuer confirmation/refresh.
- Browser tests used fixture APIs and isolated Chromium. They covered desktop/mobile bounded scrolling, source inspection, passage highlights, history, guided intake, Escape/focus restoration, pane switching, and repeating the same query. Screenshots were visually inspected.
- The later Docker follow-up passed **six targeted provisioning tests** using a fake Ollama CLI, shell syntax checks, and base/CPU/NVIDIA Compose configuration checks. This is separate from the earlier 42-test run, not a claimed combined 48-test rerun.
- A separate real Compose smoke project deliberately seeded a stale dependency volume without `sanitize-html`. Initialization repaired it; backend import and HTTP readiness succeeded with healthy PostgreSQL, migrations, and data storage. Temporary smoke resources were removed.

Workspace dependency installation encountered EACCES, so implementation verification used an isolated, lockfile-installed source copy. Browser setup required an isolated container and an accessible official Chrome storage endpoint. Local Next development origins were added to resolve blocked localhost hydration; production origin policy was not broadened.

No live SEC crawl or real Ollama/GPU semantic retrieval smoke test was performed for this increment, and provisioning tests did not download actual model weights. Deterministic test vectors prove retrieval contracts and ordering, not relevance from a real embedding model. The older checkpoint's successful GPU chat verification does not close this newer semantic pipeline's validation gap. The user's positive UI review confirms interface direction, not full pipeline acceptance.

No application tests were rerun for this documentation-only publication. Useful verification commands are `npm run check`, `npm run build`, `TEST_DATABASE_URL=<disposable pgvector URL> npm test`, and `npm run test:browser`. Without `TEST_DATABASE_URL`, database integration tests are skipped; browser fixtures require neither SEC nor Ollama. `CHROMIUM_PATH` can select an installed browser. Provisioning shell tests target Docker/WSL/Linux and skip native Windows.

## 9. Requirements and current milestone

These are implementation assessments against the FRD roadmap, not declarations that every phase acceptance criterion has passed.

| FRD phase | Current position |
| --- | --- |
| 1–3: Foundation, identity/metadata, acquisition | Substantial foundation implemented; continuous recovery and full acquisition-to-search validation still need closure |
| 4: Deterministic parsing/provenance | Implemented baseline with transactional replacement; form-aware section accuracy and corpus coverage need work |
| 5: XBRL/financial facts | Not implemented |
| 6: Chunking/full-text/semantic search | Functional backend and UI; real-model relevance, completeness, and operational validation remain |
| 7: AI harness/prompt registry | Partial: local provider configuration/adapters/diagnostics; no complete prompt registry, output-validation workflow, or model-run audit layer |
| 8–10: AI extraction/events, cited RAG, dashboard/synthesis | Not implemented |
| 11: Packaging/self-hosting/hardening | Compose foundation exists; backup/restore and broader release hardening remain |

The current workspace serves PRD identity confirmation, research-window selection, filing inspection, company-scoped search, visible provenance, and independent pane scrolling. It approaches the PRD's useful evidence-browser experience, but does not satisfy the full MVP vertical slice, which also includes structured financial facts, cited RAG, and a basic dashboard.

## 10. Newly identified reliability gaps

Read-only inspection during this publication identified concrete follow-up work; none of these items was fixed in this documentation pass.

1. **10-Q sections need form-aware mapping.** `filing-parser.ts:sectionMatch` handles 8-K separately but applies a 10-K-style item map to other forms. A 10-Q Item 1 financial statement heading can be labeled business, while Item 2 MD&A is not recognized. Part I/II context and repeated table-of-contents headings also need fixtures. This affects section filters and future context selection (FRD-SECDET-001).
2. **Visible text and indexed coverage can diverge.** The reader preserves preamble text, but `evidence-pipeline.ts` creates whole-document fallback sections only when no headings exist, and `chunking.ts` indexes supplied section ranges. Text before a first detected heading can therefore remain visible but unsearchable. Define intentional exclusions or create unknown-section coverage and test it.
3. **Lease recovery is startup-only.** The worker requeues already expired running work once at startup; normal polling claims pending work only. Restarting before an old five-minute lease expires can leave that work stranded after expiry until another restart. Add periodic recovery and lease renewal/ownership safeguards for long-running work, with crash/restart tests (FRD-JOB-003).
4. **Persistent citations need evidence retention.** Reparse currently deletes old chunks/spans. Before durable generated artifacts reference them, retain immutable evidence generations or snapshots and mark artifacts stale explicitly. Deleting an index must not delete the historical support for an audited claim.

## 11. Recommended next sequence and acceptance boundaries

### A. Close evidence and recovery gaps

Fix 10-Q/Part-aware sections and unindexed preamble coverage, preserving exact offsets and deterministic parser/chunker versioning. Add periodic work recovery and safe long-task lease handling. Cover a complete fixture-driven ticker/submissions/acquisition/parse/chunk/search scenario, which is currently tested in separate portions.

Accept when representative 10-K, 10-Q, and 8-K fixtures produce correct section identities, intentionally complete search coverage, stable provenance, and restart recovery without duplicate active writes or stranded jobs.

### B. Validate the real research loop

On the target Compose host, confirm fresh and cached model provisioning, progressive embedding coverage, Keyword/Meaning/Combined behavior, exact source passage inspection, explicit retry, and interruption/restart behavior. Build a small 10–20-query set with expected filings/sections and record real-model retrieval quality and latency. Measure before choosing approximate indexes or rerankers.

Accept when a representative company can be processed, searched, inspected, refreshed, and resumed with truthful coverage and useful real-model results. Do not hide semantic fallback or treat model configuration as proof of readiness.

### C. Establish stable citations and structured facts

Design retained evidence generations/snapshots before adding persistent AI artifacts. Implement Companyfacts ingestion and a small deterministic financial-fact slice: raw responses, concept mapping, units, periods, accession/source provenance, and restatement/conflict handling (FRD Phase 5). Numeric answers must use structured facts or disclose unavailable support; do not recover missing financial facts through model guesses.

### D. Build the smallest auditable AI layer

Complete the Phase 7 prerequisites: versioned prompts and schemas, bounded evidence packages, output validation, and model-run records containing provider/model identity, source references, parameters, duration, and status. Validate citation IDs and unsupported-answer behavior. Treat filing text as untrusted data when building prompts. Add explicit stale-artifact rules after reparse/reindex/model changes.

Then ship a narrow company-scoped cited Q&A flow and, if useful, a persisted filing summary using that same foundation. Every citation should open the existing reader at its supporting evidence. Keep financial questions constrained by structured-fact availability. These are recommended next slices, not authorization to implement them in this publication.

### E. Expand after the narrow slice proves useful

Source-backed events/themes, multi-year synthesis, and the dashboard follow the fact and artifact foundations. Remaining polish includes large-library pagination, search evidence-status filters, persistent reader scroll, and broader parser corpus coverage. PDF/page alignment is an optional source-format expansion rather than a prerequisite for HTML-based Q&A. Backup/restore procedures and persistent-data recovery need validation before broader self-hosted release.

## 12. Decisions to carry forward

1. Keep guided intake and the fixed research frame; extend the existing reader rather than appending new detail below the page.
2. Keep source bytes, normalized text, indexed passages, and generated claims distinguishable and inspectable.
3. Preserve useful keyword operation without AI and disclose semantic readiness/fallback honestly.
4. Keep inference outside persistence transactions and reject stale-generation writes.
5. Close parser/coverage and job-recovery gaps before relying on this pipeline for persistent AI claims.
6. Build stable evidence retention and audited generation before expanding into broad AI tooling.

For continuation, read this log with the BRD/PRD, relevant FRD sections, the rolling context, and current code. Inspect `filing-parser.ts`, `evidence-pipeline.ts`, `chunking.ts`, worker lease handling, and `retrieval.ts` first. The next implementation scope should be the bounded reliability pass in section 11A, followed by target-host acceptance in 11B.
