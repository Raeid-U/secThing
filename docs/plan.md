# secThing Project Roadmap (Superseded)

This file is the original planning draft. The authoritative planning documents are now:

- `BRD-PRD.md` for product and business requirements.
- `FRD.md` for functional, technical, architecture, data, ingestion, AI, retrieval, deployment, and implementation requirements.

Keep this file only as historical context. Do not add new requirements here.

## 1. Product Summary

secThing is a self-hosted SEC filings research workbench. A user enters a public company ticker, chooses a filing lookback window, and secThing builds a persistent local knowledge bank from that firm's SEC filings.

The goal is not to produce investment advice. The goal is to make first-contact company research faster by collecting, parsing, indexing, summarizing, and citing relevant SEC filing information in one local dashboard.

Core principle:

> Every generated factual claim should trace back to a source filing, filing date, form type, accession number, section, and ideally a text span.

## 2. Target User Flow

1. User hears about a company and wants a first-pass understanding.
2. User opens secThing and enters a ticker.
3. User selects a lookback window, such as 3, 5, 10, 20, 50 years, or all available filings.
4. secThing resolves the ticker to a CIK.
5. secThing fetches company metadata and SEC filing history.
6. secThing downloads relevant filings.
7. secThing parses, chunks, embeds, and summarizes the filings using the user's configured AI provider.
8. The company appears on the front page when ingestion is complete or partially complete.
9. User opens the company dashboard.
10. User reviews company profile, filing coverage, financial metrics, timelines, risk themes, and summaries.
11. User uses semantic search or a cited RAG chatbot to ask questions about the company.

## 3. Non-Goals

- secThing is not an investment advisor.
- secThing is not intended to guarantee complete diligence.
- secThing should not make unsupported investment recommendations.
- secThing should not rely on generated summaries as primary evidence when raw filing text is available.
- secThing should not require a closed-source model to function.

## 4. Core Architecture

secThing should be deployed as a Docker-based self-hosted application with multiple services.

### 4.1 Frontend Portal

Responsibilities:

- Management UI.
- Add company by ticker.
- View ingestion progress.
- View company dashboards.
- Browse filings.
- Run semantic search.
- Use cited RAG chat.
- Configure model provider settings.
- Configure SEC access settings.

### 4.2 Backend API

Responsibilities:

- Expose API consumed by frontend.
- Manage companies, filings, jobs, settings, dashboards, search, and chat.
- Coordinate ingestion jobs.
- Enforce citation and provenance rules.
- Manage model provider abstraction.
- Store prompt versions and model run metadata.

### 4.3 Worker

Responsibilities:

- Resolve ticker to CIK.
- Fetch SEC submissions metadata.
- Fetch SEC XBRL company facts.
- Download filings.
- Parse filing documents.
- Split filings into sections.
- Chunk sections.
- Generate embeddings.
- Run structured extraction prompts.
- Build timeline events, summaries, and dashboard artifacts.

### 4.4 Database

Recommended first version:

- PostgreSQL for application data.
- pgvector for vector search.

This keeps the initial deployment simpler than running a separate relational DB and vector DB.

### 4.5 Durable File Storage

Use bind-mounted local storage for:

- Raw SEC API responses.
- Raw filings.
- Parsed filing text.
- Extracted filing artifacts.
- Cached intermediate results.

The data directory should survive container replacement.

### 4.6 AI Harness

The backend should talk to AI providers through an OpenAI-compatible abstraction where possible.

Local provider options:

- Ollama, recommended first local runtime.
- llama.cpp server, likely second provider.
- vLLM, later provider for heavier deployments.

External provider options:

- OpenAI-compatible API endpoint.
- Mistral API.
- Anthropic adapter, if needed.

The system should support separate configuration for:

- Chat/completion model.
- Embedding model.
- Context window.
- Temperature.
- Max output tokens.
- Provider base URL.
- API key, when using external models.

## 5. SEC Data Sources

Initial useful endpoints:

```text
https://app.edgar.tools/tools/cik-lookup.json?q={ticker}
https://data.sec.gov/submissions/CIK{cik}.json
https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json
```

Example:

```text
Ticker: LINC
CIK: 0001286613
https://app.edgar.tools/tools/cik-lookup.json?q=LINC
https://data.sec.gov/submissions/CIK0001286613.json
https://data.sec.gov/api/xbrl/companyfacts/CIK0001286613.json
```

SEC reference:

