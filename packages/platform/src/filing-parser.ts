import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const filingParserVersion = "html-text-v1";

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
};

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

function sectionMatch(line: string, formType: string): { sectionType: string; label: string } | undefined {
  const item = line.match(/^item\s+(\d+(?:\.\d+)?[a-z]?)\s*[.:-]?\s*(.*)$/i);
  if (!item) return undefined;
  const itemNumber = item[1].toUpperCase();
  const label = item[2].trim() || `Item ${itemNumber}`;
  if (formType.startsWith("8-K")) return { sectionType: `item_${itemNumber.replace(".", "_")}`, label: `Item ${itemNumber} ${label}`.trim() };
  const types: Record<string, string> = {
    "1": "business", "1A": "risk_factors", "3": "legal_proceedings", "7": "management_discussion", "7A": "market_risk", "8": "financial_statements", "9A": "controls_and_procedures", "10": "management", "15": "exhibits",
  };
  const sectionType = types[itemNumber];
  return sectionType ? { sectionType, label: `Item ${itemNumber} ${label}`.trim() } : undefined;
}

export function detectFilingSections(text: string, formType: string): ParsedFilingSection[] {
  const headings: Array<{ sectionType: string; label: string; startOffset: number }> = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    const match = sectionMatch(line, formType);
    if (match) headings.push({ ...match, startOffset: offset });
    offset += line.length + 1;
  }
  return headings.map((heading, index) => ({
    ...heading,
    endOffset: headings[index + 1]?.startOffset ?? text.length,
    confidenceStatus: "partial" as const,
  })).filter((section) => section.endOffset > section.startOffset);
}

export class FilingParser {
  async parse(input: { sourcePath: string; contentType: string | null; formType: string; dataDir: string }): Promise<ParsedFiling> {
    const source = await readFile(input.sourcePath, "utf8");
    const text = normalizeFilingText(source, input.contentType);
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
    };
  }
}
