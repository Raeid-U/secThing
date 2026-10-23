# secThing — Development Log 7

**Prepared:** 2026-10-23

**Scope:** Light-first frontend and user-experience overhaul through the implemented company library, intake, search, filing, and evidence-reader flows.

**Previous checkpoint:** [Development Log 6, Part 2](dev_log_0006_part2.md), published 2026-10-14.
**Status:** The user reviewed and accepted this frontend phase for merge. Further visual and interaction refinement is intentionally deferred to a later frontend pass.

## 1. Continuity and reason for this phase

Development Log 6, Part 2 left secThing with a functional fixed-frame research workspace, guided company intake, keyword/semantic/hybrid retrieval, and paired original/extracted source inspection. That interface proved the research mechanics but presented them as a compact dark operator console.

The user found that direction too unapproachable for a helpful AI-assisted research application. This phase therefore changed the frontend posture without changing the evidence pipeline or retrieval contracts.

The approved direction was:

- light-first rather than dark-first;
- the company library as the useful application home;
- calm, continuous research surfaces rather than dashboard cards;
- plain language around AI capability and fallback;
- all currently implemented frontend journeys plus reusable foundations;
- no speculative dashboard, chat, or settings screens.

The new `frontend-philosophy` skill was added to the repository and used as the design standard for flat content sections, integrated controls, progressive disclosure, honest status, accessibility, and responsive comparison views.

## 2. Experience and visual decisions

The frontend now uses a cool public-record palette: a pale neutral canvas, white working surfaces, dark ink, restrained blue-green evidence accent, and separate semantic status colors. Alignment, whitespace, typography, and thin rules carry the hierarchy. Filled surfaces are reserved for selection, bounded documents, dialogs, and status that needs attention.

Public Sans and Source Serif 4 are packaged locally as variable fonts. Public Sans carries application controls and navigation; Source Serif is limited to filing text and result excerpts. The browser makes no remote font request.

Search is the dominant interaction. Backend search modes remain `full_text`, `semantic`, and `hybrid`, but the interface presents them as “Exact words,” “Related meaning,” and “Best match.” This makes the capability legible without implying that unfinished generative-chat functionality exists.

The durable experience specification is recorded in [`docs/frontend-ux.md`](../frontend-ux.md), including tokens, page hierarchy, responsive rules, interaction language, and state ownership.

## 3. Library-first application shell

`/records` is now the canonical application surface. `/` and `/home` redirect there, while all existing `/records` query parameters and deep links remain compatible.

The no-company state is a functional library rather than a marketing or readiness page. It provides:

- a clear explanation of the evidence workflow;
- flat company rows with ticker, SEC identity, and processing status;
- direct company reopening;
- an instructive empty state;
- a consistent add-company entry point.

Desktop retains a persistent searchable company rail for fast switching. The rail becomes an overlay at intermediate widths and is hidden by default on phones. The main library and rail share `research/company-library.tsx`, keeping library presentation out of the workspace state/controller component.

System readiness no longer dominates the home page. A compact status control opens an accessible native dialog with service and meaning-search details. Exact-word search is explicitly described as available when AI embeddings are not configured.

## 4. Company research workspace

The selected-company header now emphasizes identity, requested coverage, available searchable passages, meaning-search readiness, and the update action without presenting each value as a separate card.

Search, mode, metadata filters, filter reset, result count, and capability status form one control band. Reset clears only evidence filters; it does not silently discard the selected company, query, reader, or unrelated state.

Filing rows remain newest-first and grouped by year. Search results retain backend ranking and filing grouping. The UI keeps retry, acquire, and processing actions beside the affected filing and distinguishes loading, empty, filtered-empty, fallback, processing, and failure states with actionable language.

The work preserved the existing `useWorkspace` ownership model:

- URL-backed company, filing, query, filter, passage, and document state;
- browser back/forward restoration;
- polling without clearing usable snapshots;
- request cancellation and obsolete-response protection;
- explicit repeated-search refresh behavior.

Frontend types were expanded to represent progress and timestamp fields the API already returned. No backend endpoint, database schema, ingestion rule, or retrieval wire shape changed.

## 5. Intake and evidence inspection

The existing three-step intake flow was restyled and rewritten for clarity while preserving ticker resolution, identity confirmation, lookback options, existing-company behavior, refresh, cancellation, background processing, Escape handling, and trigger-focus restoration.

