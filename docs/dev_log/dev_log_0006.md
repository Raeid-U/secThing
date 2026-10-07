# secThing

## Development Changelog

**Prepared:** 2026-10-07  
**Project:** secThing, a local-first, evidence-first SEC filing research workbench  
**Purpose:** This entry continues `dev_log_0005.md` with the validated local Ollama deployment, the source-to-normalized-evidence backend, the first usable research-record interface, the company-detail production fix, and the agreed retrieval-first backend sequence.

---

## 1. Continuity

`dev_log_0005.md` left secThing with SEC identity resolution, company profiles, filing metadata, a durable PostgreSQL work queue, and a local-AI configuration foundation. It did not yet preserve filing sources, parse filing evidence, or provide a usable filing inspection surface.

This increment established that evidence backbone. It also confirms that the intended Windows 11, WSL2, Docker Desktop, NVIDIA, and Ollama deployment is viable before the system begins embedding or generating derived artifacts.

## 2. Local AI Runtime Verified on the Target Host

Ollama is the sole supported first local provider. The platform module owns model discovery, fixed diagnostic chat, embeddings, bounded HTTP timeouts, and runtime inspection. Compose, rather than application code, owns the GPU setup.

The target host completed the intended smoke test:

- `qwen2.5:3b` and `nomic-embed-text` were pulled into the persistent Ollama volume.
- `GET /api/v1/system/ai/status` reported local Ollama availability and both configured models.
- `POST /api/v1/system/ai/verify` returned the expected `ready` response from `qwen2.5:3b`.
- The cold verification took about 18 seconds.
- `ollama ps` reported the chat model using `100% GPU`.

This proves backend-to-Ollama connectivity through Docker Desktop/WSL2 with NVIDIA acceleration. Worker-driven embeddings, retrieval, model-run audit records, and generated artifacts remain future work.

## 3. Optional-AI Configuration Repair

The initial Windows Compose failure was a configuration-validation issue, not an image build problem. Empty Compose substitutions for optional AI values were treated as supplied invalid values. The configuration now normalizes blank optional strings and the embedding dimension to `undefined`; disabled mode therefore works with the example environment while enabled local mode still requires real settings. A regression test covers the behavior.

## 4. Durable Filing Source Acquisition

The worker now preserves source documents behind the `SecClient` module. Given CIK, accession, form, and an optional primary-document hint, it:

- derives the SEC archive directory;
- fetches and caches the archive index;
- validates the hinted document or selects a form-matching primary document;
- rejects unsafe filenames;
- stores downloaded content under a hash-addressed durable path; and
- records source metadata and status in PostgreSQL.

Migration `0004_filing_source_acquisition.sql` introduced `filing_documents` and a filing reference on `work_items`. Supported filing work queues source acquisition, persists source URL/path/content hash/content type/size, moves successful filings to `source_acquired`, and leaves retryable failure state visible. The target host confirmed that preserved sources appear in real company records.

## 5. Deterministic Parsing and Provenance

`FilingParser` is deliberately deterministic and does not call an LLM. It normalizes HTML or text into readable evidence, removes non-content markup, decodes common entities, writes normalized text to durable hash-addressed storage, identifies an initial form-aware set of headings, and reports explicit warnings.

Migration `0005_deterministic_filing_parsing.sql` introduced:

- `normalized_documents`, with parser version, source and normalized hashes, path, length, status, and warnings;
- `source_spans`, using offsets within normalized text;
- `filing_sections`, linked to source spans; and
- document-level work-item correlation.

Successful source acquisition queues parsing. Parsed output, source spans, and detected sections are committed transactionally. Parser/version or source-hash changes invalidate the prior parse rather than silently reusing it. If headings cannot be detected, an `unknown` section retains the whole document for later search. The API now exposes targeted acquisition, targeted parsing, and parsed-document reader endpoints.

## 6. Research-Record Frontend

The initial frontend was reshaped around the actual current evidence flow instead of future AI capabilities:

1. add or reopen a company record;
2. assess catalogue, source, and parse coverage;
3. acquire or parse an individual filing where needed; and
4. inspect normalized evidence and detected sections.

The records screen is now a compact dark research desk with a persistent company library, ticker/lookback intake, issuer brief, overflow-safe filing ledger, clear source/parse states, and an in-page normalized-source reader. The user specifically rejected oversized headings, surplus whitespace, decorative copy, generic card grids, and terminal-themed styling. The resulting direction is deliberately closer to an operational Supabase/DigitalOcean-style console: compact, informative, and plain-language.

## 7. Company Selection Production Fix

Target-host logs exposed the reason company selection appeared broken: the company-detail query selected an unqualified `status` in a subquery joining `normalized_documents` and `filing_documents`. PostgreSQL correctly returned `42702: column reference "status" is ambiguous`, producing a 500 response.

The query now explicitly selects `normalized_documents.status`. The frontend also makes selection loading and non-OK detail responses visible, rather than silently leaving the prior ledger on screen. The target Compose stack must be rebuilt to pick up that backend fix.

## 8. Validation Performed

- `npm run check` passed.
- `npm test` passed with 17 tests.
- `npm run build` passed.
- Base and NVIDIA Compose configuration validation passed.
- Disposable pgvector PostgreSQL instances successfully applied the migrations through `0005`.
- Source-acquisition tests cover archive selection and durable hash-addressed preservation.
- Parser tests cover HTML normalization, entity decoding, text persistence, form-aware section offsets, plain-text handling, and unknown-section fallback.
- The target host exercised source acquisition and verified local Ollama chat/runtime status.

The target host should still explicitly exercise a parsing job if that was not completed after the current image rebuild.

## 9. Agreed Next Backend Direction

The next backend implementation is a **Searchable Evidence Bank**, beginning with chunking and full-text retrieval before semantic retrieval, RAG, or dashboards. This slightly interleaves the FRD’s listed XBRL and retrieval phases intentionally: parsed evidence plus a verified local embedding runtime make search the most useful immediate vertical slice, while it also remains fully useful with AI disabled.

The first retrieval increment will:

- add provenance-linked, section-aware chunks with deterministic hashes and profile-version invalidation;
- queue chunking from successful parses;
- index chunks for PostgreSQL full-text search;
- expose company-scoped search with filing/form/date/section filters and reader-openable snippets; and
- prove the full source → parse → chunk → index → search path using fixtures.

Semantic embeddings and deterministic hybrid retrieval follow only after keyword search is independently useful. XBRL/companyfacts normalization follows as the separate deterministic financial-facts track. Cited RAG, structured extraction, dashboard assembly, and deployment hardening remain downstream and must preserve the evidence-first rule.

The retrieval work should use deep modules with small interfaces, such as `ChunkingAndIndexing.process(parsedDocument)` and `Retrieval.search(companyId, query, filters)`. Routes and UI must not own chunk boundaries, vector dimensions, or provider payload details.

## 10. Current State and Safe Continuation

secThing can now resolve a company, catalogue filings, preserve source material, parse and retain normalized evidence with provenance, and display that evidence locally. The immediate implementation target is the full-text portion of searchable evidence; do not begin RAG or dashboard synthesis first.

After the next retrieval slice, validate against a real processed company on the Windows/WSL2 target in addition to fixture tests. Finish the product with XBRL facts, cited RAG, persisted dashboard artifacts, and clean-checkout Docker deployment/backup/restore documentation for the portfolio demonstration.
