import { describe, expect, it } from "vitest";
import { ChunkingAndIndexing, chunkingProfileVersion } from "@secthing/platform";

describe("ChunkingAndIndexing", () => {
  it("creates deterministic, source-offset chunks within their detected section", () => {
    const text = `Item 1. Business\n\n${"Alpha builds software for regulated industries. ".repeat(90)}`;
    const chunks = new ChunkingAndIndexing().process(text, [{ sectionId: 7, sectionType: "business", sectionLabel: "Item 1. Business", startOffset: 0, endOffset: text.length }]);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.startOffset >= 0 && chunk.endOffset <= text.length && text.slice(chunk.startOffset, chunk.endOffset) === chunk.text)).toBe(true);
    expect(chunks[0]).toMatchObject({ sectionId: 7, profile: "narrative", tokenEstimate: expect.any(Number) });
    expect(chunks.map((chunk) => chunk.hash)).toEqual(new ChunkingAndIndexing().process(text, [{ sectionId: 7, sectionType: "business", sectionLabel: "Item 1. Business", startOffset: 0, endOffset: text.length }]).map((chunk) => chunk.hash));
    expect(chunkingProfileVersion).toMatch(/^2026-10-07/);
  });

  it("uses the unknown fallback profile without discarding unclassified evidence", () => {
    const text = "Unclassified filing text. ".repeat(100);
    const chunks = new ChunkingAndIndexing().process(text, [{ sectionId: 3, sectionType: "unknown", sectionLabel: "Full document", startOffset: 0, endOffset: text.length }]);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.profile === "unknown")).toBe(true);
  });
});
