import { analyzeQuestion } from "./query-analysis.js";
import { validateStructuredAnswer } from "./grounded-answer.js";
import { claimsOf, validateVerification } from "./answer-verification.js";
import type { EvidencePackage, EvidenceSource } from "./retrieval.js";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);
function parse(content: unknown) {
  if (typeof content !== "string") throw new Error("No recorded model response.");
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object in the recorded response.");
  return JSON.parse(match[0]) as unknown;
}

// Replays validators over an existing audit only: no model call and no database
// writes. Old audits are explicitly distinguished from current runtime settings.
export function diagnoseAnswerRun(row: RecordValue, options: { contextWindow?: number; outputTokens?: number; verificationOutputTokens?: number; includeClaims?: boolean } = {}) {
  const raw = record(row.raw_output);
  const calls = Array.isArray(raw.calls) ? raw.calls.map(record) : [];
  const sources = Array.isArray(raw.evidence) ? raw.evidence as EvidenceSource[] : [];
  const flags: string[] = [];
  const callReports = calls.map((call) => {
    const contextWindow = number(call.contextWindow) ?? options.contextWindow;
    const outputLimit = number(call.maxOutputTokens) ?? (call.purpose === "verification" ? options.verificationOutputTokens ?? options.outputTokens : options.outputTokens);
    const promptTokens = number(call.promptTokens);
    const outputTokens = number(call.outputTokens);
    const estimatedInput = number(call.estimatedInputTokens);
    if (call.doneReason === "length") flags.push(`${call.purpose}:runtime_reported_output_truncation`);
    else if (outputTokens !== undefined && outputLimit !== undefined && outputTokens >= outputLimit) flags.push(`${call.purpose}:output_limit_reached_or_matched`);
    if (contextWindow !== undefined && outputLimit !== undefined && promptTokens !== undefined && promptTokens + outputLimit > contextWindow) flags.push(`${call.purpose}:observed_prompt_consumed_output_reserve`);
    return { purpose: call.purpose, model: call.model, error: call.error, doneReason: call.doneReason,
      estimatedInputTokens: estimatedInput, promptTokens, outputTokens, contextWindow, outputLimit,
      budgetSource: number(call.contextWindow) !== undefined ? "recorded_request" : "current_config_not_historical_proof",
      remainingReservedInput: contextWindow !== undefined && promptTokens !== undefined && outputLimit !== undefined ? contextWindow - promptTokens - outputLimit : undefined,
      loadMs: number(call.loadDurationNs) !== undefined ? Number(call.loadDurationNs) / 1e6 : undefined,
      durationMs: number(call.totalDurationNs) !== undefined ? Number(call.totalDurationNs) / 1e6 : undefined };
  });
  const result: RecordValue = { id: row.id, company: row.company_name ?? row.company_id, createdAt: row.created_at,
    question: raw.question, recordedPromptVersion: row.prompt_version, recordedValidationStatus: row.validation_status,
    recordedError: row.error_message, timings: raw.timings, evidenceSources: sources.length,
    evidenceCharacters: sources.reduce((sum, source) => sum + (typeof source.text === "string" ? source.text.length : 0), 0),
    flags, calls: callReports, replayUsesCurrentValidator: true };
  const generation = calls.filter((call) => call.purpose === "generation").at(-1);
  if (!generation) return { ...result, stage: "audit_missing_generation_details" };
  let parsed: unknown;
  try { parsed = parse(generation.content); }
  catch (error) { return { ...result, stage: generation.error ? "generation_transport_or_parse_failure" : "generation_json_invalid", replayError: message(error) }; }
  if (!sources.length) return { ...result, stage: "evidence_audit_missing_cannot_replay_support" };
  let answer;
  try { answer = validateStructuredAnswer(parsed, new Set(sources.map((source) => source.label))); }
  catch (error) { return { ...result, stage: "generation_schema_or_citation_failure", replayError: message(error) }; }
  result.generatedClaims = claimsOf(answer).length;
  if (options.includeClaims) result.claims = claimsOf(answer).map((claim) => ({ ...claim, unverifiedDiagnosticText: true }));
  const verification = calls.filter((call) => call.purpose === "verification").at(-1);
  if (!verification) return { ...result, stage: "verification_not_run_or_not_recorded" };
  let verdicts: unknown;
  try { verdicts = parse(verification.content); }
  catch (error) { return { ...result, stage: "verification_json_invalid", replayError: message(error) }; }
  if (options.includeClaims) {
    const entries = record(verdicts).verdicts;
    const reviews = Array.isArray(entries) ? entries.map(record) : [];
    result.claims = claimsOf(answer).map((claim) => {
      const review = reviews.find((item) => item.id === claim.id);
      return { ...claim, unverifiedDiagnosticText: true, modelVerdict: review ? { factual: review.factual, temporal: review.temporal, contextual: review.contextual } : undefined,
        quotes: Array.isArray(review?.quotes) ? review.quotes.map((item) => {
          const quote = record(item), text = typeof quote.text === "string" ? quote.text : "";
          const source = sources.find((source) => source.label === quote.source);
          return { source: quote.source, text: text.slice(0, 240), characters: text.length, clippedForReport: text.length > 240,
            matchesCitedPassage: Boolean(source && text.trim() && source.text.replace(/\s+/g, " ").includes(text.replace(/\s+/g, " ").trim())) };
        }) : [] };
    });
  }
  const question = typeof raw.question === "string" ? raw.question : "";
  const evidence: EvidencePackage = { question, sources, analysis: Object.keys(record(raw.scope)).length ? raw.scope as EvidencePackage["analysis"] : analyzeQuestion(question),
    tokens: { budget: 0, used: 0, reservedOutput: 0 }, generationIds: [], coverage: {} };
  try {
    const review = validateVerification(verdicts, answer, evidence);
    return { ...result, stage: review.rejected === claimsOf(answer).length ? "all_claims_rejected" : "supported_claims_under_current_checks",
      acceptedClaims: claimsOf(answer).length - review.rejected, rejectedClaims: review.rejected, checks: review.checks };
  } catch (error) { return { ...result, stage: "verification_schema_failure", replayError: message(error) }; }
}
