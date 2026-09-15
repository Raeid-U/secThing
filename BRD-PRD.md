# secThing BRD/PRD

Status: Authoritative product requirements  
Project name: secThing  
Last updated: 2026-09-15

This document defines what secThing is, why it exists, who it serves, and what product behavior is required. It intentionally avoids implementation details such as database schemas, queue mechanics, Docker syntax, and low-level algorithms. Those belong in `FRD.md`.

## 1. Executive Summary

secThing is a self-hosted SEC filing research workbench for first-contact public-company research. A user enters a ticker, chooses a historical lookback window, and secThing builds a persistent local company knowledge bank from SEC filings, structured SEC data, and source-linked derived research artifacts.

secThing exists to reduce the friction between "I heard about this company" and "I understand what this company does, how its disclosures have developed, which filings matter, what risks and events recur, what financial trends are visible, and where I should inspect the primary evidence myself."

secThing is not an investment advisor, stock picker, or due-diligence replacement. It is a research acceleration and evidence access tool.

## 2. Problem Statement

Company research from SEC filings is valuable but tedious. A user must identify the right company, resolve ticker and CIK details, collect filing histories, download filings, parse inconsistent document formats, inspect financial data, compare disclosures across time, and keep track of source evidence.

Large language models can help, but naive use creates new problems:

- large filing histories are expensive to repeatedly send to external services;
- generated summaries can obscure or distort source evidence;
- citations are often weak if provenance is not designed from the beginning;
- long-context workflows can waste local compute and still fail at precise retrieval;
- users with local hardware should not be forced into closed-source APIs for basic research workflows.

secThing addresses this by preserving raw SEC evidence, extracting deterministic data where possible, using local-first retrieval and AI selectively, and making provenance visible throughout the product.

## 3. Product Vision

secThing should feel like a self-hosted research appliance:

- easy enough to run locally through a containerized deployment;
- durable enough to keep company corpora across restarts and upgrades;
- transparent enough that users can inspect the primary filings behind claims;
- flexible enough to use local models, external APIs, or reduced-capability modes;
- disciplined enough to say when evidence is insufficient.

The product should bridge the gap between reading for information and reading for understanding without pretending to complete the user's analysis for them.

## 4. Product Principles

### PRD-PRI-001: Evidence Before Generation

Raw SEC filings and structured SEC facts are primary evidence. Generated summaries, classifications, timelines, themes, and chat answers are derivative artifacts.

Important generated factual claims must expose their supporting source material wherever technically practical.

### PRD-PRI-002: Local-First, Provider-Agnostic AI

The product must be useful with self-hosted models and must not require a closed-source provider. External providers may improve capability, speed, or quality, but must remain optional.

### PRD-PRI-003: Deterministic Before Generative

When a fact can be extracted deterministically from SEC metadata, filing structure, or XBRL facts, secThing should not ask a language model to infer it.

### PRD-PRI-004: Partial Progress Is Useful

Company ingestion may take time and may encounter malformed filings. Partial ingestion must still produce useful visible results, and one failed filing must not invalidate unrelated successful work.

### PRD-PRI-005: Transparent Limits

secThing must clearly communicate processed coverage, missing evidence, parse failures, model limitations, and unsupported answers.

### PRD-PRI-006: No Investment Advice

secThing may summarize disclosures and surface evidence. It must not recommend buying, selling, holding, timing, or valuing a security.

## 5. Target Users and Personas

### Independent Researcher

An individual investor, journalist, student, or curious market observer who wants a first-pass understanding of a public company without manually collecting filings.

Needs:

- fast company onboarding;
- searchable filings;
- plain-language summaries with citations;
- clear warnings about incompleteness.

### Technical Self-Hoster

A user comfortable running Docker services and configuring local hardware or model endpoints.

Needs:

- simple deployment;
- durable storage;
- configurable model providers;
- visible worker and ingestion state.

### Analyst or Operator

A user who repeatedly reviews companies and wants structured disclosure history rather than one-off document summaries.

Needs:

- persistent company library;
- filing coverage view;
- financial trends;
- recurring risk and event tracking;
- reliable links back to primary evidence.

## 6. Jobs To Be Done

JTBD-001: When I encounter a company ticker, I want to build a local filing corpus so that I can inspect the company without manually gathering filings.

