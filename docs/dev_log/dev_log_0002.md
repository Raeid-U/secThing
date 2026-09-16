# secThing

## Development Changelog

**Prepared:** 2026-09-16  
**Project:** secThing, a local-first, evidence-first SEC filing research workbench  
**Purpose:** This entry continues `dev_log_0001.md` with the frontend migration from Vite to Next.js and the first company identity/filing-metadata vertical slice. It records the durable data model, SEC metadata workflow, idempotency rules, intake UI, and the external-network limitation encountered during live verification.

---

## 1. Continuity Note

`dev_log_0001.md` completed the runnable foundation: independent backend, worker, frontend, PostgreSQL/pgvector, migration, readiness, and Compose infrastructure. It intentionally deferred all SEC acquisition and domain records.

This increment replaces the temporary frontend shell and begins the FRD Phase 2 SEC Identity and Metadata work. The older `plan.md` names this same functional milestone “Phase 1: SEC Data Foundation”; the current FRD is authoritative for sequencing.

## 2. Why This Phase Happened

The next useful product action is a ticker becoming a persistent, inspectable local company record. `BRD-PRD.md` requires ticker entry, a user-selected historical window, durable progress, a filing list, and refresh behavior that does not rebuild unchanged history. `FRD.md` requires CIK identity, stable accession identity, a centralized SEC client, PostgreSQL work items, cache provenance, and incremental refresh.

This increment deliberately stops at identity and filing metadata. It does not download filing documents, parse text, extract XBRL facts, chunk content, embed, search, or generate AI artifacts. The UI therefore labels those downstream stages as not started rather than implying their completion.

## 3. Frontend Architecture: Vite to Next.js 16.3.5

The frontend is now a Next.js 16.3.5 App Router application with Tailwind CSS 4 tooling. Vite’s entrypoint, configuration, HTML shell, and generated TypeScript build-info artifact were removed.

The Fastify backend remains the domain API and the worker remains the only SEC caller. Next is a frontend/server boundary, not a replacement backend:

- `BACKEND_API_URL` is private server configuration.
- Next rewrites browser `/api/v1/*` calls to Fastify, giving the UI same-origin API access.
- A small Next route handler proxies Fastify readiness at `/api/v1/system/readiness` and returns a structured `503` when the backend is unavailable.
- The source-mounted Compose development service now runs `next dev`; `next start` remains available after a production build.

The initial visual system uses a Swiss/International Typographic Style direction: a strict editorial grid, paper/ink/cobalt palette, structural rules, compact interface typography, and a serif research headline. It intentionally avoids generic rounded dashboard cards and decorative status treatments.

## 4. SEC Identity and Metadata Model

Migration `0002_company_identity_and_metadata.sql` adds:

- `companies`, keyed by canonical integer CIK;
- `company_ticker_aliases`, retaining ticker as an alias rather than a durable identity;
- `filings`, unique on `(cik, accession_number)`;
- `sec_responses`, retaining SEC response location and content hash without duplicating identical URL/hash pairs;
- `jobs` and `work_items` for persistent user-visible work and executable stages.

The filing table stores all enumerated SEC filing metadata so the user can see availability beyond supported forms. It marks `10-K`, `10-Q`, `8-K`, and their amendments as currently supported for later source work. Other forms remain metadata-only in this increment.

## 5. Idempotency and Date-Range Rules

The rules needed for repeat intake are now enforced in storage and worker behavior:

- A company is unique by CIK, not ticker.
- A filing is unique by CIK plus accession number.
- Re-enumeration uses upsert behavior and refreshes mutable metadata without duplicating filing rows.
- The company tracks the earliest requested filing date and latest requested date.
- Re-entering a known ticker for an already covered range returns `existing` rather than creating another job or company.
- Choosing an earlier start date queues metadata refresh for that existing company; it adds only filings newly inside the expanded range. A narrower request never deletes filings.

The resulting progress payload exposes identity, metadata, filing counts, and explicitly-not-started source acquisition, parsing, and chunking stages.

## 6. SEC Client and Worker

`SecClient` is the sole SEC HTTP integration. It enforces a configured rate ceiling (default 5 requests/second; config rejects values over 10), a descriptive User-Agent containing contact information, retry/backoff for transient failures, JSON response hashing, and cache-body persistence under `DATA_DIR/sec/api/`.

It resolves tickers from the official SEC mapping and retrieves both recent submission metadata and historical submission files referenced by the primary submissions response. CIKs are formatted as ten digits only when constructing SEC URLs.

The worker now claims pending PostgreSQL work under a lease, restores expired leases on startup, processes one work item at a time, and bounds failures to three attempts. It separates `resolve_company` from `fetch_metadata`; a successful resolution creates the latter work item. Failed transient work remains `running` at the job level until retry budget is exhausted, then becomes visible as `partial`.

## 7. API and Browser Experience

Fastify now exposes:

- `POST /api/v1/companies` for ticker plus ISO start date intake;
- `GET /api/v1/companies` for the persistent library;
- `GET /api/v1/companies/:companyId` for company metadata, filings, and recent jobs;
- `GET /api/v1/jobs/:jobId` for polling durable processing status.

The Next home page now provides the company workbench: ticker input, date selection through today, job polling, an existing-company message, library entries, and the selected company’s filing index. It correctly describes downstream evidence processing as not started.

## 8. Validation

Completed successfully:

- `npm run check`
- `npm test` — 6 tests pass, including fixture-backed LINC → CIK `0001286613` resolution and recent-plus-historical submission enumeration
- `npm run build` — Next 16.3.5 production build succeeds
- `docker compose --env-file .env.example config`
- PostgreSQL migration smoke test, confirming both `0001_foundation.sql` and `0002_company_identity_and_metadata.sql`
- Backend and worker startup with the new migration and SEC configuration
- Next same-origin `/api/v1/companies` rewrite against Fastify
- Rendered frontend smoke test showing ticker/date intake and filing-index UI

## 9. Live SEC Verification Limitation

A real `POST /api/v1/companies` request for `LINC` with start date `2025-01-01` was accepted and persisted as job `1`. The configured example User-Agent and this environment could not complete the SEC request: host access returned HTTP `403`, while the worker container reported a TLS socket disconnect before connection establishment. The job therefore exposed a retryable failure without creating a company or filing record.

This is not treated as proof of a successful live SEC path. A real deployment must replace the example User-Agent with a genuine descriptive contact address and have outbound TLS access to SEC endpoints. Fixture tests cover the successful SEC response path deterministically.

## 10. Current System State and Next Direction

The project now has a Next frontend, CIK-based metadata persistence, filing enumeration, date-expansion semantics, and an operational worker/API shape for the first product vertical slice. The next continuation should:

1. repeat the LINC live check from an environment with accepted SEC egress and a real contact User-Agent;
2. add database-backed integration tests for duplicate accession and range-expansion behavior;
3. proceed to FRD Phase 3 source acquisition: filing index retrieval, primary-document selection, immutable raw document storage, and filing-level source status;
4. retain the existing stage progress contract as parsing and chunking are introduced.

No AI provider, parser, document download, XBRL, chunking, search, or dashboard synthesis is implemented by this entry.
