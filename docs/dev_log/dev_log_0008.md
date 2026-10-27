# secThing — Development Log 8

**Prepared:** 2026-10-27

**Scope:** Complete-evidence corpus foundations, structured financial facts,
bounded grounded answers, company-scoped research UI, and safe company/corpus
deletion.

**Previous checkpoint:** [Development Log 7](dev_log_0007.md), published
2026-10-23.

**Status:** The initial grounded-research and data-lifecycle slice was accepted and
merged into `main`. Development now continues on
`feature/conversational-grounded-answers`; the next frontend redesign remains a
separate later phase.

## 1. Continuity and reason for this phase

Development Log 7 established the accepted light-first company library, search,
and evidence-reader experience. It intentionally stopped short of cited question
answering because reliable generation first required complete source discovery,
retained evidence generations, traceable financial facts, strict corpus readiness,
and enforceable citation contracts.

This phase built that foundation using the existing PostgreSQL full-text and
pgvector architecture. It did not add a second vector store, durable chat history,
cross-company analysis, investment recommendations, or autonomous agents.

The implementation sequence was deliberately incremental:

1. immutable evidence generations and schema foundations;
2. complete SEC filing manifests, lifecycle observability, retry, and readiness;
3. traceable companyfacts and normalized financial metrics;
4. bounded evidence packages and deterministic question analysis;
5. provider adapters, validated structured answers, audits, and guarded APIs;
6. a minimal company-scoped “Ask the filings” UI;
7. reliability hardening, PDF provenance, lifecycle tests, and deletion controls.

Search remains available while ingestion is incomplete. Generated answers unlock
only after the corpus is operationally complete.

## 2. Core evidence and lifecycle decisions

### Immutable generations

Reprocessing no longer destroys earlier normalized evidence. Each source document
can have numbered normalized-document generations, with only one active generation
used for current retrieval. Superseded documents, spans, sections, chunks, and
embeddings remain resolvable for citations saved in earlier model runs.

Migration `0008_grounded_research.sql` introduced the generation model, document
stage and failure metadata, raw and normalized financial-fact storage, external
embedding approvals, and model-run audits. Migration `0009_pdf_provenance.sql`
added retained PDF page mapping.

### Complete manifest before transfer

SEC acquisition now discovers and classifies the authoritative filing-directory
manifest before downloading bodies. Primary HTML, text, and PDF filings and
human-readable exhibits are in scope. Images, stylesheets, viewer assets, and
technical XBRL support files are retained as manifest metadata with explicit
exclusion reasons rather than as unusable source bodies.

Manifest persistence is separate from body transfer. Each successful body is saved
individually and skipped on retry, so a later exhibit failure cannot erase earlier
progress or hide known exclusions. Filing-level acquisition failures receive a
durable `__manifest__` placeholder and therefore remain visible and retryable.

### Bounded failure and readiness policy

Documents move through discovered, downloaded, parsed, chunked, and embedded
stages. Ordinary worker failures and expired-lease recovery share the same terminal
policy: after three failed attempts, the item is auto-excluded with a visible
reason. Auto-exclusion permits operational completeness while remaining disclosed
in corpus coverage and can be cleared by an explicit retry.

Readiness requires every in-scope document to be indexed under the active versions
or auto-excluded, structured financial ingestion to be complete, and the active
embedding profile to cover every active chunk. Local Ollama embeddings do not need
approval. External corpus embeddings require an estimate and approval bound to the
exact company, profile, and corpus fingerprint; a new evidence generation makes an
old approval stale.

## 3. Parsing and provenance

The parser now handles human-readable exhibits and PDF sources. PDF extraction
retains normalized offsets and one-based page ranges, allowing an answer citation
to reopen the exact retained generation and identify its source page. Parser
version `filing-text-v3` intentionally invalidates earlier active parses for
non-destructive reprocessing.

Binary SEC responses are written as bytes, preventing PDF corruption. A generated
two-page PDF fixture verifies extraction and page mapping without depending on a
remote sample.

## 4. Structured financial evidence

