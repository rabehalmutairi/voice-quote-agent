import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { CustomQuestionFixturePanel } from "./CustomQuestionFixturePanel";

describe("CustomQuestionFixturePanel", () => {
  it("shows bounded partial answers and opens their transcript evidence", async () => {
    const user = userEvent.setup();

    render(<CustomQuestionFixturePanel />);

    expect(screen.getByText("نعم، القطعة متوفرة الآن.")).toBeVisible();
    expect(screen.getByText("إجابة جزئية")).toBeVisible();

    await user.click(screen.getAllByRole("button", { name: "عرض الدليل من المكالمة" })[0]);

    expect(screen.getByRole("dialog", { name: "دليل إجابة هل القطعة متوفرة الآن؟" })).toBeVisible();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("موجودة الحين")).toBeVisible();
    expect(within(dialog).getAllByRole("listitem").find(
      (turn) => turn.getAttribute("aria-current") === "true",
    )).toHaveTextContent("موجودة الحين");
  });

  it("renders missing and unanswered fixture states without inventing evidence", async () => {
    const user = userEvent.setup();

    render(<CustomQuestionFixturePanel />);
    const select = screen.getByRole("combobox", { name: "حالة الإجابة" });

    await user.selectOptions(select, "fixture_custom_questions_missing");
    expect(screen.getByText("لم تصل إجابات إضافية في هذا السيناريو.")).toBeVisible();

    await user.selectOptions(select, "fixture_custom_questions_unanswered");
    expect(screen.getAllByText("ما حصلنا إجابة من المحل.")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "عرض الدليل من المكالمة" })).not.toBeInTheDocument();
  });

  it("keeps the optional question input bounded at two questions", async () => {
    const user = userEvent.setup();

    render(<CustomQuestionFixturePanel />);
    const addButton = screen.getByRole("button", { name: "إضافة سؤال" });

    await user.click(addButton);
    await user.type(screen.getByRole("textbox", { name: "السؤال الإضافي 1" }), "هل القطعة متوفرة؟");
    await user.click(addButton);
    await user.type(screen.getByRole("textbox", { name: "السؤال الإضافي 2" }), "كم مدة الضمان؟");
    await user.click(screen.getByRole("button", { name: "حفظ الأسئلة" }));

    expect(screen.getByRole("status")).toHaveTextContent("تم حفظ سؤالين في معاينة المحاكاة فقط.");
    expect(screen.getByRole("textbox", { name: "السؤال الإضافي 1" })).toHaveValue("هل القطعة متوفرة؟");
    expect(addButton).toBeDisabled();
  });
});
