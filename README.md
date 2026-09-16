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

## Local AI runtime (Ollama)

secThing can run Ollama as an optional Compose service, so no inference runtime is required on the host OS. The base stack stays AI-free; enable AI only after choosing local models in `.env`:

```dotenv
AI_MODE=local
AI_CHAT_PROVIDER=ollama
AI_CHAT_BASE_URL=http://ollama:11434
AI_CHAT_MODEL=qwen2.5:3b
AI_EMBEDDING_PROVIDER=ollama
AI_EMBEDDING_BASE_URL=http://ollama:11434
AI_EMBEDDING_MODEL=nomic-embed-text
```

For CPU-only use, start the profile and download the selected models into the persistent `ollama-data` volume:

```bash
docker compose --profile ollama-cpu up --build -d
docker compose exec ollama ollama pull qwen2.5:3b
docker compose exec ollama ollama pull nomic-embed-text
```

For the initial Windows 11 + Docker Desktop/WSL2 + NVIDIA path, install a current NVIDIA Windows driver and enable Docker GPU support, then use:

```bash
docker compose -f compose.yaml -f compose.nvidia.yaml --profile ollama-nvidia up --build -d
```

The backend reports runtime/model status at `GET /api/v1/system/ai/status`. `POST /api/v1/system/ai/verify` makes a fixed local diagnostic chat call after the configured model is available. It does not send company evidence or persist generated content. AMD/ROCm, Intel/Arc, vLLM, and llama.cpp are intentionally deferred to future deployment adapters.

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