```text
https://www.sec.gov/search-filings/edgar-application-programming-interfaces
```

Important implementation notes:

- SEC requests should be made from the backend, not the browser.
- SEC requires responsible automated access behavior.
- Configure a clear User-Agent with contact information.
- Respect SEC rate limits.
- Cache SEC responses to avoid repeated unnecessary requests.

## 6. Data Model Draft

Initial entities:

- `companies`
  - CIK
  - ticker
  - legal name
  - exchange
  - SIC
  - fiscal year end
  - headquarters, if available
  - metadata source

- `filings`
  - company ID
  - accession number
  - form type
  - filing date
  - report date
  - primary document URL
  - local raw path
  - parse status
  - ingestion status

- `filing_documents`
  - filing ID
  - document type
  - filename
  - SEC URL
  - local path
  - is primary document

- `filing_sections`
  - filing ID
  - section label
  - normalized section type
  - text
  - start offset
  - end offset

- `chunks`
  - filing ID
  - section ID
  - chunk text
  - token count
  - embedding vector
  - source offsets

- `xbrl_facts`
  - company ID
  - taxonomy
  - concept
  - unit
  - period start
  - period end
  - fiscal year
  - fiscal period
  - value
  - accession number
  - form type

- `events`
  - company ID
  - event date
  - event type
  - title
  - summary
  - confidence
  - source filing references

- `summaries`
  - company ID
  - filing ID, when applicable
  - section ID, when applicable
  - summary type
  - summary text
  - source references
  - model run ID

- `model_runs`
  - provider
  - model
  - prompt version
  - input source IDs
  - output
  - validation status
  - created timestamp

- `jobs`
  - job type
  - company ID
  - status
  - progress
  - current step
  - error
  - retry count

## 7. Ingestion Pipeline

### 7.1 Ticker Resolution

- Accept user ticker input.
- Normalize ticker.
- Resolve ticker to CIK.
- Store CIK with leading zeros.
- Allow manual correction later.

### 7.2 Company Metadata Fetch

- Fetch SEC submissions JSON.
- Store company name, former names, tickers, exchanges, SIC, and fiscal year end.
- Optional later enrichment from Wikipedia, Wikidata, or another metadata provider.

### 7.3 Filing Selection

Initial filing forms:

- 10-K
- 10-Q
- 8-K

Later filing forms:

- DEF 14A
- S-1
- 20-F
- 40-F
- 6-K
- 13D
- 13G
- Form 4

Lookback options:

- 3 years
- 5 years
- 10 years
- 20 years
- 50 years
- all available

### 7.4 Filing Download

- Download filing index.
- Identify primary document.
- Download primary filing document.
- Store raw file in durable storage.
- Mark filing status.

### 7.5 Filing Parse

- Convert HTML or text filing to normalized text.
- Preserve useful source metadata.
- Split by major filing sections where possible.
- Store parse failures without aborting the full company ingestion.

Initial target sections:

- Business
- Risk Factors
- Legal Proceedings
- MD&A
- Financial Statements
- Controls and Procedures
- Management
- Exhibits

### 7.6 Chunking

- Chunk by filing section first.
- Keep chunks within embedding model limits.
- Use modest overlap.
- Attach source metadata to every chunk.

### 7.7 Embedding

- Generate embeddings after chunking.
- Store vectors in pgvector.
- Record embedding model and version.
- Avoid regenerating embeddings when source text and embedding model have not changed.

### 7.8 XBRL Facts

Pull and normalize key concepts:

- Revenue
- Net income
- Assets
- Liabilities
- Cash and cash equivalents
- Operating cash flow
- Debt
- Shares outstanding
- EPS

Store both:

- Raw companyfacts data.
- Normalized dashboard-friendly financial metrics.

### 7.9 AI Extraction

Use strict JSON schema outputs for:

- Business description.
- Main products and services.
- Risk themes.
- Legal and regulatory issues.
- Strategic changes.
- Acquisitions and dispositions.
- Debt and capital structure notes.
- Management and governance changes.
- Material event candidates.

Model outputs should be validated before being stored as trusted structured artifacts.

### 7.10 Timeline Build

Timeline sources:

- 8-K filings.
- 10-K and 10-Q disclosures.
- XBRL financial changes.
- Extracted material events.

Every event should include source references.

## 8. RAG and Search Rules

Semantic search should work before chatbot features are considered complete.

RAG behavior rules:

- Prefer raw filing text over summaries.
- Answer from retrieved sources.
- Cite filing, form type, filing date, section, and source snippet.
- If retrieved filings do not support an answer, say so.
- Do not invent metrics.
- Do not provide investment advice.
- Clearly distinguish extracted facts from generated interpretation.

## 9. Dashboard Scope

Initial dashboard sections:

- Company snapshot.
- Filing coverage.
- Recent filings.
- Financial metric trends.
- Major event timeline.
- Risk themes.
- Legal/regulatory notes.
- Management/governance notes.
- Capital structure notes.
- Suggested filings to read first.
- Open questions for manual review.

Dashboard should show source links wherever generated text appears.

## 10. Model Tiers

Initial model support should be practical and local-first.

Suggested tiers:

- Lightweight: 3B-4B instruct model for constrained hardware.
- Default: 7B-8B instruct model for 8GB unified memory or VRAM class machines.
- Recommended: 14B class model for 16GB unified memory or VRAM.
- High-end: 30B-ish quantized model for enthusiast hardware under roughly 32GB memory.
- External: closed-source provider through configured API key.

The application should not hard-code one model family as required.

## 11. Docker Deployment Goals

End goal:

- User can pull or build a Docker image.
- User can run with Docker Compose.
- User can bind mount durable storage.
- User can choose local model runtime or external API.
- User can configure GPU access based on their hardware.

Initial services:

```text
frontend
backend
worker
postgres
ollama
```

Potential later services:

```text
redis
llama-cpp
vllm
minio
```

Environment variables:

```text
SEC_USER_AGENT=
DATABASE_URL=
VECTOR_DATABASE_URL=
AI_PROVIDER=
AI_BASE_URL=
AI_API_KEY=
AI_CHAT_MODEL=
AI_EMBEDDING_MODEL=
DATA_DIR=
```

GPU support should be documented by deployment profile rather than hidden behind application logic.

## 12. Phase Roadmap

### Phase 0: Project Foundation

Deliverables:

- Choose initial tech stack.
- Create repo structure.
- Add Docker Compose skeleton.
- Add env example.
- Add backend health endpoint.
- Add frontend shell.
- Add database migration setup.

Definition of done:

- Project boots locally.
- Backend can connect to database.
- Frontend can call backend health endpoint.

### Phase 1: SEC Data Foundation

Deliverables:

- Ticker to CIK resolver.
- SEC submissions fetcher.
- SEC companyfacts fetcher.
- SEC rate limiting.
- SEC User-Agent config.
- Raw response cache.
- Company and filing metadata persistence.

Definition of done:

- Given ticker `LINC`, secThing resolves CIK `0001286613`.
- secThing stores basic company metadata.
- secThing lists available filings.
- Re-running does not duplicate records.

### Phase 2: Filing Download and Parse

Deliverables:

- Filing index downloader.
- Primary document detector.
- Filing document downloader.
- Raw filing storage.
- HTML/text parser.
- Initial section splitter.
- Filing browser UI.

Definition of done:

- User can ingest filings for a ticker.
- User can view downloaded filings.
- User can read normalized filing text in the UI.
- Parse failures are visible and recoverable.

### Phase 3: Searchable Knowledge Bank

Deliverables:

- Chunking pipeline.
- Embedding provider abstraction.
- pgvector integration.
- Semantic search API.
- Search UI with snippets and citations.

Definition of done:

- User can search a company's filings semantically.
- Results include filing, date, form type, section, and snippet.
- Search works without chatbot generation.

### Phase 4: AI Provider Harness

Deliverables:

- OpenAI-compatible chat provider.
- Ollama provider setup.
- External API provider setup.
- Prompt registry.
- Prompt versioning.
- Structured JSON output validation.
- Model settings UI.

Definition of done:

- Backend can call local Ollama.
- Backend can call an external compatible API.
- Model outputs record model, provider, prompt version, and source inputs.

### Phase 5: Cited RAG Chat

Deliverables:

- Retrieval pipeline.
- Context builder.
- Citation-enforced answer prompt.
- Company-scoped chat API.
- Chat UI.
- Source panel.

Definition of done:

- User can ask filing-specific questions.
- Answers cite source filings.
- Unsupported answers are refused or marked as unsupported.

### Phase 6: Dashboard and Timeline

Deliverables:

- Company dashboard.
- Financial facts panel.
- Filing coverage panel.
- Risk theme extraction.
- Event timeline.
- Filing-level summaries.
- Multi-year company synthesis.
- Open questions panel.

