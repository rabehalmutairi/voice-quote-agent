import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CopyTaskSummary } from "./CopyTaskSummary";
import { buildTaskSummary } from "./taskSummary";

function task() {
  return {
    requestText: "طلب تجريبي",
    phase: "partial",
    shops: {
      one: {
        placeId: "one", name: "محل المثال",
        transcript: [{ i: 1, speaker: "shop", text: "السعر عشرين ريال." }, { i: 2, speaker: "agent", text: "هل السعر ثلاثون ريال؟" }],
        quote: {
          options: [
            { priceSar: { value: 20, status: "found", evidenceQuote: "عشرين ريال", evidenceTurn: 1 } },
            { priceSar: { value: 999, status: "found", evidenceQuote: "ثلاثون ريال", evidenceTurn: 2 } },
          ],
          answers: [{ question: "الضمان؟", status: "found", summary_ar: "ضمان مزعوم", evidence: [{ quote: "يوجد ضمان", turn: 1 }] }],
        },
      },
    },
    comparison: { status: "partial", ranking: [{ rank: 2, placeId: "one", reason: "سبب من المهمة" }, { rank: 1, placeId: "missing", reason: "محل غير موجود" }], excluded: [], cannotCompareReasons: [] },
  };
}

describe("copy result summary", () => {
  it("keeps returned ranks, simulation provenance and only traceable values", () => {
    const result = buildTaskSummary(task());
    expect(result).toContain("بيانات محاكاة فقط");
    expect(result).toContain("2. محل المثال: سبب من المهمة");
    expect(result).toContain("عشرين ريال");
    for (const value of ["999", "ثلاثون ريال", "ضمان مزعوم", "محل غير موجود"]) expect(result).not.toContain(value);
    expect(result).toContain("لا توجد إجابة موثقة");
    expect(result).toContain("إجابة غير موثقة");
  });

  it("identifies each offer and includes only a verified part label", () => {
    const current = task();
    current.shops.one.transcript.push({ i: 3, speaker: "shop", text: "الأصلي أربعين ريال." });
    current.shops.one.quote.options.push({
      partType: { value: "original", status: "found", evidenceQuote: "الأصلي", evidenceTurn: 3 },
      priceSar: { value: 40, status: "found", evidenceQuote: "أربعين ريال", evidenceTurn: 3 },
    });
    current.shops.one.quote.options[0].partType = { value: "commercial", status: "found", evidenceQuote: "تجاري", evidenceTurn: 1 };
    const result = buildTaskSummary(current);
    expect(result).toContain("الخيار ١:");
    expect(result).toContain("الخيار ٣ (أصلي):");
    expect(result).toContain("نوع القطعة: «الأصلي»");
    expect(result).not.toContain("تجاري");
  });

  it("copies the current result and announces success", async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    render(<CopyTaskSummary task={task()} />);
    await user.click(screen.getByRole("button", { name: "نسخ ملخص النتيجة" }));
    expect(write).toHaveBeenCalledWith(buildTaskSummary(task()));
    expect(screen.getByRole("status")).toHaveTextContent("تم نسخ ملخص النتيجة.");
    write.mockRestore();
  });

  it("offers selectable text when clipboard access fails", async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    render(<CopyTaskSummary task={task()} />);
    await user.click(screen.getByRole("button", { name: "نسخ ملخص النتيجة" }));
    expect(screen.getByRole("textbox", { name: "ملخص للنسخ اليدوي" })).toHaveValue(buildTaskSummary(task()));
    expect(screen.getByRole("status")).toHaveTextContent("تعذر النسخ التلقائي");
    write.mockRestore();
  });
});
