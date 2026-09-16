# secThing

## Development Changelog

**Prepared:** 2026-09-15  
**Project:** secThing, a self-hosted and evidence-first SEC filing research workbench  
**Purpose:** This first development log records completion of the Phase 1 project foundation. It captures the runnable local stack, durable storage and migration baseline, startup defects found during container verification, and the recommended Phase 2 continuation point.

---

## 1. Continuity Note

This is the first development-paper-trail entry. The product and technical direction are defined by the authoritative documents in `docs/`:

- `docs/BRD-PRD.md` defines the product: a local-first research tool, not investment advice, with evidence before generation as its central principle.
- `docs/FRD.md` defines the technical architecture and dependency-ordered roadmap.
- `docs/plan.md` is retained as superseded historical context only.

The initial planning phase chose a staged, provenance-preserving system rather than a large-context-first AI workflow. Phase 1 implemented only the operational substrate required before SEC ingestion. No SEC API access, filing acquisition, parsing, embedding, AI processing, company entity model, or actual company dashboard exists yet.

## 2. Why Phase 1 Happened

FRD Phase 1 required a clean checkout to establish a frontend portal shell, backend and worker process separation, PostgreSQL with pgvector, migration management, a writable persistent data directory, Docker Compose, configuration, and health/readiness checks.

This was needed before Phase 2 because ticker resolution and filing metadata need durable database state, a worker runtime, secure configuration, and an observable deployment path. Implementing SEC logic first would have mixed data-acquisition concerns with unproven process and persistence setup.

Deliberate non-scope in this phase:

- SEC requests, ticker-to-CIK resolution, rate limiting, or raw-response caching;
- company, filing, job, or work-item schema;
- filing acquisition, parsing, XBRL, chunks, embeddings, search, and RAG;
- AI provider calls or model configuration beyond inert environment placeholders;
- authentication and production-hardening features.

## 3. Architecture Decisions Now Reflected in Code

### TypeScript workspace and runtime processes

The repository is an npm workspace using Node 22 and TypeScript. It has three application packages:

- `apps/frontend`: Vite and React portal shell.
- `apps/backend`: Fastify HTTP process.
- `apps/worker`: separate long-running worker process.

`packages/platform` is the shared deep module for configuration, PostgreSQL connection creation, migration behavior, and readiness assessment. This keeps environment and infrastructure behavior out of later SEC, retrieval, and domain modules.

The selected stack is intentionally conservative: React/Vite, Fastify, `postgres` for PostgreSQL access, Zod for runtime configuration validation, and Vitest. An ORM was not added in Phase 1; the first domain persistence work in Phase 2 should introduce query/repository code only where it serves the company identity and filing metadata model.

### PostgreSQL, pgvector, and durable storage

`compose.yaml` runs `pgvector/pgvector:pg16`. Migration `migrations/0001_foundation.sql` enables the `vector` extension and creates the small `system_metadata` baseline table.

Large evidence files are not stored in PostgreSQL. `./data` is bind-mounted to `/app/data` in the backend and worker, matching the FRD decision to reserve filesystem storage for raw SEC materials and bulky artifacts. PostgreSQL data persists through the `postgres-data` named volume.

### Migrations and concurrent startup

`scripts/migrate.ts` invokes `applyMigrations` from `packages/platform`. It uses checksummed SQL migration files recorded in `schema_migrations`; a changed applied migration causes a checksum mismatch rather than silently changing deployed history.

Backend and worker each run migrations before starting. This was intentionally tested as a concurrent startup path because both processes launch after PostgreSQL health is available. The migration routine now acquires a transaction-scoped PostgreSQL advisory lock *before* creating `schema_migrations` or checking/applying files. This avoids concurrent `CREATE TABLE IF NOT EXISTS` races.

### Configuration and capability disclosure

`.env.example` defines the initial runtime surface:

- database and Postgres bootstrap values;
- `DATA_DIR`;
- `SEC_USER_AGENT` placeholder for Phase 2;
- disabled/local/external AI mode placeholders for later provider work;
- host-visible frontend and backend ports.

The backend implements:

