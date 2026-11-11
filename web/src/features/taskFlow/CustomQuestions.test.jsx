import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CustomQuestions } from "./CustomQuestions";

describe("CustomQuestions", () => {
  it("submits no questions when the optional section is left empty", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<CustomQuestions onSubmit={onSubmit} />);
    await user.click(screen.getByRole("button", { name: "حفظ الأسئلة" }));

    expect(onSubmit).toHaveBeenCalledWith([]);
    expect(screen.getByRole("region", { name: "أسئلة إضافية للمحل" })).toHaveAttribute("dir", "rtl");
  });

  it("collects at most two questions and returns canonical question fields", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<CustomQuestions onSubmit={onSubmit} />);
    await user.click(screen.getByRole("button", { name: "إضافة سؤال" }));
    await user.type(screen.getByRole("textbox", { name: "السؤال الإضافي 1" }), "هل القطعة متوفرة؟");
    await user.click(screen.getByRole("button", { name: "إضافة سؤال" }));
    await user.type(screen.getByRole("textbox", { name: "السؤال الإضافي 2" }), "كم مدة الضمان؟");

    expect(screen.getByRole("button", { name: "إضافة سؤال" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "حفظ الأسئلة" }));

    expect(onSubmit).toHaveBeenCalledWith([
      { question_id: "custom_question_1", question_text: "هل القطعة متوفرة؟" },
      { question_id: "custom_question_2", question_text: "كم مدة الضمان؟" },
    ]);
  });

  it("blocks an added blank question and focuses it", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<CustomQuestions onSubmit={onSubmit} />);
    await user.click(screen.getByRole("button", { name: "إضافة سؤال" }));
    const question = screen.getByRole("textbox", { name: "السؤال الإضافي 1" });
    await user.click(screen.getByRole("button", { name: "حفظ الأسئلة" }));

    expect(screen.getByRole("alert")).toHaveTextContent("اكتب السؤال الإضافي أو احذفه");
    expect(question).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
