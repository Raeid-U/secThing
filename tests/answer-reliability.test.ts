import { describe, expect, it } from "vitest";
import { analyzeQuestion, estimateMessages, fitsContext, validateVerification, deterministicSupport, type EvidencePackage, type StructuredAnswer } from "@secthing/platform";

const evidence: EvidencePackage = {
  question: "What was revenue in 2022?", analysis: analyzeQuestion("What was revenue in 2022?"),
  sources: [{ label: "F1", kind: "financial_fact", sourceId: "financial_fact:1", tokenEstimate: 100,
    text: "revenue: 100 USD; period 2022-01-01 to 2022-12-31; 10-K; status selected.",
    locator: { formType: "10-K", periodStart: "2022-01-01", periodEnd: "2022-12-31", filed: "2023-02-01" } }],
  generationIds: [], tokens: { budget: 2048, used: 100, reservedOutput: 512 }, coverage: {},
};
const answer: StructuredAnswer = { findings: [{ statement: "Revenue was 100 USD in 2022.", citations: ["F1"] }], interpretation: [], limitations: [] };
const verdict = { id: "finding-0", factual: true, temporal: true, contextual: true, quotes: [{ source: "F1", text: "revenue: 100 USD" }] };

describe("question scope", () => {
  it("separates reporting periods from filing dates and knowledge cutoffs", () => {
    expect(analyzeQuestion("What was revenue in 2022 as of March 31, 2023?")).toMatchObject({ periodAfter: "2022-01-01", periodBefore: "2022-12-31", filedBefore: "2023-03-31", asOf: "2023-03-31" });
    expect(analyzeQuestion("Revenue for 2022 filed in 2023")).toMatchObject({ periodAfter: "2022-01-01", periodBefore: "2022-12-31", filedAfter: "2023-01-01", filedBefore: "2023-12-31" });
    expect(analyzeQuestion("Revenue from 10-K filings filed in 2023")).toMatchObject({ filedAfter: "2023-01-01", filedBefore: "2023-12-31" });
    expect(analyzeQuestion("Revenue from 10-K filings filed in 2023").periodAfter).toBeUndefined();
    expect(analyzeQuestion("What were the risks before 2022?")).toMatchObject({ filedBefore: "2021-12-31", topics: ["risk_factors"] });
    expect(analyzeQuestion("Revenue after 2022")).toMatchObject({ periodAfter: "2023-01-01" });
    expect(analyzeQuestion("Revenue since 2022").periodBefore).toBeUndefined();
  });
  it("extracts exact dates, quarter windows, relative windows, and useful terms", () => {
    expect(analyzeQuestion("Compare revenue between 2022-04-01 and 2022-06-30 in 10-Q filings")).toMatchObject({ periodAfter: "2022-04-01", periodBefore: "2022-06-30", formTypes: ["10-Q"] });
    expect(analyzeQuestion("Revenue in Q2 2022")).toMatchObject({ periodAfter: "2022-04-01", periodBefore: "2022-06-30" });
    expect(analyzeQuestion("Risk disclosures over the last 2 years", new Date("2026-11-03T00:00:00Z"))).toMatchObject({ filedAfter: "2024-11-03", filedBefore: "2026-11-03" });
    expect(analyzeQuestion("What changed in cybersecurity risks in 2022?").keywords).toContain("cybersecurity");
    expect(analyzeQuestion("10-K/A and 10-Q filings").formTypes).toEqual(["10-K/A", "10-Q"]);
  });
  it("rejects invalid dates and ambiguous fiscal-quarter assumptions", () => {
    expect(() => analyzeQuestion("Revenue in 2022-02-30")).toThrow("Invalid question date");
    expect(() => analyzeQuestion("Revenue between 2023-01-01 and 2022-01-01")).toThrow("start date");
    expect(() => analyzeQuestion("Revenue in fiscal Q1 2022")).toThrow("reporting-period dates");
  });
});