Company metadata ingestion now queues SEC companyfacts acquisition. Raw source
payloads are retained, and normalized facts preserve:

- accession and filing form;
- period and filing dates;
- taxonomy concept and unit;
- raw-source reference;
- selected/conflicting status.

The explicit concept map covers revenue, net income, assets, liabilities, cash,
operating cash flow, debt, shares, and EPS. Conflicting values are retained rather
than averaged; the newest filed value is selected and alternatives are marked as
conflicts. EBITDA remains narrative evidence because no non-GAAP inference or
silent reconciliation is allowed.

## 5. Evidence packages and retrieval

`Retrieval` now exposes a bounded `EvidencePackage` rather than leaking the
full-text/vector mechanics to answer generation. Deterministic query analysis
recognizes dates, every explicitly named supported filing type, financial aliases,
numeric intent, and comparison/change intent. The complete user question remains
the semantic query.

Packages combine lexical and semantic candidates with reciprocal-rank fusion and
can add structured facts, filing/date/section diversity, and immediately adjacent
chunks from the same retained section. Every package carries stable citation
labels, retained-generation locators, token accounting, filing-date coverage, and
disclosed exclusions. Context selection reserves output capacity and favors useful
diversity over filling the provider window.

## 6. Grounded answer boundary

`GroundedAnswer` accepts a company and question while keeping retrieval, prompts,
provider payloads, schema handling, and citation checks internal. Ollama remains the
primary local path; OpenAI-compatible chat and embedding transports are configured
through the environment.

The provider must return structured findings, interpretation, limitations, and
citations. Validation rejects unknown evidence IDs and unsupported factual claims.
Malformed output is retried once; a second failure returns an explicit evidence-only
result rather than unsupported freeform prose. Insufficient retrieval produces an
insufficient-evidence response, and investment advice remains outside scope.

Each model run records provider/model identity, prompt and schema versions,
evidence generations and cited IDs, token estimates, raw structured output,
validation result, latency, and timestamps.

The backend now exposes:

- `GET /api/v1/companies/:companyId/corpus` for readiness and coverage;
- `POST /api/v1/companies/:companyId/corpus/retry` for retryable exclusions;
- `POST /api/v1/companies/:companyId/embeddings/approve` for exact external
  estimates;
- `POST /api/v1/companies/:companyId/questions` for guarded grounded answers;
- retained-generation evidence-reader locators for exact source reopening.

Question submission returns `409` with corpus status until readiness is satisfied.
Submitting a question authorizes only its bounded evidence package to be sent to
the configured chat provider.

## 7. Initial research interface

The company workspace gained a deliberately small “Ask the filings” surface. It
shows processing stages, coverage, exclusions, retry and approval actions before
readiness, then renders findings, interpretation, limitations, and exact sources.
Selecting a citation opens the existing evidence reader at the retained generation,
passage, and PDF page when available.

Only the current question and answer live in UI state. Prior generated prose is not
treated as evidence, and no durable conversation model was introduced.

This first rendering is intentionally evidence-led and citation-safe. User review
found that it reads too much like retrieved excerpts. The next phase will make the
answer more conversational and question-aware while preserving the same evidence
and validation boundary.

## 8. Company and corpus deletion

The phase also added the previously missing data-lifecycle controls.
`CompanyDataLifecycle` supports two distinct transactional operations:

- deleting a corpus while retaining the company identity for later re-ingestion;
- deleting the company and all of its owned data.

Corpus deletion removes company jobs, filings, source documents, every retained
evidence generation, chunks and embeddings, companyfacts and normalized facts,
embedding approvals, and model-run audits, then clears requested coverage. Company
deletion performs that cleanup and removes the identity and ticker metadata.

The APIs are:

- `DELETE /api/v1/companies/:companyId/corpus`, requiring `DELETE CORPUS`;
- `DELETE /api/v1/companies/:companyId`, requiring the exact legal company name.

Database deletion commits transactionally. Filesystem cleanup happens afterward,
is restricted to `DATA_DIR`, only unlinks files with no remaining database
reference, and reports cleanup problems without pretending the committed database
operation failed.

