# secThing

Self-hosted, evidence-first SEC filing research workbench. See [docs/BRD-PRD.md](docs/BRD-PRD.md) and [docs/FRD.md](docs/FRD.md) for the authoritative product and technical requirements.

## Run secThing locally

1. Copy `.env.example` to `.env` and set a non-default `POSTGRES_PASSWORD`. Keep `DATABASE_URL` aligned with that password.
2. Run `docker compose up --build`.
3. Open `http://localhost:3000`.

The backend is available on `http://localhost:8080`:

- `GET /health` checks that the process is alive.
- `GET /ready` checks PostgreSQL, current migrations, and the writable data directory.
- `GET /api/v1/system/capabilities` exposes explicit capability flags.

The current metadata slice accepts a ticker and a filing start date, resolves the company by CIK, stores SEC identity/profile metadata, and catalogues filings without duplicating existing accessions. Filing-document download, parsing, search, and AI remain later phases.

## SEC data access

secThing uses official SEC data APIs for public-company metadata and filing catalogues. It is not designed to scrape SEC website pages. Browser code never calls SEC endpoints directly.

Before enabling ingestion, set a descriptive User-Agent with a real contact address in `.env`:

```dotenv
SEC_USER_AGENT="secThing/0.1.0 PersonalUse your-name@example.com"
SEC_RATE_LIMIT_PER_SECOND=5
```

The default rate is deliberately conservative. The application rejects any rate over 10 requests per second, serializes requests within the worker process, caches received API responses locally, and retries transient failures with backoff. Do not set the rate above the SEC’s published ceiling.

## Local development

Install dependencies with `npm install`, then start the services separately after setting `DATABASE_URL` and `DATA_DIR`:

```bash
npm run db:migrate
npm run dev:backend
npm run dev:worker
npm run dev:frontend
```

`data/` is bind-mounted in Compose for SEC source and artifact storage introduced in later phases. PostgreSQL uses the `postgres-data` named volume.
