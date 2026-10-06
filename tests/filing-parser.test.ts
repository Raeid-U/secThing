import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FilingParser, detectFilingSections, normalizeFilingText } from "@secthing/platform";

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
});
