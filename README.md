# secThing

Self-hosted, evidence-first SEC filing research workbench. See [docs/BRD-PRD.md](docs/BRD-PRD.md) and [docs/FRD.md](docs/FRD.md) for the authoritative product and technical requirements.

## Run secThing locally

1. Copy `.env.example` to `.env` and set a non-default `POSTGRES_PASSWORD`. Keep `DATABASE_URL` aligned with that password.
2. Run `docker compose up --build`.
3. Open `http://localhost:3000`.

Compose first runs a single `dependencies` initialization service to install the lockfile into the shared `node-modules` volume. Backend, worker, and frontend wait for it to succeed, so added packages are available even when an older dependency volume already exists. Rebuild/restart with `docker compose up --build -d` after pulling changes; database and model volumes remain intact.

The backend is available on `http://localhost:8080`:

- `GET /health` checks that the process is alive.
- `GET /ready` checks PostgreSQL, current migrations, and the writable data directory.
- `GET /api/v1/system/capabilities` exposes explicit capability flags.

The records workspace provides guided company intake, filterable filings, company-scoped keyword/meaning/combined search, and a fixed frame with independently scrolling original-source and extracted-text panes. Selecting a result opens its exact extracted passage. Sources currently supported by acquisition and parsing are HTML/text; the original view renders an isolated copy of the preserved source with scripts and external assets blocked. Financial facts and cited AI answers remain pending.

The worker backfills missing or outdated chunk indexes when it starts. Use **Update index** in the workspace or `POST /api/v1/companies/:companyId/search/reindex` to queue missing indexes and retry failed embedding jobs. The response contains `queued`, `jobIds`, and optionally `embeddingsQueued`; already indexed or actively processing documents are skipped. Search is available at `GET /api/v1/companies/:companyId/search?q=...`, with optional `mode=full_text|semantic|hybrid`, `formType`, `sectionType`, `filedAfter`, `filedBefore`, and `limit`.

Meaning search requires `AI_MODE=local`, `AI_EMBEDDING_PROVIDER=ollama`, `AI_EMBEDDING_BASE_URL`, and `AI_EMBEDDING_MODEL`. It does not require a chat model. The worker embeds passages in batches; the workspace shows how many are ready. Combined search falls back explicitly to keyword search when meaning retrieval is unavailable. Optional `AI_EMBEDDING_DIMENSION` enforces the expected vector size; otherwise the first valid response establishes it. Changing model, endpoint, dimension, or chunking profile creates a separate embedding profile. Use a new model tag when replacing model weights rather than overwriting an existing tag.

Vectors use exact cosine retrieval in PostgreSQL for the initial local corpus. An approximate vector index can follow measured performance needs.

Parser upgrades also backfill from preserved sources at worker startup or through Update index. Existing evidence is excluded from search until rebuilt with the current parser; new chunks are then embedded normally. The worker renews active leases every 30 seconds and recovers expired work every 10 seconds. Persistence checks the worker and attempt identity transactionally, preventing retired attempts from replacing current evidence. Three expired attempts become a visible terminal failure.

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

For CPU-only use, start the profile:

```bash
docker compose --profile ollama-cpu up --build -d
```

For the initial Windows 11 + Docker Desktop/WSL2 + NVIDIA path, install a current NVIDIA Windows driver and enable Docker GPU support, then use:

```bash
docker compose -f compose.yaml -f compose.nvidia.yaml --profile ollama-nvidia up --build -d
```

Both profiles automatically provision the `AI_CHAT_MODEL` and `AI_EMBEDDING_MODEL` names from `.env`. The `ollama-models` initialization service waits for Ollama, skips models already present, and downloads missing models into the existing `ollama-data` volume. Worker startup waits for provisioning; the backend/UI can start while models download. Check progress with `docker compose logs -f ollama-models`. A failed pull stops worker startup with a visible error; correct the model setting/connectivity and rerun the same Compose command.

Automatic pulls apply only to `AI_MODE=local`, provider `ollama`, and an endpoint of `http://ollama:11434` (an optional trailing slash is accepted). Blank model names and separately hosted runtimes are skipped. The AI-free base stack does not start Ollama or download models.

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

`data/` is bind-mounted in Compose for preserved SEC sources and normalized text. PostgreSQL uses the `postgres-data` named volume.

## Validation

Run `npm test`, `npm run check`, and `npm run build`. PostgreSQL lifecycle integration tests require a disposable pgvector PostgreSQL instance; set `TEST_DATABASE_URL` when running `npm test` to enable them. These tests create and remove a unique schema and never use the application's `DATABASE_URL`. Without `TEST_DATABASE_URL`, the integration suite is skipped.

For browser interaction tests, run `npx playwright install --with-deps chromium`, then `npm run test:browser`. The suite starts the frontend and supplies fixture API responses; it needs neither SEC access nor Ollama. Set `CHROMIUM_PATH` to use an existing Chromium binary.

For a real embedding-model smoke test, export `TEST_DATABASE_URL` for a disposable pgvector database, `AI_EMBEDDING_BASE_URL` for an Ollama endpoint reachable from the command's runtime, and `AI_EMBEDDING_MODEL` for an already pulled model. Then run `npm run validate:retrieval`. The script uses the real parser, index, Ollama adapter, and retrieval against four synthetic filings; it reports indexing/query latency and expected-source ranking for eight semantic/hybrid checks. It requires complete embedding coverage, no fallback, expected sources in the top three, and at least six expected sources ranked first. This small smoke set does not establish real-filing relevance. Temporary sources and its isolated database schema are removed on completion or failure; the script never falls back to the application's `DATABASE_URL`.
