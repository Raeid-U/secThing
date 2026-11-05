# Guided QA pilot: grounded-answer reliability

This is a human-assisted pilot, not a completed GPU acceptance report. The agent
runs contract/database checks; the user runs the actual Compose/NVIDIA stack and
reports observable results. Use one round at a time, diagnose discrepancies, then
repeat only the affected checks. After the pilot, use the proven workflow to write
an invocable QA skill; do not formalize untested steps as established practice.

## User-observed pilot results — 2026-11-04

The user reported approximately 45 seconds to cold-load the model, followed by
3–7 seconds for the answer, and 2–10 seconds for subsequent warm questions. Running
ingestion concurrently did not cause a noticeably significant slowdown. These are
self-reported timings, not audited per-call measurements or a universal hardware
performance claim. Narrow questions were reported to return quickly with guidance
to broaden the question.

Generated-summary acceptance remains open. The question “What recent disclosures
did this company file?” returned an evidence-only fallback. Expanding its
limitations revealed `limitations must be a string array.` This was an unnecessary
schema gate on discarded model metadata, not a failed factual-support verdict.
The application no longer requests or validates that unused field; citations and
support checks remain required. A separate numeric-guard bug that interpreted the
“10” in “10-K” as a financial value was fixed with regression coverage.

After restarting the backend, repeat that same question. Report whether the result
is a cited summary or evidence-only output, along with the expanded diagnostic if
it still falls back. Then inspect a citation and use “Return to answer” to confirm
that question/answer state is preserved. Test Escape/focus restoration and mobile
layout. Browser automation is still unexecuted here because the browser download
was denied with HTTP 403; browser test discovery is not an execution pass.

## Target and baseline

- RTX 5070 Ti, 16 GB VRAM, 96 GB system RAM.
- Compose Ollama endpoint: `http://ollama:11434`.
- Chat: `qwen2.5:3b`; embeddings: `nomic-embed-text`, 768 dimensions.
- Keep these models unchanged during the first comparison. Record Ollama version
  with `docker compose exec ollama ollama --version`.
- Start with an already-ready company and record its name, coverage years and
  exclusion count. Do not delete or re-ingest its corpus to run this pilot.

## Round 1: residency and UI responsiveness

Add/confirm these values in `.env` (retain existing credentials and other values):

```dotenv
AI_MODEL_KEEP_ALIVE_SECONDS=120
AI_QUEUE_WAIT_MS=60000
AI_QUEUE_LIMIT=16
AI_EMBEDDING_BATCH_SIZE=8
OLLAMA_NUM_PARALLEL=1
AI_CHAT_CONTEXT_WINDOW=8192
AI_CHAT_MAX_OUTPUT_TOKENS=1024
AI_REQUEST_TIMEOUT_MS=60000
```

From the repo root, rebuild the existing NVIDIA deployment:

```bash
docker compose -f compose.yaml -f compose.nvidia.yaml --profile ollama-nvidia up --build -d
```

Backend/worker apply migration `0010` on startup. Do not run older workers against
the upgraded database. This migration adds runtime scheduling and worker fencing.

1. Wait at least 130 seconds after all inference activity has stopped. Ingestion,
   meaning search, and status-panel chat verification count as activity. Check:

   ```bash
   docker compose exec ollama ollama ps
   ```

   Models requested by this version should expire after the configured idle period;
   Ollama may evict them earlier under pressure. A model loaded earlier by another
   client may have a different expiry. Do not forcibly unload shared models.
2. Ask a simple question supported by the selected company's filings, such as
   “What does the company do?” Record the question, wall-clock time, answer status,
   limitations, and whether its source opens correctly.
3. Immediately ask the **same** question again. During both questions, sample
   `docker compose exec ollama ollama ps` and `nvidia-smi` in another terminal.
   Record loaded models, CPU/GPU placement, and VRAM use.
4. While the answer is pending, scroll, use keyword search, and inspect a source
   already open in another tab. Record freezes, errors, and whether clicks work.
5. Check load timing in the audit using the read-only query below. Generation and
   verification should use the same chat model with no background embedding call
   between them. Warm verification should not repeatedly incur a large load time.
   Some model switching between separate questions is expected when two models
   cannot coexist. Residency is cooperative and does not reserve physical VRAM.

Read only the newest five runs (substitute database/user if yours differ):

```bash
docker compose exec postgres psql -U secthing -d secthing -c "SELECT id, validation_status, latency_ms, raw_output->'timings' AS timings, (SELECT jsonb_agg(jsonb_build_object('purpose', c->>'purpose', 'loadMs', (c->>'loadDurationNs')::numeric / 1000000, 'promptTokens', c->'promptTokens', 'outputTokens', c->'outputTokens')) FROM jsonb_array_elements(raw_output->'calls') c) AS calls FROM model_runs ORDER BY id DESC LIMIT 5;"
```

