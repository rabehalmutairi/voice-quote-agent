import { expect, it } from "vitest";
import { buildTaskSummary } from "./taskSummary";

it("copies refusal evidence without formatting it as a confirmed price or part type", () => {
  const refused = { status: "refused", evidenceQuote: "السعر ما نحدده بالتلفون", evidenceTurn: 1 };
  const task = { phase: "done", shops: { a: { placeId: "a", name: "المحل", quote: { options: [{ partType: refused, priceSar: refused }] }, transcript: [{ i: 1, speaker: "shop", t: 0, text: refused.evidenceQuote }] } } };
  const summary = buildTaskSummary(task);
  expect(summary).toContain("المحل رفض ذكر السعر");
  expect(summary).toContain(refused.evidenceQuote);
  expect(summary).not.toContain("NaN");
  expect(summary).not.toContain("ريال");
  expect(summary).not.toContain("غير محدد");
});
