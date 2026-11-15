import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EvidenceField } from "./EvidenceField";
import { formatMinutes } from "./formatEvidence";

const transcript = [{ i: 1, speaker: "shop", t: 1, text: "من ساعة لساعتين، والضمان ما نحدده بالتلفون" }];
describe("canonical range and refusal evidence", () => {
  it("shows a numeric range without inventing an exact value", () => {
    render(<dl><EvidenceField label="مدة الإصلاح" field={{ status: "found", valueMin: 60, valueMax: 120, evidenceQuote: "من ساعة لساعتين", evidenceTurn: 1 }} formatter={formatMinutes} transcript={transcript} onInspect={() => {}} /></dl>);
    expect(screen.getByText("٦٠ دقيقة – ١٢٠ دقيقة")).toBeVisible();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });
  it("opens the shop's proof for a refused field while showing no fabricated value", async () => {
    const onInspect = vi.fn();
    render(<dl><EvidenceField label="الضمان" field={{ status: "refused", evidenceQuote: "الضمان ما نحدده بالتلفون", evidenceTurn: 1 }} transcript={transcript} onInspect={onInspect} /></dl>);
    expect(screen.getByText("المحل رفض إعطاء هذه المعلومة.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "عرض دليل الضمان" }));
    expect(onInspect).toHaveBeenCalledWith(expect.objectContaining({ field: expect.objectContaining({ status: "refused", evidenceTurn: 1 }) }));
  });
});