Definition of done:

- User can get a useful first-pass understanding of a company in 5-10 minutes.
- Generated text is backed by source citations.
- Dashboard clearly shows what data was processed.

### Phase 7: Packaging and Self-Hosting

Deliverables:

- Production Dockerfile.
- Docker Compose deployment profiles.
- Bind mount documentation.
- Backup and restore docs.
- GPU runtime documentation.
- External API configuration docs.
- Health checks.

Definition of done:

- User can run secThing from a clean checkout.
- User data survives container recreation.
- User can select local or external model provider.

### Phase 8: Hardening and Quality

Deliverables:

- Parser test corpus.
- Unit tests for SEC fetchers.
- Integration tests for ingestion.
- Prompt regression tests.
- Job retry and resume logic.
- Basic authentication.
- Observability and logs.
- Error reporting in UI.

Definition of done:

- Ingestion failures do not corrupt company state.
- Jobs can resume.
- Core behavior is covered by automated tests.

## 13. MVP Scope

The MVP should include:

- Docker Compose local deployment.
- Frontend portal.
- Backend API.
- Worker process.
- PostgreSQL with pgvector.
- Ticker to CIK resolution.
- SEC submissions ingestion.
- SEC companyfacts ingestion.
- 10-K, 10-Q, and 8-K filing download.
- Filing text extraction.
- Chunking and embeddings.
- Semantic search.
- Cited RAG chat.
- Basic company dashboard.
- Ollama local model support.
- External OpenAI-compatible endpoint support.

The MVP should not initially include:

- Perfect parsing for every historical filing.
- Full investment memo generation.
- Support for every SEC form.
- Multi-user enterprise auth.
- Complex plugin architecture.
- Separate vector database.
- Advanced portfolio tracking.

## 14. Key Risks and Mitigations

### Compute Cost

Risk:

- Processing many years of filings with local models can be slow and expensive.

Mitigation:

- Use deterministic parsing first.
- Use embeddings for retrieval.
- Run LLM extraction selectively.
- Cache outputs by source hash, model, and prompt version.

### Long Context Overuse

Risk:

- Passing huge filings into long-context models is slow, expensive, and makes citations harder.

Mitigation:

- Use retrieval-first workflows.
- Use filing sections and chunks.
- Use long context only for bounded synthesis tasks.

### Weak Citations

Risk:

- The chatbot may produce claims without reliable evidence.

Mitigation:

- Store source metadata on every chunk.
- Require citations in output schema.
- Prefer raw filing text over summaries.
- Show source snippets in the UI.

### Messy Filing Formats

Risk:

- SEC filings vary heavily across firms, years, and formats.

Mitigation:

- Start with recent filings.
- Build parser tests from real filings.
- Preserve raw files.
- Allow partial ingestion success.

### Overbroad Topic Taxonomy

Risk:

- Event and topic categories could become too large or too vague.

Mitigation:

- Start with a small fixed taxonomy:
  - Financial performance
  - Risk factor
  - Legal/regulatory
  - Management/governance
  - M&A/strategic transaction
  - Debt/capital structure
  - Product/business change
  - Customer/supplier concentration
  - Market/competition
  - Accounting/control issue
- Allow secondary freeform tags without making them primary schema.

### False Sense of Completeness

Risk:

- Users may treat the tool as complete diligence or investment advice.

Mitigation:

- Use clear product framing.
- Include evidence coverage.
- Include disclaimers.
- Surface open questions and missing data.

## 15. Initial Implementation Order

Recommended build order:

1. Create repo structure.
2. Add backend API skeleton.
3. Add database and migrations.
4. Add frontend shell.
5. Add Docker Compose.
6. Implement ticker to CIK resolver.
7. Implement SEC submissions fetcher.
8. Persist companies and filing metadata.
9. Download raw filings.
10. Parse filing text.
11. Add filing browser UI.
12. Add chunking.
13. Add embeddings.
14. Add semantic search.
15. Add Ollama/OpenAI-compatible provider abstraction.
16. Add cited RAG chat.
17. Add company dashboard.
18. Add XBRL financial facts view.
19. Add timeline extraction.
20. Harden packaging, tests, and docs.

## 16. First Coding Target

The first coding milestone should be:

> A local Docker Compose app where the backend can resolve a ticker, fetch SEC submissions metadata, store the company and filing list in PostgreSQL, and expose that data to a minimal frontend.

This creates the spine for the rest of the project.
