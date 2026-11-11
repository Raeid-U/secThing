# Conversational AI implementation status

**Status: work in progress — real-model answer quality is not accepted.**

Documentation reviewed November 11, 2026. The latest live QA described here ran on
November 5, 2026. This feature lives on `feature/grounded-answer-reliability`; the
implementation checkpoint before this documentation update is `c00ec51`.

The current scope is company-scoped, single-question answering over retained SEC
evidence. The dialog preserves the current question and answer during source
inspection. Durable conversation history and multi-turn follow-up memory remain
outside this phase.

## What exists

| Area | Implemented behavior | Acceptance status |
| --- | --- | --- |
| Evidence foundation | Retained filing generations, structured financial facts, full-text/semantic retrieval, and exact source locators | Foundation available; financial duration selection needs correction |
| Local runtime | Shared bounded queue, interactive priority, finite model residency, and background-work deferral | User reports improved responsiveness and no noticeable ingestion slowdown |
| Ask interface | Separate native dialog, source links into the evidence bank, and a return path preserving the current answer | User accepted the dialog placement and appearance |
| Answer composition | Schema-constrained summary/findings/interpretation with citations | Implemented, but latest live questions still fell back |
| Verification | Separate factual/temporal/contextual review, quote/number/scope checks, and explicit evidence-only fallback | Safeguards run; proof generation is unreliable with the tested model |
| Diagnostics | Audited model calls, token/load/queue timings, rejection reasons, CLI and scoped API replay | Available for the next QA iteration |

Search and source inspection remain useful while conversational answer work
continues. A `generation_limited` response shows retrieved evidence and limitations;
it is not an accepted generated summary. Operational corpus readiness does not
establish that a model answer is accurate or useful.

## Latest live QA

The target was an RTX 5070 Ti with 16 GB VRAM and 96 GB system RAM, using
`qwen2.5:3b` chat and `nomic-embed-text` embeddings. The tested LINC corpus was
operationally ready with disclosed exclusions and complete embedding coverage.
These observations describe that local setup, not a general hardware benchmark.

The following tests ran after schema enforcement and the separate verification
output allowance were loaded:

| Question | End-to-end time | Recorded result |
| --- | --- | --- |
| What does Lincoln Educational Services do? | 9.19s | Evidence-only fallback; model run 17 |
| What recent disclosures did this company file? | 8.34s | Evidence-only fallback; model run 18 |
| What revenue did Lincoln report for the quarter ended June 30, 2026? | 7.22s | Evidence-only fallback; model run 19 |

All three completed generation and verification without malformed-output or
output-truncation failures. Input capacity was not exhausted in these cases.
**All three still failed support acceptance.** Run IDs refer to the local QA
application database; the audit records and raw corpus are not bundled with the
repository.

Earlier failures were separate engineering issues that have been addressed:

- malformed interpretation items despite requesting JSON, addressed by native
  Ollama schema-constrained output;
- verification stopping mid-JSON at a shared 1024-token output cap, addressed by a
  separate verification allowance and bounded quotes;
- discarded model-written limitations incorrectly blocking validation, addressed
  by application-owned limitations.

The loaded QA configuration used an 8192-token context, a 1024-token generation
output allowance, and a 2048-token verification output allowance. Prompt/schema
versions are v4 and the verification prompt is v3. Those fixes did not resolve the
remaining answer-quality problems.

## Remaining blockers

1. **Financial duration selection.** Facts sharing a period-end date can describe
   different durations. The quarter-revenue test received both January–June and
   April–June facts; generation used the six-month figure as a quarterly answer.
   Match the requested start/end/duration before handing facts to the model.
2. **Claim and citation selection.** The model attaches several unrelated source
   labels to individual claims, repeats information, and sometimes makes current
   assertions from dated filings. Generate atomic, source-attributed statements
   with a small set of directly supporting citations.
3. **Proof construction.** The small model invents or paraphrases quoted wording,
   repeats a quote against the wrong labels, or quotes its own claim. Existing
   matching then rejects the response. Proposed next work is server-owned passage
   or span IDs that verification selects, rather than model-generated verbatim
   quotations. This proposal is not implemented yet.
4. **Question relevance and real-model acceptance.** Filing-oriented questions can
   produce generic descriptions or claims of missing disclosures instead of useful
   answers. Recheck retrieval relevance and evaluate both supported answers and
   correct refusals after the preceding changes. Reassess model choice if the 3B
   model remains unreliable with a simpler proof workflow.

The checks are also catching real errors, including the duration mistake above.
Blanket removal of verification is not the selected next step. Existing safeguards
must remain until a replacement has been implemented and evaluated.

## Continuation and exit criteria

Implement duration-aware financial retrieval, then simplify claims/citations and
proof selection. Repeat the three live cases above alongside unsupported-premise,
wrong-period, and source-navigation checks. Use the audit to separate malformed
output, budget failures, source mismatch, and substantive support rejection.

This phase is ready for acceptance when representative supported questions produce
useful cited summaries, unsupported questions are handled accurately, quarter/YTD
values remain distinct, and citations reopen the exact supporting evidence. A high
fallback rate on answerable questions remains a failure even if the fallback is
safe. Completion is not established by automated contract tests alone.

The current planning estimate is **3–5 focused implementation/QA sessions**, roughly
**2–4 active working days**, for this single-question scope. This is an estimate,
not a delivery commitment; model suitability and local GPU QA may change it.
Multi-turn context would require a separate implementation phase.

## Validation and entry points

The last implementation validation passed **113 Vitest tests across 15 files**,
including **50 PostgreSQL integration cases**, plus workspace TypeScript and NVIDIA
Compose configuration checks. Those checks predate this documentation-only update.
Browser automation has not been executed in this environment because the Chromium
download was blocked; browser-test discovery is not an execution pass.

Useful implementation files:

- [Question analysis](../packages/platform/src/query-analysis.ts) and
  [retrieval/evidence packaging](../packages/platform/src/retrieval.ts).
- [Answer generation](../packages/platform/src/grounded-answer.ts),
  [output schemas](../packages/platform/src/answer-schemas.ts), and
  [support verification](../packages/platform/src/answer-verification.ts).
- [Ask dialog](../apps/frontend/app/research/ask-filings.tsx) and
  [runtime scheduler](../packages/platform/src/ai-scheduler.ts).

Use the [guided QA workflow](qa-grounded-reliability.md) for commands and audit
inspection. The overall [implementation plan](plan.md) and [FRD](FRD.md) retain the
intended requirements; this document records the current implementation status.
