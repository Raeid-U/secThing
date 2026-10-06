import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalCik, filingArchiveDirectoryUrl, isSupportedMvpForm, SecClient } from "@secthing/platform";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

async function clientFor(responses: Record<string, unknown>) {
  const dataDir = await mkdtemp(join(tmpdir(), "secthing-sec-test-"));
  directories.push(dataDir);
  const requestedAt: number[] = [];
  const fetch = vi.fn(async (url: string | URL | Request) => {
    requestedAt.push(Date.now());
    const body = responses[String(url)];
    return body === undefined
      ? new Response("not found", { status: 404 })
      : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
  return { dataDir, client: new SecClient({ dataDir, userAgent: "secThing tests@example.com", rateLimitPerSecond: 10, fetch: fetch as typeof globalThis.fetch }), fetch, requestedAt };
}

describe("SEC identity and submissions client", () => {
  it("resolves LINC through the official ticker mapping and formats its CIK", async () => {
    const { client } = await clientFor({
      "https://www.sec.gov/files/company_tickers.json": { "0": { cik_str: 1286613, ticker: "LINC", title: "Lincoln Educational Services Corporation" } },
    });
    await expect(client.resolveTicker("linc")).resolves.toMatchObject({ match: { cik: 1286613, ticker: "LINC" } });
    expect(canonicalCik(1286613)).toBe("0001286613");
  });

  it("serializes concurrent SEC requests at the configured ceiling", async () => {
    const { client, requestedAt } = await clientFor({
      "https://www.sec.gov/files/company_tickers.json": { "0": { cik_str: 1286613, ticker: "LINC", title: "Lincoln Educational Services Corporation" } },
    });
    await Promise.all([client.resolveTicker("LINC"), client.resolveTicker("LINC")]);
    expect(requestedAt).toHaveLength(2);
    expect(requestedAt[1] - requestedAt[0]).toBeGreaterThanOrEqual(95);
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

  it("preserves filing-array alignment while treating empty optional fields as absent", async () => {
    const { client } = await clientFor({
      "https://data.sec.gov/submissions/CIK0001286613.json": {
        name: "Lincoln Educational Services Corporation",
        filings: {
          recent: {
            accessionNumber: ["0001", "0002"],
            form: ["8-K", "SCHEDULE 13G/A"],
            filingDate: ["2026-08-10", "2026-07-29"],
            reportDate: ["2026-08-10", ""],
            primaryDocument: ["event.htm", "primary.xml"],
            items: ["2.02", ""],
          },
          files: [],
        },
      },
    });
    const submission = await client.fetchCompanySubmission(1286613);
    expect(submission.filings).toEqual([
      expect.objectContaining({ accessionNumber: "0001", reportDate: "2026-08-10", items: "2.02" }),
      expect.objectContaining({ accessionNumber: "0002", reportDate: undefined, primaryDocument: "primary.xml", items: undefined }),
    ]);
  });

  it("acquires the SEC-indexed primary filing and preserves immutable source metadata", async () => {
    const cik = 1286613;
    const accessionNumber = "0001286613-25-000001";
    const directory = filingArchiveDirectoryUrl(cik, accessionNumber);
    const { dataDir } = await clientFor({});
    const fetch = vi.fn(async (url: string | URL | Request) => {
      const key = String(url);
      if (key.endsWith("index.json")) return new Response(JSON.stringify({ directory: { item: [{ name: "annual-report.htm", type: "10-K" }] } }), { status: 200, headers: { "content-type": "application/json" } });
      if (key.endsWith("annual-report.htm")) return new Response("<html><body>Annual report</body></html>", { status: 200, headers: { "content-type": "text/html" } });
      return new Response("not found", { status: 404 });
    });
    const directClient = new SecClient({ dataDir, userAgent: "secThing tests@example.com", rateLimitPerSecond: 10, fetch: fetch as typeof globalThis.fetch });
    const acquired = await directClient.acquirePrimaryFiling({ cik, accessionNumber, formType: "10-K", primaryDocument: "annual-report.htm" });
    expect(acquired).toMatchObject({ documentName: "annual-report.htm", documentType: "primary_filing", url: `${directory}/annual-report.htm`, contentType: "text/html", byteSize: 39 });
    await expect((await import("node:fs/promises")).readFile(acquired.bodyPath, "utf8")).resolves.toBe("<html><body>Annual report</body></html>");
  });
});
