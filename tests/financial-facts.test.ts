import { describe, expect, it } from "vitest";
import { normalizeCompanyFacts } from "@secthing/platform";

describe("companyfacts normalization", () => {
  it("maps only explicit concepts and preserves source semantics", () => {
    const facts = normalizeCompanyFacts({ facts: { "us-gaap": {
      Revenues: { units: { USD: [{ val: 100, start: "2025-01-01", end: "2025-12-31", fy: 2025, fp: "FY", form: "10-K", accn: "a", filed: "2026-02-01" }] } },
      EBITDA: { units: { USD: [{ val: 20, start: "2025-01-01", end: "2025-12-31" }] } },
      Assets: { units: { USD: [{ val: 300, end: "2025-12-31", form: "10-K", accn: "a" }] } },
    } } });
    expect(facts).toHaveLength(2);
    expect(facts).toContainEqual(expect.objectContaining({ metric: "revenue", taxonomy: "us-gaap", concept: "Revenues", periodStart: "2025-01-01", periodEnd: "2025-12-31", accessionNumber: "a" }));
    expect(facts).toContainEqual(expect.objectContaining({ metric: "assets", instantDate: "2025-12-31" }));
  });

  it("marks conflicting restatements without averaging them", () => {
    const facts = normalizeCompanyFacts({ facts: { "us-gaap": { NetIncomeLoss: { units: { USD: [
      { val: 10, start: "2025-01-01", end: "2025-12-31", fp: "FY", form: "10-K", filed: "2026-02-01" },
      { val: 12, start: "2025-01-01", end: "2025-12-31", fp: "FY", form: "10-K/A", filed: "2026-03-01" },
    ] } } } } });
    expect(facts.map((fact) => [fact.value, fact.conflictStatus])).toEqual([[10, "conflicting"], [12, "selected"]]);
  });
});
