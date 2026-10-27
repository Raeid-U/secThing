import { describe, expect, it } from "vitest";
import { analyzeQuestion, OpenAiCompatibleClient, validateStructuredAnswer } from "@secthing/platform";

describe("grounded research contracts", () => {
  it("detects dates, filing filters, metrics, and comparison intent deterministically", () => {
    expect(analyzeQuestion("How did revenue change between the 2022 and 2025 10-K filings?")).toEqual({
      formTypes: ["10-K"], filedAfter: "2022-01-01", filedBefore: "2025-12-31", metrics: ["revenue"], comparison: true, numeric: true,
    });
    expect(analyzeQuestion("What did management call adjusted EBITDA?").metrics).toEqual([]);
  });

  it("rejects uncited statements and fabricated source labels", () => {
    const allowed = new Set(["C1"]);
    expect(() => validateStructuredAnswer({ findings: [{ statement: "Claim", citations: [] }], interpretation: [], limitations: [] }, allowed)).toThrow("at least one citation");
    expect(() => validateStructuredAnswer({ findings: [{ statement: "Claim", citations: ["C9"] }], interpretation: [], limitations: [] }, allowed)).toThrow("unknown citation");
    expect(validateStructuredAnswer({ findings: [{ statement: "Claim", citations: ["C1"] }], interpretation: [], limitations: ["Limited period"] }, allowed).findings).toHaveLength(1);
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
