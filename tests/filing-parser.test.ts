import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FilingParser, detectFilingSections, normalizeFilingText, pageRangeForOffsets } from "@secthing/platform";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe("FilingParser", () => {
  it("normalizes HTML into stable readable text and detects form-aware sections", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "secthing-parser-test-"));
    directories.push(dataDir);
    const sourcePath = join(dataDir, "source.html");
    await writeFile(sourcePath, "<html><head><title>ignore</title></head><body><h1>Item 1. Business</h1><p>Alpha&nbsp;&amp; beta.</p><script>ignore()</script><h2>Item 1A. Risk Factors</h2><p>Risk text.</p></body></html>");
    const parsed = await new FilingParser().parse({ sourcePath, contentType: "text/html", formType: "10-K", dataDir });
    await expect(readFile(parsed.normalizedTextPath, "utf8")).resolves.toBe("Item 1. Business\n\nAlpha & beta.\n\nItem 1A. Risk Factors\n\nRisk text.");
    expect(parsed.sections).toMatchObject([{ sectionType: "business", startOffset: 0 }, { sectionType: "risk_factors" }]);
  });

  it("keeps readable plain text and preserves a full-document fallback when headings are absent", () => {
    expect(normalizeFilingText("A  plain\r\n\r\n filing", "text/plain")).toBe("A plain\n\nfiling");
    expect(detectFilingSections("Unheaded filing text", "8-K")).toEqual([]);
  });

  it("maps quarterly items by Part, including amendments, without dropping unknown text", () => {
    const text = "Quarterly preamble.\nPART I — FINANCIAL INFORMATION\nItem 1. Financial Statements\nQuarterly accounts.\nItem 2. Management Discussion\nLiquidity commentary.\nPART II — OTHER INFORMATION\nItem 1. Legal Proceedings\nCourt matter.\nItem 1A. Risk Factors\nRisk update.\nItem 6. Exhibits\nExhibit list.";
    const sections = detectFilingSections(text, "10-Q/A");
    expect(sections.filter((s) => s.sectionType !== "unknown").map((s) => s.sectionType))
      .toEqual(["financial_statements", "management_discussion", "legal_proceedings", "risk_factors", "exhibits"]);
    expect(sections.find((s) => s.sectionType === "legal_proceedings")?.label).toContain("Part II");
    expect(sections.map((s) => text.slice(s.startOffset, s.endOffset)).join("")).toBe(text);
    expect(detectFilingSections("Item 1. Financial Statements\nAccounts.", "10-Q")[0].sectionType).toBe("unknown");
    expect(detectFilingSections("PART I. Item 1. Financial Statements\nAccounts.", "10-Q")[0]).toMatchObject({ sectionType: "financial_statements", startOffset: 0 });
  });

  it("retains annual preambles, unrecognized items and TOC text without assigning TOC duplicates to business", () => {
    const text = "Issuer cover.\nItem 1. Business .... 3\nItem 1A. Risk Factors 8\nItem 1. Business\nProducts.\nItem 2. Properties\nFacilities.\nItem 1A. Risk Factors\nSupply risks.";
    const sections = detectFilingSections(text, "10-K");
    expect(sections.map((s) => s.sectionType)).toEqual(["unknown", "business", "unknown", "risk_factors"]);
    expect(sections.map((s) => text.slice(s.startOffset, s.endOffset)).join("")).toBe(text);
    const repeated = detectFilingSections("Item 1. Business\nItem 1A. Risk Factors\nItem 1. Business\nActual body.", "10-K");
    expect(repeated[0].sectionType).toBe("unknown");
    expect(repeated.at(-1)?.sectionType).toBe("business");
  });

  it("keeps current-report numbered items distinct and preserves their full source ranges", () => {
    const text = "Current report.\nItem 2.02 Results of Operations\nEarnings release.\nItem 9.01 Financial Statements and Exhibits\nExhibit 99.";
    const sections = detectFilingSections(text, "8-K/A");
    expect(sections.map((s) => s.sectionType)).toEqual(["unknown", "item_2_02", "item_9_01"]);
    expect(sections.map((s) => text.slice(s.startOffset, s.endOffset)).join("")).toBe(text);
  });

  it("maps normalized offsets to exact PDF page ranges", () => {
    const pages = [
      { pageNumber: 1, startOffset: 0, endOffset: 20 },
      { pageNumber: 2, startOffset: 23, endOffset: 50 },
      { pageNumber: 3, startOffset: 53, endOffset: 80 },
    ];
    expect(pageRangeForOffsets(pages, 25, 45)).toEqual({ pageStart: 2, pageEnd: 2 });
    expect(pageRangeForOffsets(pages, 18, 60)).toEqual({ pageStart: 1, pageEnd: 3 });
    expect(pageRangeForOffsets(pages, 20, 23)).toEqual({});
  });
});
