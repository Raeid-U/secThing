import { describe, expect, it } from "vitest";
import { analyzeQuestion, diagnoseAnswerRun } from "@secthing/platform";

const question = "What was revenue in 2022?";
const source = { label: "F1", kind: "financial_fact", text: "Revenue was 100 USD for 2022.", locator: { periodEnd: "2022-12-31", filed: "2023-02-01" } };
const answer = { summary: [{ statement: "Revenue was 100 USD for 2022.", citations: ["F1"] }], findings: [], interpretation: [] };
const verdict = { id: "summary-0", factual: true, temporal: true, contextual: true, quotes: [{ source: "F1", text: "Revenue was 100 USD" }] };
const generation = { purpose: "generation", content: JSON.stringify(answer), contextWindow: 8192, maxOutputTokens: 1024, promptTokens: 3000, outputTokens: 150 };
function row(verification: unknown = { verdicts: [verdict] }, generated: unknown = answer) {
  return { id: "1", validation_status: "evidence_only", raw_output: { question, scope: analyzeQuestion(question), evidence: [source],
    calls: [{ ...generation, content: JSON.stringify(generated) }, { purpose: "verification", content: JSON.stringify(verification) }] } };
}

describe("read-only answer audit replay", () => {
  it("distinguishes schema failures from evidence support rejection", () => {
    const schema = diagnoseAnswerRun(row({}, { summary: "plain text", findings: [], interpretation: [] }));
    expect(schema).toMatchObject({ stage: "generation_schema_or_citation_failure", replayError: "summary must be an array." });
    expect(diagnoseAnswerRun(row({ verdicts: [{ ...verdict, factual: false }] }))).toMatchObject({ stage: "all_claims_rejected", checks: [{ reasons: ["model_rejected_factual"] }] });
  });
  it("separates exact-quotation mismatch from numeric and temporal rejection", () => {
    const quote = diagnoseAnswerRun(row({ verdicts: [{ ...verdict, quotes: [{ source: "F1", text: "a paraphrase, not a quote" }] }] }));
    expect(quote).toMatchObject({ checks: [{ reasons: ["supporting_quote_not_matched"] }] });
    const numbers = diagnoseAnswerRun(row(undefined, { ...answer, summary: [{ statement: "Revenue was 200 USD in 2022.", citations: ["F1"] }] }));
    expect(numbers).toMatchObject({ checks: [{ reasons: ["number_not_in_cited_evidence"] }] });
    const historical = row(); historical.raw_output.scope = analyzeQuestion("Revenue in 2022 as of 2022-12-31");
    expect(diagnoseAnswerRun(historical)).toMatchObject({ checks: [{ reasons: ["source_outside_question_scope"] }] });
  });
  it("reports truncated verifier output instead of blaming absent evidence", () => {
    const input = row(); input.raw_output.calls[1] = { purpose: "verification", content: '{"verdicts":[' };
    const report = diagnoseAnswerRun(input);
    expect(report.stage).toBe("verification_json_invalid");
  });
  it("flags observed output limits and full prompts with historical-budget caveats", () => {
    const input = row(); Object.assign(input.raw_output.calls[0], { doneReason: "length", promptTokens: 8000, outputTokens: 1024 });
    const report = diagnoseAnswerRun(input);
    expect(report.flags).toEqual(expect.arrayContaining(["generation:runtime_reported_output_truncation", "generation:observed_prompt_consumed_output_reserve"]));
    expect(report.calls).toMatchObject([{ budgetSource: "recorded_request" }, { budgetSource: "current_config_not_historical_proof" }]);
  });
  it("identifies structural verifier failure separately from rejected claims", () => {
    expect(diagnoseAnswerRun(row({ verdicts: [] }))).toMatchObject({ stage: "verification_schema_failure", replayError: "Verification must assess every claim exactly once." });
  });
  it("does not print source bodies or raw model responses", () => {
    const input = row(); input.raw_output.evidence[0].text += " PRIVATE_SOURCE_SENTINEL";
    const report = JSON.stringify(diagnoseAnswerRun(input));
    expect(report).not.toContain("PRIVATE_SOURCE_SENTINEL");
    expect(report).not.toContain('"content"');
    expect(diagnoseAnswerRun(input).stage).toBe("supported_claims_under_current_checks");
  });
  it("includes bounded unverified claim/quote details only when explicitly requested", () => {
    const report = diagnoseAnswerRun(row(), { includeClaims: true });
    expect(report.claims).toMatchObject([{ id: "summary-0", unverifiedDiagnosticText: true, modelVerdict: { factual: true }, quotes: [{ matchesCitedPassage: true }] }]);
    expect(diagnoseAnswerRun(row()).claims).toBeUndefined();
  });
  it("does not invent a diagnosis when older audits lack the evidence snapshot", () => {
    expect(diagnoseAnswerRun({ raw_output: { calls: [generation] } }).stage).toBe("evidence_audit_missing_cannot_replay_support");
    expect(diagnoseAnswerRun({ raw_output: { content: "old audit" } }).stage).toBe("audit_missing_generation_details");
  });
});