- `GET /health`: liveness only;
- `GET /ready`: PostgreSQL reachability, current migrations, and writable data-directory status; returns HTTP 503 when any check fails;
- `GET /api/v1/system/capabilities`: explicit Phase 1 feature flags, so the frontend does not infer implementation status from absent data.

The worker runs the same readiness requirements, confirms SEC configuration as not yet required in Phase 1, and remains in an explicit idle loop. Phase 2 should replace that idle loop with durable PostgreSQL work-item claiming, rather than creating a separate queue service.

### Frontend shell

The portal at `apps/frontend` is a narrow management surface rather than a marketing page. It queries `/ready`, renders the individual system checks, and handles unavailable backend state. It intentionally does not imitate a company dashboard before the underlying company data exists.

The visual treatment is restrained and operational: a clear system status surface, responsive layout, accessible live status text, and no decorative placeholder content.

## 4. Implementation Inventory

| Area | Key files | Current responsibility |
| --- | --- | --- |
| Workspace/tooling | `package.json`, `tsconfig.base.json`, `package-lock.json` | npm workspace scripts, TypeScript and test tooling |
| Deployment | `Dockerfile`, `compose.yaml`, `.env.example` | local containers, pgvector, persistence mounts, optional inert Ollama CPU profile |
| Shared platform module | `packages/platform/src/` | config validation, DB connections, migrations, readiness, capability flags |
| Backend | `apps/backend/src/server.ts`, `apps/backend/src/index.ts` | liveness/readiness/capability HTTP interface |
| Worker | `apps/worker/src/index.ts` | validated long-running idle process |
| Frontend | `apps/frontend/src/` | system-status portal shell |
| Database | `migrations/0001_foundation.sql`, `scripts/migrate.ts` | pgvector enablement and migration runner |
| Tests | `tests/config.test.ts`, `tests/server.test.ts` | config validation and backend liveness/capability behavior |

## 5. Issues Encountered and Resolved

### Root migration script module mode

The root `package.json` does not declare ESM. `tsx scripts/migrate.ts` initially rejected top-level `await` with a CommonJS output error, preventing both backend and worker startup.

Resolution: `scripts/migrate.ts` now uses an explicit `main()` function invoked without top-level await. Application packages remain ESM where needed.

### Duplicate Vite type resolution

The frontend initially owned Vite while Vitest installed a separate compatible-but-distinct Vite version at the workspace root. TypeScript then treated the React plugin and Vite configuration types as incompatible.

Resolution: Vite and the React plugin were centralized in root development dependencies. The frontend consumes that shared toolchain and explicitly includes `vite/client` types.

### Backend and worker migration race

Concurrent startup produced `duplicate key value violates unique constraint "pg_type_typname_nsp_index"` when both processes tried to create the migration-history table outside the advisory lock.

Resolution: the migration-history table creation moved inside the advisory-lock transaction. A restart of backend and worker confirmed both migrations complete and the worker reaches its ready/idle state.

### Worker exited despite signal handlers

The original worker skeleton awaited a Promise resolved by signal handlers. Signal listeners do not keep Node's event loop alive, so Node emitted an unsettled top-level-await warning and exited.

Resolution: the worker now uses an explicit timer-backed idle loop with SIGINT/SIGTERM cleanup. This is a temporary Phase 1 lifecycle implementation and is intentionally called out for replacement in Phase 2.

## 6. Validation Performed

The following succeeded after the final fixes:

- `npm run check` completed for backend, frontend, and worker.
- `npm test` completed with 4 passing tests across config and backend endpoint behavior.
- `npm run build` completed, including the production Vite frontend build.
- `docker compose --env-file .env.example config` validated Compose expansion.
- Docker Compose started PostgreSQL, backend, worker, and frontend.
- PostgreSQL reported the `vector` extension and migration `0001_foundation.sql` as applied.
- `GET http://localhost:8080/ready` returned `ready` with passing database and data-directory checks.
- `GET http://localhost:8080/api/v1/system/capabilities` reported Phase 1 and all future feature flags as disabled.
- `http://localhost:3000` returned the frontend portal document.