Report this compact result before proceeding:

```text
Ollama version / company / coverage / exclusions:
Exact question:
Cold time / warm time:
Status (answered or generation_limited) / limitations:
Generation loadMs / verification loadMs (each run):
Loaded models / CPU-GPU placement / peak VRAM:
UI responsive during inference? Source opens?
Errors or unexpected behavior:
```

Never paste `.env`, authorization headers, or credentials. Model-run outputs may
contain the question and bounded filing evidence; share only relevant diagnostics.

## Round 2: factual, temporal and contextual support

Choose years for which the corpus actually has evidence. Repeat the same questions
when investigating an anomaly so model/retrieval changes can be compared.

| Check | Example | Expected observation |
| --- | --- | --- |
| Reporting period | “What was revenue in 2022 from 10-K filings?” | Facts end in the requested period; a 2023-filed report can describe 2022. |
| Publication window | “What revenue was disclosed in 10-K filings filed in 2023?” | Publication dates match 2023; reporting periods may differ. |
| Historical knowledge | “What was revenue in 2022 as of 2022-12-31?” | No fact published after the cutoff; refusal/excerpts are acceptable if evidence is unavailable. |
| Comparison | “Compare revenue in 2022 and 2023.” | Both baselines, values, units and entity/segment scope are supported; missing support is disclosed. |
| Context | Ask about a named segment or geography in the filings. | Whole-company values must not be attributed to that segment/geography. |
| Unsupported premise | Ask for a precise figure absent from the retained filings. | No invented value; unsupported generated claims are withheld. |
| Date validity | “What was revenue on 2022-02-30?” | An explicit invalid-date error, not a silently widened search. |

The verifier reopens each cited retained passage and receives a bounded amount of
adjacent text from that same retained section to check original context. This is
not a second retrieval over unrelated sources.

For every accepted claim, inspect the cited evidence for factual meaning, period,
entity/segment, units and qualifiers. An existing source label and an exact quote
alone do not prove entailment. Record any false acceptance **and** false rejection.
A second pass using the same model can repeat its mistakes.

Bare financial years select **period-end dates within calendar-year bounds**;
explicit “filed” clauses select publication dates. Bare Q1–Q4 use calendar quarters;
fiscal-quarter shorthand requires explicit reporting-period dates. Narrative
retrieval uses the filing's report date for period filters; a document with unknown
report date is omitted under such a filter. The verifier must still distinguish a
source's report date from the period actually described in the passage.

## Round 3: contention, expiry and recovery

- Submit questions from two tabs, while a separate company's existing ingestion
  performs embedding work. Record UI usability and audit queue wait. The active
  call is not preempted; newer questions get priority at the next scheduling point,
  same-model requests have affinity, and waits older than 15 seconds age into FIFO.
- Queue capacity and wait are finite. A full/expired chat queue should return
  HTTP 503 with `Retry-After: 5`; no unbounded request pile-up. Background contention
  should defer work, rather than consume an attempt and exclude the document.
- For an intentional short-wait test, temporarily set `AI_QUEUE_WAIT_MS=1000` and
  `AI_QUEUE_LIMIT=1`, restart backend/worker, and submit overlapping requests.
  Restore the original values afterward. Do this after the baseline, not during it.
- Once inference and ingestion have stopped, repeat the idle-expiry observation.
  Finite residency must not become an indefinite GPU pin.
- Report failed requests, unfinished jobs, queue waits, and whether a subsequent
  question succeeds. Do not stop/restart Ollama in the middle of shared work merely
  to test error handling.

## Acceptance and next iteration

Pass only observed checks. “Not run” is different from “pass.” GPU acceptance is
pending until the user reports results. Do not change models, enlarge context,
or increase residency solely to hide a failure; first use load/queue/token data to
identify its cause. Raw excerpts with a generation limitation are a safe fallback,
but a high fallback rate is a quality failure to investigate.

The initial target is a responsive evidence UI, bounded memory/request pressure,
no repeated chat load between generation and verification, correct period/form/
cutoff filtering, exact source reopening, and no accepted unsupported claims in the
pilot set. This small set cannot establish universal grounding or hardware speed.

## Read-only audit diagnosis — 2026-11-05

