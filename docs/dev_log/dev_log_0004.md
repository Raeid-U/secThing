# secThing

## Development Changelog

**Prepared:** 2026-09-16  
**Project:** secThing, a local-first, evidence-first SEC filing research workbench  
**Purpose:** This entry consolidates the work completed after `dev_log_0003.md`: the records-oriented Next frontend, development-server hardening, expanded SEC company-profile metadata, compliant SEC access configuration, and the verified local ingestion state at session close.

---

## 1. Continuity Note

`dev_log_0003.md` ended with the initial Next.js migration operational in Docker Compose after a stale dependency-volume correction. The project had the CIK-based company/filing metadata pipeline described in `dev_log_0002.md`, but the product surface was still cramped on one page and the SEC profile stored only a narrow identity subset.

This increment separates the research workflow into dedicated pages, adds profile data exposed by SEC submissions responses, and makes the SEC access policy explicit in code, configuration, documentation, and tests.

## 2. Records-Oriented Frontend

The frontend now uses a two-page workflow:

- `/home` is the focused readiness landing page. It shows the system checks and a single `Enter the records` action.
- `/records` contains the persistent company library, ticker/date intake, processing feedback, and filing catalogue.
- `/` redirects to `/home`.

The shared masthead provides Home and Records navigation. The existing Swiss/International Typographic Style system was retained while the information hierarchy became more deliberate: system readiness precedes research records, and record creation/browsing no longer competes with landing-page orientation.

The intake default changed from five years to three years while retaining an explicit date field. The selected start date remains the lower bound through today; widening it queues incremental metadata work and never removes existing filing records.

## 3. Development-Server Stability

Next 16.3.5’s default Turbopack development server produced an internal `turbo-tasks` panic after the route split. This was an upstream development-compiler failure, not an application TypeScript or route error.

The frontend development command now uses the documented `next dev --webpack` fallback. Compose clears the disposable frontend `.next` cache on startup, reconciles the persistent dependency volume against the lockfile, and then starts the webpack development server. The Compose frontend was recreated and verified serving both `/home` and `/records`.

Production builds remain separate from the development-server choice.

## 4. SEC Company Profile Metadata

### Why SEC-first metadata

The SEC submissions API is authoritative for issuer identity and provides useful descriptive profile data without downloading or parsing filing documents. It does not reliably provide C-suite personnel, founders, founding date, main products, or operating footprint. Those fields were intentionally not guessed or mislabeled as SEC facts.

`PRD-META-002` permits future Wikipedia, Wikidata, company-site, or other enrichment only when attribution is explicit and visually distinguishable. No secondary-source ingestion was added in this increment.

### What now persists

Migration `0003_sec_company_profile.sql` extends `companies` with:

- SEC SIC description in addition to SIC code;
- entity type;
- incorporation jurisdiction and description;
- business and mailing addresses as structured JSON;
- business phone.

The SEC client parses these optional fields from the submissions response. The worker upserts them together with legal identity, current ticker/exchange aliases, fiscal year end, former names, and filing metadata. The company-detail API returns the profile, and `/records` displays SEC industry, entity type, incorporation jurisdiction, and SEC-reported business address beside the filing index.

The filing catalogue remains accession-idempotent on `(cik, accession_number)` and stores all enumerated forms while marking the current MVP support set (`10-K`, `10-Q`, `8-K`, and amendments).

## 5. SEC Access Policy and Rate Limiting

The `.env.example` and `README.md` now state that secThing uses official SEC data APIs, is not intended to scrape SEC website pages, and never exposes SEC calls to browser code.

The required final-user configuration is documented as a descriptive User-Agent with a real contact address, for example:

```dotenv
SEC_USER_AGENT="secThing/0.1.0 PersonalUse your-name@example.com"
SEC_RATE_LIMIT_PER_SECOND=5
```

The configured rate defaults to 5 requests/second and configuration rejects anything above 10. Compose now passes the setting to both backend and worker. `SecClient` additionally serializes requests within a process before applying the configured spacing, so concurrent callers cannot burst above the configured ceiling. Response caching and bounded retry/backoff remain in place.

For the session’s development check, the user authorized `dafish015@gmail.com` as the runtime burner contact. It was supplied only to the running development backend/worker, not committed as the final-user example.

## 6. Validation and Observed Live State

Completed validation:

- `npm run check` passed.
- `npm test` passed with 8 tests.
- Tests cover LINC mapping to CIK `0001286613`, submissions metadata parsing, historic submission merging, supported-form classification, rate ceiling rejection, and serialized concurrent SEC requests at the 10/second ceiling.
- Compose configuration validation passed.
- Migration smoke test applied and confirmed `0001_foundation.sql`, `0002_company_identity_and_metadata.sql`, and `0003_sec_company_profile.sql`.
- The webpack development server served `/home` and `/records` in Compose.

### Local live-ingestion result

Two local LINC intake jobs were accepted and persisted as durable jobs. In this container environment, both exhausted their retry budget at the identity stage with `fetch failed`; no company or filing rows were created. The final database inspection at session close showed:

- zero companies;
- zero filings;
- jobs `1` and `2` in `partial` state, both for LINC with no attached company;
- all three migrations current.

This is an outbound container connectivity/TLS issue observed during live SEC access, not a successful stored-data result. A deployment with verified HTTPS egress to SEC data endpoints and a real final-user contact User-Agent remains required for the first real company record.

## 7. Current State and Recommended Next Direction

The system is ready at the application level for a three-year SEC metadata onboarding test: persistent schema, worker stages, idempotent company/filing catalogue, expanded SEC profile metadata, UI, configuration, cache paths, rate limiting, and user-visible state are all present.

The next session should begin by resolving the deployment egress issue and verifying a real LINC response persists a company profile and filing list. Once that succeeds, add database-backed integration coverage for successful upserts, re-adding an existing ticker, and widening the date range. Only then advance to FRD Phase 3 source acquisition: filing index retrieval, primary-document selection, immutable raw source storage, and filing-level download state.

Do not add C-suite, founder, founding-date, products, or operating-footprint enrichment until a source-attribution model and explicit secondary-source policy are implemented.
