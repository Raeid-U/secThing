import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalCik, isSupportedMvpForm, SecClient } from "@secthing/platform";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

async function clientFor(responses: Record<string, unknown>) {
  const dataDir = await mkdtemp(join(tmpdir(), "secthing-sec-test-"));
  directories.push(dataDir);
  const fetch = vi.fn(async (url: string | URL | Request) => {
    const body = responses[String(url)];
    return body === undefined
      ? new Response("not found", { status: 404 })
      : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
  return { client: new SecClient({ dataDir, userAgent: "secThing tests@example.com", rateLimitPerSecond: 10, fetch: fetch as typeof globalThis.fetch }), fetch };
}

describe("SEC identity and submissions client", () => {
  it("resolves LINC through the official ticker mapping and formats its CIK", async () => {
    const { client } = await clientFor({
      "https://www.sec.gov/files/company_tickers.json": { "0": { cik_str: 1286613, ticker: "LINC", title: "Lincoln Educational Services Corporation" } },
    });
    await expect(client.resolveTicker("linc")).resolves.toMatchObject({ match: { cik: 1286613, ticker: "LINC" } });
    expect(canonicalCik(1286613)).toBe("0001286613");
  });

  it("combines recent and historical submission metadata", async () => {
    const { client } = await clientFor({
      "https://data.sec.gov/submissions/CIK0001286613.json": {
        name: "Lincoln Educational Services Corporation", tickers: ["LINC"], exchanges: ["NASDAQ"], sic: "8200", sicDescription: "Services-Educational Services", entityType: "operating", stateOfIncorporation: "NJ", stateOfIncorporationDescription: "NEW JERSEY", businessAddress: { street1: "14 Sylvan Way", city: "Parsippany", stateOrCountry: "NJ", zipCode: "07054", phone: "973-736-9340" },
        filings: { recent: { accessionNumber: ["0001"], form: ["10-K"], filingDate: ["2025-03-01"], reportDate: ["2024-12-31"], primaryDocument: ["annual.htm"], isXBRL: [1], isInlineXBRL: [1] }, files: [{ name: "CIK0001286613-submissions-001.json" }] },
      },
      "https://data.sec.gov/submissions/CIK0001286613-submissions-001.json": {
        accessionNumber: ["0002"], form: ["8-K"], filingDate: ["2021-01-01"], reportDate: ["2021-01-01"], primaryDocument: ["event.htm"], isXBRL: [0], isInlineXBRL: [0],
      },
    });
    const submission = await client.fetchCompanySubmission(1286613);
    expect(submission.filings.map((filing) => filing.accessionNumber)).toEqual(["0001", "0002"]);
    expect(submission.cachedResponses).toHaveLength(2);
    expect(submission).toMatchObject({ sicDescription: "Services-Educational Services", entityType: "operating", stateOfIncorporation: "NJ", businessAddress: { city: "Parsippany" } });
    expect(isSupportedMvpForm("10-Q/A")).toBe(true);
    expect(isSupportedMvpForm("DEF 14A")).toBe(false);
  });
});