JTBD-002: When reviewing a company, I want a dashboard of source-backed facts, themes, financial trends, and events so that I can decide where to focus manual reading.

JTBD-003: When I have a specific question, I want to search and chat over the company's filings with citations so that I can quickly find relevant evidence.

JTBD-004: When generated output makes a claim, I want to inspect the underlying SEC source so that I can judge whether the claim is supported.

JTBD-005: When my local hardware is limited, I want the product to degrade gracefully so that basic filing collection, browsing, and search remain useful.

## 7. Goals

### PRD-GOAL-001: First-Contact Research Acceleration

A user should be able to move from ticker entry to a useful company research surface with materially less effort than manually using EDGAR.

### PRD-GOAL-002: Persistent Local Knowledge Bank

Companies, filings, parsed content, financial facts, generated artifacts, and provenance metadata should persist across application restarts and container replacement.

### PRD-GOAL-003: Source-Inspectable Research

Search results, dashboard claims, extracted events, and chat answers should point users toward supporting filings and source snippets.

### PRD-GOAL-004: Practical Self-Hosting

The product should be deployable by a technically capable user without requiring bespoke infrastructure.

### PRD-GOAL-005: Compute Discipline

The product should avoid repeated expensive processing of unchanged data and should make useful progress before expensive AI synthesis.

## 8. Non-Goals

secThing does not aim to:

- provide investment recommendations;
- produce a complete buy/sell/hold thesis;
- guarantee comprehensive diligence;
- guarantee that SEC filings contain all material company knowledge;
- support every SEC form in MVP;
- perfectly parse all historical filings in MVP;
- require external closed-source models;
- become a general portfolio tracker;
- provide enterprise multi-tenant identity in MVP;
- replace EDGAR, filings, auditors, analysts, or user judgment.

## 9. Assumptions

- The initial user is technically comfortable enough to run a local containerized application.
- SEC filings are the primary evidence source.
- CIK is a more durable company identity than ticker.
- Modern 10-K, 10-Q, and 8-K filings provide enough value to prove the MVP.
- PostgreSQL plus vector search is sufficient for a first self-hosted version from a product perspective.
- Local model quality and speed will vary widely, so the product must express capability levels rather than assuming one model.
- External company metadata may be useful but must be attributed separately from SEC-derived evidence.
- The term "OKF" from early notes is unresolved and should not define product requirements until clarified.

## 10. User Journey

1. User hears about a public company.
2. User obtains a ticker.
3. User opens secThing.
4. User enters the ticker.
5. User selects a lookback window.
6. secThing resolves and confirms the company identity.
7. secThing retrieves company metadata and relevant SEC filing history.
8. secThing downloads and preserves source filings.
9. secThing parses, normalizes, indexes, and extracts structured information.
10. secThing reports progress and partial results.
11. User opens the company dashboard.
12. User reviews company snapshot, filing coverage, financial trends, events, risks, and gaps.
13. User searches or asks questions.
14. secThing returns evidence-linked results.
15. User opens source filings or snippets to verify.

## 11. Core User Flows

### PRD-FLOW-001: Add Company

The user must be able to add a company by ticker and confirm the resolved identity before or during ingestion.

Acceptance criteria:

- The product shows the resolved company name, CIK, ticker information, and any ambiguity requiring user attention.
- If ticker resolution fails, the product explains the failure and allows retry or future manual correction.

### PRD-FLOW-002: Select Research Window

The user must be able to choose a historical lookback window before ingestion.

Required options:

- 3 years;
- 5 years;
- 10 years;
- 20 years;
- 50 years;
- all available data.

Acceptance criteria:

- The product communicates that older windows may take longer and may contain harder-to-parse filings.
- The selected window is retained as part of the company ingestion configuration.

### PRD-FLOW-003: Monitor Ingestion

The user must be able to see ingestion progress and failures.

Acceptance criteria:

- The UI exposes the current major stage, completed stages, failed filings, and whether partial results are available.
- Failed filings are visible as failed items rather than hidden behind a generic company failure.

### PRD-FLOW-004: Inspect Company Research Surface

The user must be able to open a persistent company dashboard after sufficient ingestion has completed.

Acceptance criteria:

- The dashboard indicates evidence coverage before presenting synthesis.
- Generated artifacts are visibly source-backed or marked as unavailable.

## 12. Company Ingestion Experience

### PRD-ING-001: Company Identity Confirmation