At the end of the implementation session, the development stack was left running locally with `.env.example` supplied only for smoke-test configuration. A real local deployment should copy `.env.example` to `.env`, set a non-default `POSTGRES_PASSWORD`, and keep `DATABASE_URL` aligned before exposure beyond the trusted host.

## 7. Current System State

### Implemented

- Runnable local Compose base stack with internal-only PostgreSQL and worker networking.
- Persistent PostgreSQL + pgvector and a bind-mounted application data directory.
- Checksum-verified, concurrency-safe SQL migrations.
- Backend liveness, readiness, and capability endpoints.
- Shared configuration and readiness module.
- Worker lifecycle skeleton that stays alive and exposes structured startup logs.
- Frontend status shell connected to backend readiness.
- Basic automated configuration and backend endpoint tests.

### Not Yet Implemented

- PostgreSQL domain schema for companies, ticker aliases, filings, jobs, and work items.
- SEC client, required descriptive User-Agent enforcement, rate limiting, official ticker mapping cache, and raw response cache.
- Company add/list UI and identity confirmation.
- Every evidence, parsing, XBRL, search, AI, provenance, dashboard, authentication, and production-hardening capability planned after Phase 1.

### Known Limitations / Deferred Work

- The Docker image is a development-oriented source-mounted image, not the final production image described in FRD Phase 11.
- Ollama exists only as an optional `ollama-cpu` Compose profile. No application provider integration exists yet; do not treat it as usable AI support.
- `docker compose` does not auto-load `.env.example`; the verification command used `--env-file .env.example` intentionally. The documented user deployment path is to create `.env`.
- The repository is not a Git repository at this point. No Git operations were performed.
- Dependency installation reported npm audit findings. They were not remediated during Phase 1 because remediation could force unrelated dependency changes; assess them before release hardening.

## 8. Recommended Next Direction: Phase 2 SEC Identity and Metadata

Continue with FRD Phase 2, which is the first vertical product slice:

1. Add migration-managed tables for `companies`, `company_ticker_aliases`, `filings`, and the minimal durable `jobs`/`work_items` model needed for identity work.
2. Implement `SecClient` behind a small interface with a descriptive configured User-Agent, conservative configurable rate limit, timeout/retry policy, and raw-response file cache.
3. Fetch and cache the official SEC ticker mapping, resolve ticker input to CIK, and persist CIK as the durable company identity.
4. Fetch the SEC submissions response, enumerate filing metadata idempotently, and preserve the raw metadata response path/hash.
5. Add backend routes for add-company, list companies, company details, and company ingestion status.
6. Replace the worker idle loop with a minimal PostgreSQL work-item claim/lease flow only as required for those operations. Do not add Redis, Celery, RQ, or a general DAG engine.
7. Add a basic company library/add-company UI that displays identity resolution and filing metadata, without attempting source downloads, parsing, or AI.

Use `LINC` / CIK `0001286613` as a fixture or live-gated reference case as specified in `docs/FRD.md`. Preserve the distinction between ticker input and CIK identity. Keep browser code away from SEC endpoints.

## 9. Summary of Major Decisions Added in Dev Log 0001

1. Use a TypeScript npm workspace with separate frontend, backend, and worker processes plus a shared platform module.
2. Keep PostgreSQL + pgvector and the local filesystem as the only persistence systems in the MVP foundation.
3. Use checksummed SQL migrations protected by a transaction-scoped PostgreSQL advisory lock; both backend and worker may safely initialize concurrently.
4. Treat frontend capability and readiness state as explicit backend contracts, not inferred UI behavior.
5. Keep AI entirely disabled in Phase 1; the optional Ollama profile is deployment scaffolding only.
6. Proceed next with CIK-based SEC identity and metadata, preserving the deterministic-before-generative and evidence-before-generation architecture.

## Recommended Use of This Document

This document is the first internal engineering handoff. A fresh session should read `docs/BRD-PRD.md`, the relevant Phase 2 sections of `docs/FRD.md`, this log, and then inspect `packages/platform`, `apps/backend`, `apps/worker`, `compose.yaml`, and the first migration before continuing.