When every question falls back, diagnose the recorded stage before changing the
acceptance policy or increasing context. A malformed JSON response, an exhausted
output limit, a rejected quote, and a genuinely unsupported claim require different
fixes. The initial gateway denial was resolved on retry, but `docker.internal` has no DNS
entry. Use `http://host.docker.internal:3000` and `:8080` from this environment.
Both services and the frontend API proxy returned HTTP 200.

Live diagnostic on company 4 (LINC), with `qwen2.5:3b`, reproduced two failures:
“What does Lincoln Educational Services do?” (run 13, 13.80s) and “What recent
disclosures did this company file?” (run 14, 5.52s). Both returned
`interpretation contains an invalid statement.` Corpus status was
`ready_with_exclusions`, with 764/764 chunks embedded and zero active evidence
work. This establishes a generation-contract failure before support verification;
it does not establish insufficient context or an overly strict factual verdict.

The native Ollama transport now passes JSON schemas to `format` for answer and
verification output, instead of only requesting arbitrary valid JSON. Schemas
require arrays of sourced statement objects, supplied citation labels, and typed
per-claim verdicts. The same schemas are included in prompt token budgeting.
Prompt/schema versions are v4; verification prompt v2. Factual, quotation, number
and scope acceptance checks are unchanged. JSON-only compatible transports still
use their existing JSON mode plus the explicit prompt schema/server validation.
The backend must load the new code before a live post-fix retest can be claimed.

Run inside the already-configured backend container:

```bash
docker compose exec backend npm run diagnose:answers -- --limit 5
```

Optional: add `--company-id 1` to scope the report. The command only reads existing
model-run audits. It does not invoke a model, modify the database, or print full
filing passages/raw model responses/credentials. It reports the question, stored
error, model and prompt versions, observed/estimated token counts, load timings,
JSON/schema failures, and per-claim rejection categories. Old records are replayed
using the current validator and marked accordingly; current environment budgets
are explicitly not proof of the historical request limits.

A JSON array of exported model-run rows can also be replayed offline:

```bash
npm run diagnose:answers -- --file /path/to/model-runs.json
```

New audits retain context/output limits, Ollama's stop reason, and parsed checks
even when **every** claim is rejected. Restart the backend before expecting those
new fields on newly submitted questions; existing audits remain replayable without
a restart. `runtime_reported_output_truncation` is evidence of an output cap, not
insufficient retrieval context. `output_limit_reached_or_matched` on older records
is a clue using the supplied current budget, not definitive proof of truncation.

Acceptance policy is unchanged by these diagnostic additions. Use the report to
choose the next intervention: transport/schema handling, phase-specific output
budget, evidence selection, quote handling, or substantive support policy.

After the schema-fix backend restart, a bounded diagnostic is also available over
the API, without raw filing/model text:

```text
GET /api/v1/companies/:companyId/model-runs/:modelRunId/diagnostics
```

Use the modelRunId returned by a question. The endpoint scopes the audit to that
company and returns 404 for a mismatched company/run. In this diagnostic environment
the working host is `host.docker.internal`, not `docker.internal`. Run 13 and 14
are the pre-fix LINC reproduction baseline. Do not report post-fix success until
new questions have been submitted after the backend reload.

## Post-schema live diagnostic — 2026-11-05

After the first backend restart, v4 was confirmed through the audit endpoint. The
pre-fix runs had about 4.6–5.0K observed prompt tokens and only 377–573 output
tokens. Their schema error was not caused by exhausting the configured 8K input
window or 1K output cap.

New business-question run 15 passed generation structure validation but verification
ended with `doneReason: length` at exactly 1024 output tokens, leaving incomplete
JSON. The verifier's observed prompt was 5527 tokens in an 8192-token window. This
is an output-allocation failure, not a failed factual check. Run 16, repeating the
recent-disclosures question, completed its verifier output (364 tokens) but rejected
all four claims; inspect those actual claim/quote details before changing support
policy. End-to-end times were 12.34s and 4.88s respectively.

`AI_VERIFICATION_MAX_OUTPUT_TOKENS` now has a separate default of 2048 for the
normal 8192-token context (automatically reduced for smaller configured contexts).
Generation retains its 1024-token default. Evidence selection reserves the larger
verification output before building the package; prompts are rechecked per phase.
Verification quotes are constrained to 240 characters, and a runtime output-length
stop is explicitly withheld even if a partial object could be parsed. No factual
acceptance threshold was relaxed. Restart is required before judging this change.

For detailed inspection, explicitly opt in to bounded **unverified** claim and
quote text, with quote-match indicators:

```text
GET /api/v1/companies/4/model-runs/16/diagnostics?includeClaims=true
```

Or add `--include-claims` to the CLI. Default reports still omit generated prose and
source bodies. The detailed report is diagnostic material, not an accepted answer.