Company ingestion must begin by resolving the user-entered ticker to a company identity that includes CIK and company name.

### PRD-ING-002: Durable Ingestion Status

Ingestion must expose persistent status, not only transient console output.

### PRD-ING-003: Partial Ingestion

A company can be partially ingested and still appear in the library if enough information exists to inspect metadata, filing lists, or successfully processed filings.

### PRD-ING-004: Individual Filing Failure Visibility

A failure parsing or processing one filing must be shown at filing level and must not hide successfully processed filings.

### PRD-ING-005: Re-ingestion and Refresh Expectation

Users should expect that a company can later be refreshed to discover new filings without rebuilding unchanged historical data.

MVP may expose refresh manually rather than through scheduling.

## 13. Company Library/Home Experience

### PRD-LIB-001: Company Library

The home view must show companies known to the instance.

Each company item should expose:

- ticker or primary display symbol;
- company name;
- CIK;
- ingestion status;
- filing coverage summary;
- last updated time;
- warning indicator when ingestion is incomplete or failed.

### PRD-LIB-002: Add Company Entry Point

The home view must provide a clear entry point to add a ticker and start ingestion.

### PRD-LIB-003: Reopen Persistent Companies

Previously ingested companies must remain available after application restart and container replacement.

## 14. Dashboard Experience

### PRD-DASH-001: Evidence Coverage First

The dashboard must show what evidence was processed before presenting major conclusions.

Coverage should include:

- selected lookback window;
- forms requested;
- filings found;
- filings downloaded;
- filings parsed;
- filings indexed;
- filings failed or skipped;
- XBRL availability.

### PRD-DASH-002: Company Snapshot

The dashboard should provide a concise company snapshot including SEC-derived identity and basic descriptive metadata.

Descriptive metadata from non-SEC sources must be attributed separately.

### PRD-DASH-003: Financial Trends

The dashboard should expose key financial metrics when available from structured filings or XBRL-derived data.

Numbers should be traceable to source facts and periods.

### PRD-DASH-004: Filing and Event Timeline

The dashboard should expose a timeline of filings and source-backed material events.

### PRD-DASH-005: Disclosure Themes

The dashboard should expose recurring or changing themes in risks, legal/regulatory disclosures, business changes, governance, strategy, and capital structure.

### PRD-DASH-006: Open Questions and Gaps

The dashboard should surface gaps, unsupported areas, and prompts for manual review.

### PRD-DASH-007: No Expensive Page-Load Regeneration

From a user perspective, dashboard views should load from existing processed artifacts or bounded queries. Users should not wait for full AI re-analysis every time a dashboard opens.

## 15. Filing Browsing Experience

### PRD-FILE-001: Filing List

The user must be able to browse filings for a company by form type, filing date, report date, and ingestion status.

### PRD-FILE-002: Filing Inspection

The user must be able to inspect the original filing link and available normalized text.

### PRD-FILE-003: Section Navigation

When section detection succeeds, the user should be able to navigate common sections such as Business, Risk Factors, Legal Proceedings, MD&A, Financial Statements, Controls and Procedures, Management, and Exhibits.

### PRD-FILE-004: Parse Failure Handling

If normalized text or section extraction fails, the filing must remain visible with raw source access and failure details.

## 16. Search Experience

### PRD-SEA-001: Company-Scoped Search

Search must be scoped to a company by default.

Acceptance criteria:

- Search results expose source filing, form type, filing date, section when available, and a source snippet.

### PRD-SEA-002: Full-Text and Semantic Value

The product should support exact or keyword-style search and semantic search behavior over filing content.

### PRD-SEA-003: Metadata Filters

Users should be able to narrow search by form type, date range, and section where available.

### PRD-SEA-004: Search Before Chat

Search must be useful even if no generative chat model is configured.

## 17. RAG/Chat Experience

### PRD-RAG-001: Evidence-Grounded Answers

Chat answers must be grounded in retrieved filing evidence or structured financial facts.

Acceptance criteria:

- An answer containing factual claims must include citations to source material.
- If the indexed corpus does not support the answer, the assistant must say so rather than inventing an answer.

### PRD-RAG-002: Company-Scoped Conversations

Conversations must be scoped to a selected company unless a future product explicitly supports cross-company research.

### PRD-RAG-003: Distinguish Fact From Synthesis