The records toolbar exposes deletion through a quiet Manage action and one native
modal. Corpus and company deletion have separate sections; destructive actions stay
disabled until the exact confirmation matches. Focus is restored on close, corpus
deletion clears selected research state, and company deletion returns to the
library.

## 9. Reliability corrections made during validation

SEC index file sizes are now accepted as strings or numbers. Lease recovery applies
the same exclusion semantics as ordinary processing failures. A timing-sensitive
real-worker test now waits for worker startup before expiring its lease instead of
assuming compilation completes within three seconds under parallel load.

The Windows-mounted worktree exposed two environmental issues:

- stale Next output could not always be removed because of `ENOTEMPTY`; a build to
  a fresh `NEXT_DIST_DIR` succeeded;
- loose Git objects were unreadable after creation on the mount. New objects are
  temporarily stored in `/tmp/secthing-git-objects`, referenced through Git's
  alternates file. That directory must not be removed until objects are pushed or
  durably repacked.

## 10. Validation milestone

Validation completed for this phase:

- all **75 Vitest tests passed** across 12 files;
- this included **33 PostgreSQL/pgvector integration cases**;
- all seven PostgreSQL work-lease tests passed;
- focused tests covered immutable generation retention, complete manifests,
  financial mapping/conflicts, evidence packaging, guarded readiness, exact
  external approval, citation validation/fallback, PDF provenance, and deletion;
- workspace checks and frontend TypeScript checks passed;
- a production frontend build passed using a fresh output directory;
- Playwright discovered all seven browser scenarios, including deletion
  confirmation.

Full browser execution was not possible because no browser binary was installed and
the earlier Chromium download attempt received CDN HTTP 403. The target
Ollama/NVIDIA real-model evaluation also remains outstanding. The phase therefore
proves contracts, integration, compilation, and deterministic behavior, but not yet
final real-model response quality or browser-level deletion interaction.

## 11. Resulting system state

The repository now has a complete initial path from SEC manifest discovery through
retained evidence, structured facts, embeddings, bounded retrieval, validated
answers, source reopening, and audited model runs. Corpus state is observable and
retryable, terminal failures are disclosed rather than hidden, and users can safely
remove either accumulated evidence or an entire company.

The accepted feature branch was merged into `main` as the initial grounded-AI and
deletion baseline. Development continues from that merge on
`feature/conversational-grounded-answers`.

Still outstanding:

- target Ollama/NVIDIA relevance, support, latency, and context-size evaluation;
- executable browser coverage when a browser becomes available;
- conversational synthesis of the existing validated evidence package;
- a later frontend redesign that separates AI conversation from the crowded
  records/research surface;
- durable multi-turn context, reranking, cross-company questions, and autonomous
  behavior, all still intentionally deferred.

## 12. Recommended next direction

Improve answer composition without changing the evidence contract. The response
should acknowledge the question, turn each useful source into a concise
question-aware statement, connect the statements into a coherent explanation, end
with a short grounded synthesis, and invite inspection of the cited sources.

Every factual or interpretive statement must remain supported by an evidence ID.
Conversational transitions and framing must not become a route for uncited claims.
The response work should be completed and validated on its current branch before a
separate frontend-reorganization branch begins.

## 13. Decisions carried forward

1. PostgreSQL full-text search and pgvector remain the only retrieval store.
2. Human-readable filings and exhibits are in scope; technical assets are recorded
   as explicit exclusions.
3. Old evidence generations remain citation-resolvable after reprocessing.
4. Three terminal failures auto-exclude an item without hiding it or preventing
   later retry.
5. External corpus embedding requires exact estimate-bound approval; local Ollama
   processing does not.
6. Structured financial conflicts are retained, and non-GAAP values are not
   inferred.
7. Generated answers require corpus readiness, bounded evidence, structured output,
   and citation validation.
8. Company identity deletion and corpus-only deletion remain distinct, explicitly
   confirmed operations.
9. Conversational answer synthesis comes next; frontend restructuring comes after
   it and must remain a separate phase.
