import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const filingParserVersion = "filing-text-v3";

export type ParsedFilingSection = {
  sectionType: string;
  label: string;
  startOffset: number;
  endOffset: number;
  confidenceStatus: "partial";
};

export type ParsedFiling = {
  text: string;
  normalizedTextPath: string;
  textHash: string;
  textLength: number;
  warnings: string[];
  sections: ParsedFilingSection[];
  pages: Array<{ pageNumber: number; startOffset: number; endOffset: number }>;
};

export function pageRangeForOffsets(pages: ParsedFiling["pages"], startOffset: number, endOffset: number) {
  const intersecting = pages.filter((page) => page.endOffset > startOffset && page.startOffset < endOffset);
  return intersecting.length ? { pageStart: intersecting[0].pageNumber, pageEnd: intersecting.at(-1)!.pageNumber } : {};
}

async function extractPdf(buffer: Buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false, useSystemFonts: true }).promise;
  const parts: string[] = [];
  const pages: ParsedFiling["pages"] = [];
  let offset = 0;
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = normalizeFilingText(content.items.flatMap((item) => "str" in item ? [item.str] : []).join(" "), "text/plain");
    if (parts.length) { parts.push("\n\f\n"); offset += 3; }
    const startOffset = offset;
    parts.push(pageText); offset += pageText.length;
    pages.push({ pageNumber, startOffset, endOffset: offset });
  }
  return { text: parts.join(""), pages };
}

function decodeEntities(value: string): string {
  return value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

export function normalizeFilingText(source: string, contentType: string | null): string {
  const looksLikeHtml = contentType?.includes("html") || /<\/?(?:html|body|div|p|table|span)\b/i.test(source);
  const withoutMarkup = looksLikeHtml
    ? source
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(script|style|noscript|head)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<\/?(?:p|div|br|tr|li|h[1-6]|table|section|article|header|footer)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
    : source;
  return decodeEntities(withoutMarkup)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .reduce<string[]>((lines, line) => {
      if (line || lines.at(-1) !== "") lines.push(line);
      return lines;
    }, [])
    .join("\n")
    .trim();
}

function sectionMatch(line: string, formType: string, part: string | undefined): { sectionType: string; label: string } | undefined {
  const item = line.match(/^item\s+(\d+(?:\.\d+)?[a-z]?)\s*[.:-]?\s*(.*)$/i);
  if (!item) return undefined;
  const itemNumber = item[1].toUpperCase();
  const label = item[2].trim() || `Item ${itemNumber}`;
  if (formType.startsWith("8-K")) return { sectionType: `item_${itemNumber.replace(".", "_")}`, label: `Item ${itemNumber} ${label}`.trim() };
  if (formType.startsWith("10-Q")) {
    const types: Record<string, Record<string, string>> = {
      I: { "1": "financial_statements", "2": "management_discussion", "3": "market_risk", "4": "controls_and_procedures" },
      II: { "1": "legal_proceedings", "1A": "risk_factors", "2": "unregistered_sales", "3": "defaults", "4": "mine_safety", "5": "other_information", "6": "exhibits" },
    };
    // A missing Part must not silently turn a quarterly item into an annual one.
    const sectionType = part ? types[part]?.[itemNumber] : undefined;
    return { sectionType: sectionType ?? "unknown", label: `${part ? `Part ${part} — ` : ""}Item ${itemNumber} ${label}`.trim() };
  }
  if (!formType.startsWith("10-K")) return { sectionType: "unknown", label: `Item ${itemNumber} ${label}`.trim() };
  const types: Record<string, string> = {
    "1": "business", "1A": "risk_factors", "3": "legal_proceedings", "7": "management_discussion", "7A": "market_risk", "8": "financial_statements", "9A": "controls_and_procedures", "10": "management", "15": "exhibits",
  };
  const sectionType = types[itemNumber];
  return { sectionType: sectionType ?? "unknown", label: `Item ${itemNumber} ${label}`.trim() };
}

export function detectFilingSections(text: string, formType: string): ParsedFilingSection[] {
  const headings: Array<{ sectionType: string; label: string; startOffset: number }> = [];
  const priorItems = new Map<string, (typeof headings)[number]>();
  let offset = 0;
  let part: string | undefined;
  for (const line of text.split("\n")) {
    const partHeading = line.match(/^part\s+(II|I)\b(?:\s*[.:-]?\s*)(.*)$/i);
    let itemLine = line;
    if (formType.startsWith("10-Q") && partHeading) {
      part = partHeading[1].toUpperCase();
      if (/^item\s/i.test(partHeading[2])) itemLine = partHeading[2];
      else headings.push({ sectionType: "unknown", label: line, startOffset: offset });
    }
    // Printed TOC entries are evidence, but not reliable section boundaries.
    const isContentsEntry = /\.{2,}\s*\d+\s*$/.test(line) || /\s\d+\s*$/.test(line);
    const match = isContentsEntry ? undefined : sectionMatch(itemLine, formType, part);
    if (match) {
      const key = `${part ?? ""}:${itemLine.match(/^item\s+(\d+(?:\.\d+)?[a-z]?)/i)?.[1].toUpperCase()}`;
      const prior = priorItems.get(key);
      if (prior) {
        // A repeated item often comes from the TOC. Keep its text, but do not
        // present that earlier range as confidently classified filing content.
        prior.sectionType = "unknown";
        prior.label = `Unclassified repeated heading — ${prior.label}`;
      }
      const heading = { ...match, startOffset: offset };
      headings.push(heading);
      priorItems.set(key, heading);
    }
    offset += line.length + 1;
  }
  if (headings.length > 0 && headings[0].startOffset > 0) {
    headings.unshift({ sectionType: "unknown", label: "Document preamble", startOffset: 0 });
  }
  return headings.map((heading, index) => ({
    ...heading,
    endOffset: headings[index + 1]?.startOffset ?? text.length,
    confidenceStatus: "partial" as const,
  })).filter((section) => section.endOffset > section.startOffset);
}

export class FilingParser {
  async parse(input: { sourcePath: string; contentType: string | null; formType: string; dataDir: string }): Promise<ParsedFiling> {
    const source = await readFile(input.sourcePath);
    const isPdf = input.contentType?.includes("pdf") || input.sourcePath.toLowerCase().endsWith(".pdf");
    const extracted = isPdf ? await extractPdf(source) : { text: normalizeFilingText(source.toString("utf8"), input.contentType), pages: [] };
    const text = extracted.text;
    if (!text) throw new Error("Filing source produced no readable text.");
    const textHash = createHash("sha256").update(text).digest("hex");
    const directory = join(input.dataDir, "sec", "normalized");
    await mkdir(directory, { recursive: true });
    const normalizedTextPath = join(directory, `${textHash}.txt`);
    await writeFile(normalizedTextPath, text, { flag: "w" });
    const sections = detectFilingSections(text, input.formType);
    return {
      text,
      normalizedTextPath,
      textHash,
      textLength: text.length,
      warnings: sections.length === 0 ? ["No form-aware section headings were detected; the full document is retained as an unknown section."] : [],
      sections,
      pages: extracted.pages,
    };
  }
}