The chat experience must distinguish direct facts, generated synthesis, and areas of uncertainty.

### PRD-RAG-004: No Investment Advice

The chat experience must not provide investment recommendations.

### PRD-RAG-005: Source Inspection

Users must be able to open cited sources from chat answers.

## 18. Source and Citation Experience

### PRD-PROV-001: Visible Provenance

Source provenance must be visible wherever important derived information is shown.

At minimum, a citation should identify:

- company;
- form type;
- filing date;
- accession number when available;
- source document;
- section when available;
- snippet or text span when available.

### PRD-PROV-002: Evidence Hierarchy

The product must distinguish between:

1. raw SEC evidence;
2. deterministic structured SEC-derived data;
3. AI-extracted structured data;
4. generated summaries;
5. generated synthesis;
6. conversational answers.

Generated artifacts must not be presented as equivalent to raw evidence.

### PRD-PROV-003: Generated Claim Traceability

Generated factual claims in persistent artifacts should retain source references when technically practical.

### PRD-PROV-004: Source Gaps

When source support is unavailable, weak, failed, or incomplete, the product must disclose that limitation.

## 19. Company Metadata Requirements

### PRD-META-001: SEC Identity Metadata

Company metadata should include CIK, current known ticker(s), legal name, exchange where available, SIC where available, fiscal year end where available, former names where available, and filing history coverage.

### PRD-META-002: External Metadata Attribution

Basic descriptive metadata from Wikipedia, Wikidata, or other sources may be added later, but it must be attributed and visually distinguishable from SEC-derived evidence.

### PRD-META-003: Ticker Changes

The product should not treat ticker as the durable identity. Users may enter ticker, but the company record should be anchored to CIK.

## 20. SEC Filing Coverage Requirements

### PRD-SEC-001: MVP Forms

MVP filing coverage should prioritize:

- 10-K;
- 10-Q;
- 8-K.

### PRD-SEC-002: Post-MVP Forms

Post-MVP candidates include:

- DEF 14A;
- S-1;
- 20-F;
- 40-F;
- 6-K;
- 13D;
- 13G;
- Form 4.

### PRD-SEC-003: Filing Coverage Disclosure

The product must disclose which forms were requested, found, processed, skipped, or failed.

### PRD-SEC-004: Amendments and Duplicates

The product should identify amended filings and related documents when possible. MVP may display them rather than deeply reconciling them.

## 21. Financial Information Requirements

### PRD-FIN-001: Structured Financial Facts

Financial metrics should be derived from structured SEC/XBRL data where available rather than language-model inference.

### PRD-FIN-002: Traceable Metrics

Displayed financial metrics must include enough period, unit, and source context for the user to verify them.

### PRD-FIN-003: AI Limits Around Numbers

AI-generated text may explain trends using available facts, but must not invent missing numbers or silently reconcile conflicting facts.

### PRD-FIN-004: Missing Data Disclosure

When structured financial facts are unavailable, incomplete, or ambiguous, the product must disclose that.

## 22. Timeline and Event Requirements

### PRD-EVT-001: Filing Timeline

The product must provide a timeline of relevant filings within the selected lookback period.

### PRD-EVT-002: Source-Backed Events

Material event objects should include event date, event type, title, summary, confidence/status, and source references.

### PRD-EVT-003: Event Categories

Events should use a small stable first-level taxonomy with optional secondary tags.

### PRD-EVT-004: Uncertain Event Handling

Uncertain or weakly supported events should be marked accordingly rather than promoted as facts.

## 23. Risk, Legal, Governance, and Business-Change Requirements

### PRD-THEME-001: Recurring Themes

The product should identify recurring and changing disclosure themes across risk, legal/regulatory, management/governance, business/product change, market/competition, accounting/internal controls, and capital structure.

### PRD-THEME-002: Longitudinal Comparison

The product should help users compare how a disclosure topic changes across years, without requiring the user to manually open every filing first.

### PRD-THEME-003: Source-Linked Themes

Themes must link back to supporting filings or sections.

## 24. Product-Level Information Taxonomy

secThing should use a stable first-level taxonomy and allow optional secondary tags.

Initial first-level categories:

