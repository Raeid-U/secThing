import { describe, expect, it } from "vitest";
import { analyzeQuestion, OpenAiCompatibleClient, validateStructuredAnswer } from "@secthing/platform";

describe("grounded research contracts", () => {
  it("detects dates, filing filters, metrics, and comparison intent deterministically", () => {
    expect(analyzeQuestion("How did revenue change between the 2022 and 2025 10-K filings?")).toMatchObject({
      formTypes: ["10-K"], periodAfter: "2022-01-01", periodBefore: "2025-12-31", metrics: ["revenue"], comparison: true, numeric: true,
    });
    expect(analyzeQuestion("What did management call adjusted EBITDA?").metrics).toEqual([]);
  });

  it("rejects uncited statements and fabricated source labels", () => {
    const allowed = new Set(["C1"]);
    expect(() => validateStructuredAnswer({ findings: [{ statement: "Claim", citations: [] }], interpretation: [], limitations: [] }, allowed)).toThrow("at least one citation");
    expect(() => validateStructuredAnswer({ findings: [{ statement: "Claim", citations: ["C9"] }], interpretation: [], limitations: [] }, allowed)).toThrow("unknown citation");
    expect(() => validateStructuredAnswer({ summary: [{ statement: "Summary", citations: ["C9"] }], findings: [], interpretation: [], limitations: [] }, allowed)).toThrow("unknown citation");
    expect(validateStructuredAnswer({ findings: [{ statement: "Claim", citations: ["C1"] }], interpretation: [], limitations: ["Limited period"] }, allowed).findings).toHaveLength(1);
  });

  it("ignores unused provider limitations without weakening claim citation validation", () => {
    for (const limitations of [undefined, null, "This was returned as prose.", { unsupported: "generated content" }]) {
      const parsed = validateStructuredAnswer({ summary: [{ statement: "Supported summary", citations: ["C1"] }], findings: [], interpretation: [], limitations }, new Set(["C1"]));
      expect(parsed.summary).toHaveLength(1);
      expect(parsed.limitations).toEqual([]);
    }
    expect(() => validateStructuredAnswer({ summary: [{ statement: "Uncited summary", citations: [] }], findings: [], interpretation: [], limitations: "prose" }, new Set(["C1"]))).toThrow("at least one citation");
  });

  it("normalizes OpenAI-compatible chat and embedding payloads", async () => {
    const requests: unknown[] = [];
    const client = new OpenAiCompatibleClient({ baseUrl: "https://provider.example", timeoutMs: 1_000, fetch: (async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return requests.length === 1
        ? new Response(JSON.stringify({ model: "chat", choices: [{ message: { content: "{}" } }] }))
        : new Response(JSON.stringify({ model: "embed", data: [{ index: 0, embedding: [1, 2] }] }));
    }) as typeof fetch });
    await expect(client.chat({ model: "chat", messages: [], responseFormat: "json" })).resolves.toMatchObject({ content: "{}" });
    await expect(client.embed({ model: "embed", inputs: ["one"] })).resolves.toMatchObject({ embeddings: [[1, 2]] });
    expect(requests[0]).toMatchObject({ response_format: { type: "json_object" } });
  });
});
