import { createHash } from "node:crypto";

export const chunkingProfileVersion = "2026-10-07.1";

export type ChunkProfile = "narrative" | "unknown" | "table_heavy" | "event";

export type ChunkingSection = {
  sectionId: number;
  sectionType: string;
  sectionLabel: string;
  startOffset: number;
  endOffset: number;
};

export type IndexedChunk = {
  sectionId: number;
  profile: ChunkProfile;
  startOffset: number;
  endOffset: number;
  text: string;
  hash: string;
  tokenEstimate: number;
};

type ChunkingProfile = { maximumCharacters: number; overlapCharacters: number };

const profiles: Record<ChunkProfile, ChunkingProfile> = {
  narrative: { maximumCharacters: 1_600, overlapCharacters: 180 },
  unknown: { maximumCharacters: 1_300, overlapCharacters: 140 },
  table_heavy: { maximumCharacters: 900, overlapCharacters: 80 },
  event: { maximumCharacters: 1_000, overlapCharacters: 100 },
};

function profileFor(section: ChunkingSection): ChunkProfile {
  if (section.sectionType === "unknown") return "unknown";
  if (/table|financial_statements/i.test(section.sectionType)) return "table_heavy";
  if (/^8-K$/i.test(section.sectionLabel) || /^item\s+[0-9]+\.[0-9]+/i.test(section.sectionLabel)) return "event";
  return "narrative";
}

function nextBoundary(text: string, start: number, maximum: number): number {
  const limit = Math.min(text.length, start + maximum);
  if (limit === text.length) return limit;
  const candidates = [text.lastIndexOf("\n\n", limit), text.lastIndexOf(". ", limit), text.lastIndexOf("\n", limit), text.lastIndexOf(" ", limit)]
    .map((offset, index) => offset < start + Math.floor(maximum * 0.55) ? -1 : offset + (index === 1 ? 1 : 0))
    .filter((offset) => offset > start);
  return candidates[0] ?? limit;
}

function nextStart(text: string, end: number, overlap: number): number {
  if (end >= text.length) return end;
  const target = Math.max(0, end - overlap);
  const boundary = text.indexOf(" ", target);
  return boundary >= 0 && boundary < end ? boundary + 1 : target;
}

export class ChunkingAndIndexing {
  process(normalizedText: string, sections: ChunkingSection[]): IndexedChunk[] {
    const output: IndexedChunk[] = [];
    for (const section of sections) {
      const profile = profileFor(section);
      const settings = profiles[profile];
      let start = section.startOffset;
      while (start < section.endOffset) {
        const slice = normalizedText.slice(start, section.endOffset);
        const relativeEnd = nextBoundary(slice, 0, settings.maximumCharacters);
        const end = start + relativeEnd;
        const text = normalizedText.slice(start, end).trim();
        if (text) {
          const leadingWhitespace = normalizedText.slice(start, end).indexOf(text);
          const chunkStart = start + leadingWhitespace;
          const chunkEnd = chunkStart + text.length;
          output.push({
            sectionId: section.sectionId,
            profile,
            startOffset: chunkStart,
            endOffset: chunkEnd,
            text,
            hash: createHash("sha256").update(text).digest("hex"),
            tokenEstimate: Math.max(1, Math.ceil(text.split(/\s+/).length * 1.3)),
          });
        }
        if (end >= section.endOffset) break;
        start = nextStart(normalizedText, end, settings.overlapCharacters);
      }
    }
    return output;
  }
}