| Category | Product meaning |
| --- | --- |
| Financial performance | Revenue, margin, income, cash flow, assets, liabilities, liquidity, operating performance |
| Business/product change | Products, services, segments, customers, operations, strategy |
| Risk | Risk factors and recurring disclosed uncertainties |
| Legal/regulatory | Litigation, investigations, regulation, compliance, permits |
| Management/governance | Executives, board, controls, governance, ownership notes |
| Strategic transaction | M&A, divestitures, financing transactions, restructuring |
| Debt/capital structure | Debt, credit facilities, equity issuance, liquidity, covenants |
| Customer/supplier concentration | Dependence on customers, suppliers, channels, counterparties |
| Market/competition | Industry, competitors, pricing, demand, macro factors |
| Accounting/internal controls | Accounting policy, restatements, controls, audit matters |

### PRD-TAX-001: Taxonomy Versioning Expectation

Users should be able to understand which taxonomy version was used for persistent generated artifacts after future taxonomy changes.

## 25. Historical Lookback Behavior

### PRD-HIST-001: User-Selected Lookback

The product must honor the selected lookback window when enumerating filing candidates.

### PRD-HIST-002: Older Filing Caveat

The product must communicate that older filings may be less structured, harder to parse, or less complete.

### PRD-HIST-003: Expansion-Friendly Design

MVP may focus on recent filings, but product behavior must not assume all filings are modern inline-XBRL HTML documents.

## 26. Partial Ingestion and Error Recovery Expectations

### PRD-ERR-001: Observable Failures

Errors must be visible at the correct level: company, filing, document, parse stage, embedding stage, or AI artifact stage.

### PRD-ERR-002: Retriable Failures

The user should be able to retry failed company or filing processing without deleting the whole company record.

### PRD-ERR-003: Durable Progress

Restarting the application should not erase completed ingestion progress.

## 27. Model and Hardware Capability Tiers

Capability should be expressed by product behavior, not by hard-coded GPU model names.

| Capability tier | Product behavior |
| --- | --- |
| No generative model | Company metadata, filing lists, raw source browsing, deterministic financial facts, and keyword search should remain useful. |
| Embeddings only | Semantic search and retrieval previews become available. |
| Small local model | Basic filing summaries and limited extraction may be available, with slower or lower-quality synthesis. |
| Medium local model | More reliable structured extraction, RAG answers, and dashboard summaries become practical. |
| Strong local model | Better multi-year synthesis and longer bounded analysis tasks become practical. |
| External model | Higher-quality or faster extraction/synthesis may be available depending on provider. |

### PRD-CAP-001: Graceful Degradation

The product must not require premium hardware for ingestion, browsing, filing inspection, or basic search.

### PRD-CAP-002: Capability Disclosure

The UI should show which features are unavailable or degraded due to missing model, embedding provider, or hardware configuration.

## 28. Local-First Privacy Expectations

### PRD-LOC-001: Local Corpus by Default

The product should store company corpora and generated artifacts locally in the user's deployment.

### PRD-LOC-002: External API Transparency

When external AI APIs are configured, the product must make clear that retrieved source content may be sent to that provider for generation or embeddings.

### PRD-LOC-003: No Hidden External AI Calls

secThing must not silently call external AI providers when configured for local-only operation.

## 29. Accessibility and Usability Considerations

### PRD-UX-001: Research-Oriented Interface

The interface should feel like a dense but readable research tool, not a marketing site.

### PRD-UX-002: Inspectability

Users should be able to move from summary to source with minimal friction.

### PRD-UX-003: Status Clarity

Long-running ingestion must expose status, progress, and failures clearly.

### PRD-UX-004: Accessibility Basics

Core interactions should support keyboard navigation, readable contrast, accessible labels, and clear focus states.

## 30. Transparency and Gap Disclosure

### PRD-TRANS-001: Evidence Coverage

Every company dashboard must expose evidence coverage.

### PRD-TRANS-002: Generated Artifact Metadata

Persistent generated artifacts should expose model/provider and generation time when relevant to user trust.

### PRD-TRANS-003: Unsupported Areas

The product should surface when it lacks enough evidence to support an answer or summary area.

## 31. Definition of "Complete Enough To Use"

A company is complete enough for initial use when:

- company identity is resolved;
- relevant filing metadata is available;
- at least some selected filings are downloaded or source-linked;
- processed coverage is visible;
- the user can inspect filings or normalized text for successful filings;
- keyword or semantic search is available depending on configured capability;
- dashboard sections clearly show which artifacts are available, pending, failed, or unsupported.