The desktop reader still compares the sanitized preserved original and normalized extraction side by side with pointer/keyboard resizing. Phones retain explicit Original and Extracted views without page overflow. Search-hit highlighting, section navigation, text sizing, passage navigation, source links, and independent scrolling remain intact.

The former positioned provenance drawer was replaced by a native modal dialog. It provides parser identity, normalized-text hash, selected offsets, indexed passage text, and processing warnings with proper Escape behavior, focus containment, long-content scrolling, and focus restoration.

Automated accessibility review found visible-label/accessibility-name mismatches in the reader controls. The controls were corrected rather than excluding the findings.

## 6. Implementation and dependency changes

Primary frontend seams after this phase are:

| Module | Responsibility |
| --- | --- |
| `company-workbench.tsx` | Workspace orchestration, search/filter state, results, and reader selection |
| `research/company-library.tsx` | Desktop company rail and library-home presentation |
| `research/add-company.tsx` | Guided intake workflow |
| `research/document-reader.tsx` | Original/extracted comparison and provenance dialog |
| `system-status.tsx` | Runtime readiness state and status dialog |
| `research/workspace.css` | Scoped application layout, components, dialogs, and responsive behavior |

New runtime dependencies package the Public Sans and Source Serif 4 fonts locally. `@axe-core/playwright` was added as a development dependency for browser accessibility assertions.

`NEXT_DIST_DIR` may now override the frontend build directory. The default remains `.next`; the override provides a clean validation path when Windows/WSL NTFS leaves an undeletable generated directory after development.

## 7. Validation and visual review

Final validation completed on the feature branch:

- frontend TypeScript check passed;
- Next.js production build passed compilation, TypeScript, static generation, and finalization;
- all **5 Playwright browser tests passed**;
- Axe reported no serious or critical violations on the tested application surfaces, excluding the sandboxed preserved-source iframe and the long extracted-text body;
- desktop, tablet, intake, and phone screenshots were visually inspected;
- `git diff --check` passed.

Browser coverage now includes:

- the library-first entry and system-status dialog;
- company opening and library overlay behavior;
- search modes, filter composition, and filter reset;
- source comparison, passage highlighting, provenance, and retained search;
- repeated search and browser history restoration;
- guided intake, Escape, and trigger-focus restoration;
- tablet overflow behavior;
- mobile Original/Extracted switching and bounded page layout.

The first default build attempt encountered `ENOTEMPTY` while Next.js tried to remove a generated `.next` directory on the Windows-mounted filesystem. This was not a source or type failure. A clean build using the new alternate output-directory override passed fully.

No live SEC crawl, real embedding-model relevance evaluation, or broader backend test suite was required or rerun for this frontend-only phase.

## 8. Current state and intentional limits

The implemented frontend now provides an approachable path from company selection through evidence search and source inspection. It remains useful without configured AI and truthfully discloses semantic-search readiness and fallback.

This phase intentionally did not add:

- cited RAG chat;
- company dashboards or synthesis;
- financial-fact views;
- settings screens;
- dark mode;
- analytics or tracking;
- new backend or database behavior.

The earlier reliability gaps remain: form-aware 10-Q section mapping, complete indexed preamble coverage, periodic lease recovery, and retained evidence generations for persistent citations. The real-model research loop also still needs target-host relevance and latency validation.

## 9. Recommended next direction

Treat this frontend as the accepted foundation and avoid reopening visual work until another deliberate frontend phase. The next engineering work should return to the bounded reliability sequence from Development Log 6, Part 2:

1. correct form-aware section mapping and intentional full-text coverage;
2. harden work-lease recovery;
3. validate the real keyword/semantic/hybrid research loop on the target host;
4. establish retained evidence generations and structured financial facts;
5. only then build the smallest audited cited-Q&A slice.

Future frontend work should extend the patterns in `docs/frontend-ux.md` rather than reintroducing a separate visual system for dashboard or chat features.

## 10. Decisions carried forward

1. The library is the application home; system health is contextual support information.
2. Search works and remains understandable without generative AI.
3. Source comparison and provenance stay one action away from a result.
4. URL-backed research state and existing API contracts remain stable.
5. Flat sections, restrained controls, accessible dialogs, and honest data states form the reusable frontend foundation.
6. Dashboard and chat interfaces will be designed only when their supporting capabilities exist.