describe("claim support verification", () => {
  it("requires all three axes and an exact supporting quote from every cited source", () => {
    expect(validateVerification({ verdicts: [verdict] }, answer, evidence).findings).toHaveLength(1);
    for (const axis of ["factual", "temporal", "contextual"]) expect(validateVerification({ verdicts: [{ ...verdict, [axis]: false }] }, answer, evidence).findings).toEqual([]);
    expect(validateVerification({ verdicts: [{ ...verdict, quotes: [{ source: "F1", text: "fabricated quotation" }] }] }, answer, evidence).findings).toEqual([]);
    expect(validateVerification({ verdicts: [{ ...verdict, quotes: [] }] }, answer, evidence).findings).toEqual([]);
  });
  it("fails closed for missing, unknown, and duplicate claim verdicts", () => {
    expect(() => validateVerification({ verdicts: [] }, answer, evidence)).toThrow();
    expect(() => validateVerification({ verdicts: [{ ...verdict, id: "invented" }] }, answer, evidence)).toThrow();
    const two = { ...answer, findings: [...answer.findings, ...answer.findings] };
    expect(() => validateVerification({ verdicts: [verdict, verdict] }, two, evidence)).toThrow();
  });
  it("rejects invented numbers and sources outside the temporal scope even if the model approves", () => {
    expect(deterministicSupport({ statement: "Revenue was 200 USD in 2022.", citations: ["F1"] }, evidence.sources, evidence)).toBe(false);
    const filing = [{ ...evidence.sources[0], kind: "chunk" as const, text: "The company described its operations.", locator: { formType: "10-K", reportDate: "2022-12-31", filingDate: "2023-02-01" } }];
    expect(deterministicSupport({ statement: "The company described its operations in a 10-K filing.", citations: ["F1"] }, filing, evidence)).toBe(true);
    expect(deterministicSupport({ statement: "Revenue was 10 USD.", citations: ["F1"] }, filing, evidence)).toBe(false);
    const negative = [{ ...evidence.sources[0], text: "Revenue was -100 USD in 2022." }];
    expect(deterministicSupport(answer.findings[0], negative, evidence)).toBe(false);
    expect(deterministicSupport({ statement: "Revenue was 100 million USD in 2022.", citations: ["F1"] }, [{ ...evidence.sources[0], text: "Revenue was 100,000,000 USD in 2022." }], evidence)).toBe(true);
    const historical = { ...evidence, analysis: analyzeQuestion("Revenue in 2022 as of 2022-12-31") };
    expect(validateVerification({ verdicts: [verdict] }, answer, historical).findings).toEqual([]);
    expect(deterministicSupport(answer.findings[0], evidence.sources, { ...evidence, analysis: analyzeQuestion("Revenue in 2021") })).toBe(false);
  });
});

describe("complete message budgeting", () => {
  it("counts question, JSON metadata, instructions, Unicode and output reserve", () => {
    const short = [{ role: "user" as const, content: "hello" }];
    const full = [{ role: "system" as const, content: "instructions" }, { role: "user" as const, content: JSON.stringify({ question: "長".repeat(500), locator: { documentId: "1" }, evidence: "hello" }) }];
    expect(estimateMessages(full)).toBeGreaterThan(estimateMessages(short) + 500);
    expect(fitsContext(full, estimateMessages(full) + 512, 512)).toBe(true);
    expect(fitsContext(full, estimateMessages(full) + 511, 512)).toBe(false);
  });
});

describe("bounded temporal clauses", () => {
  it("combines explicit lower and upper bounds without reversing their meaning", () => {
    expect(analyzeQuestion("Revenue after 2022 and before 2025")).toMatchObject({ periodAfter: "2023-01-01", periodBefore: "2024-12-31" });
    expect(analyzeQuestion("Revenue since 2022 through 2025")).toMatchObject({ periodAfter: "2022-01-01", periodBefore: "2025-12-31" });
    expect(analyzeQuestion("Revenue after 2022 and explain the sources").periodBefore).toBeUndefined();
  });
});

describe("conversational summary support", () => {
  it("checks summary paragraphs as independent cited claims", () => {
    const conversational = { ...answer, summary: [{ statement: "For 2022, revenue was 100 USD.", citations: ["F1"] }] };
    const summaryVerdict = { ...verdict, id: "summary-0" };
    expect(validateVerification({ verdicts: [summaryVerdict, verdict] }, conversational, evidence).summary).toHaveLength(1);
    const rejected = validateVerification({ verdicts: [{ ...summaryVerdict, contextual: false }, verdict] }, conversational, evidence);
    expect(rejected.summary).toEqual([]);
    expect(rejected.findings).toHaveLength(1);
    expect(() => validateVerification({ verdicts: [verdict] }, conversational, evidence)).toThrow("every claim");
  });
});
