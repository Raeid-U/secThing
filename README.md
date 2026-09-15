# secThing

Self-hosted, evidence-first SEC filing research workbench. See `BRD-PRD.md` and `FRD.md` for the authoritative product and technical requirements.

## Phase 1: Run the foundation

1. Copy `.env.example` to `.env` and set a non-default `POSTGRES_PASSWORD`. Keep `DATABASE_URL` aligned with that password.
2. Run `docker compose up --build`.
3. Open `http://localhost:3000`.

The backend is available on `http://localhost:8080`:

- `GET /health` checks that the process is alive.
- `GET /ready` checks PostgreSQL, current migrations, and the writable data directory.
- `GET /api/v1/system/capabilities` exposes explicit Phase 1 capability flags.

Phase 1 intentionally does not acquire SEC data, invoke AI, or provide a company dashboard. It establishes the persistent runtime needed for those later phases.

## Local development

Install dependencies with `npm install`, then start the services separately after setting `DATABASE_URL` and `DATA_DIR`:

```bash
npm run db:migrate
npm run dev:backend
npm run dev:worker
npm run dev:frontend
```

`data/` is bind-mounted in Compose for SEC source and artifact storage introduced in later phases. PostgreSQL uses the `postgres-data` named volume.