MVP may allow a company to be useful before all AI summaries are complete.

## 32. MVP Product Scope

MVP must prove this vertical slice:

1. Enter ticker.
2. Resolve company identity.
3. Select lookback.
4. Fetch SEC metadata and filing list.
5. Acquire selected 10-K, 10-Q, and 8-K filings.
6. Preserve source material.
7. Parse and normalize filing text.
8. Expose filing browser.
9. Extract structured financial facts where available.
10. Chunk and index filing content.
11. Support company-scoped search with citations.
12. Configure AI provider.
13. Support cited RAG over retrieved evidence.
14. Expose a basic company dashboard.
15. Persist data across container replacement.

## 33. Post-MVP Product Scope

Post-MVP candidates:

- richer form coverage;
- scheduled refreshes;
- DEF 14A governance views;
- insider and ownership views;
- advanced timeline analytics;
- cross-company comparison;
- portfolio-style company collections;
- stronger parser corpus;
- richer table extraction;
- optional object storage;
- additional local runtimes;
- richer authentication;
- collaborative notes.

These should not delay the MVP.

## 34. Explicit Exclusions

MVP excludes:

- automatic buy/sell recommendations;
- valuation models;
- trade execution;
- enterprise SSO;
- multi-tenant permission models;
- perfect historical parsing;
- complete coverage of all SEC forms;
- mandatory external data enrichment;
- mandatory external model usage;
- dedicated search engine infrastructure unless later validated.

## 35. Product Risks

| Risk | Product impact | Required mitigation |
| --- | --- | --- |
| Weak citations | Users may trust unsupported output | Make provenance visible and enforce source-backed generated claims where practical |
| Compute intensity | Users may abandon long ingestions | Show progress, support partial results, avoid unnecessary AI work |
| Filing heterogeneity | Some companies or years process poorly | Preserve raw sources, show failures, allow retry, start with narrow MVP forms |
| Overconfident synthesis | Users may treat output as investment advice | Product framing, disclaimers, unsupported-answer behavior |
| Model variability | Local outputs may differ by hardware/model | Capability disclosure, model metadata, validation |
| Data gaps | SEC filings may not contain all desired business knowledge | Evidence coverage and open questions |

## 36. Success Criteria

### PRD-SUCC-001: Useful First Pass

For a supported company with recent filings, a user can reach a useful research surface within one ingestion session.

### PRD-SUCC-002: Inspectable Claims

Important dashboard and chat claims are source-inspectable.

### PRD-SUCC-003: Reduced Manual Filing Work

The user does not need to manually collect, organize, and search individual SEC filings to begin research.

### PRD-SUCC-004: Local Viability

The product remains useful with local hardware and does not require external AI.

### PRD-SUCC-005: Recoverable Failures

Malformed or failed filings do not destroy the company research surface.

## 37. Major Capability Acceptance Criteria

| Capability | Acceptance criteria |
| --- | --- |
| Add company | User enters ticker, sees resolved company identity, and can start ingestion. |
| Filing coverage | User can see which filings were found, processed, failed, or skipped. |
| Filing browser | User can inspect filing metadata, source link, normalized text, and detected sections when available. |
| Financial facts | Displayed metrics show period, unit, and source context. Missing or conflicting data is disclosed. |
| Search | Results include filing, form type, date, section when available, and snippet. |
| RAG chat | Answers cite evidence or state insufficient support. |
| Dashboard | Company summary, filing coverage, financial trends, events/themes, and gaps are visible without requiring full reprocessing on page load. |
| Partial failure | A failed filing remains visible and retryable while successful filings remain usable. |
| Local-first | Local-only mode does not silently send filing content to external AI providers. |

## 38. Open Product Questions

1. Should Wikipedia/Wikidata enrichment be included in MVP or deferred until the SEC-only workflow is strong?
2. How much dashboard synthesis is enough for MVP without creating a weak "investment memo" impression?
3. Should notes or user annotations be first-class product objects in early versions?
4. What exact wording should the product use for investment-advice disclaimers?
5. Should users be able to manually correct ticker/CIK identity in MVP, or is visible failure plus later correction sufficient?
6. Should 20-F support be included earlier to support foreign issuers, or deferred until domestic issuer support is stable?
7. What did the early "OKF" long-context note refer to? No product requirement should depend on it until clarified.

