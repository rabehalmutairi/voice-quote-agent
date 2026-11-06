import { describe, expect, it } from "vitest";
import { normalizeTranscriptText, transcriptContainsEvidence } from "./evidence";

describe("evidence transcript helpers", () => {
  it("normalizes Arabic diacritics, letter variants, digits, punctuation, and whitespace consistently", () => {
    expect(normalizeTranscriptText("  أَلْفٌ ـ ١٢٣!  ")).toBe("الف 123");
  });

  it("matches an evidence phrase only inside the normalized transcript text", () => {
    expect(transcriptContainsEvidence("التجاري بأربعمية وخمسين.", "اَلتجاري   بأربعمية وخمسين")).toBe(true);
    expect(transcriptContainsEvidence("التجاري بأربعمية.", "الأصلي بألف ومتين.")).toBe(false);
    expect(transcriptContainsEvidence("التجاري بأربعمية وخمسين.", "أربعمية وخمس")).toBe(false);
  });
});
