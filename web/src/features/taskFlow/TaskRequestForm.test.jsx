import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TaskRequestForm } from "./TaskRequestForm";

function renderForm() {
  const onSubmit = vi.fn();
  render(<TaskRequestForm onSubmit={onSubmit} isSubmitting={false} error={null} />);
  return onSubmit;
}
const details = (user) => user.click(screen.getByRole("button", { name: "عبّئ التفاصيل" }));
const submit = (user) => user.click(screen.getByRole("button", { name: "ابدأ البحث عن العروض" }));

describe("TaskRequestForm", () => {
  it("starts with one empty written request, and no fabricated details", async () => {
    const user = userEvent.setup(); renderForm();
    expect(screen.getByRole("textbox", { name: "وش تبي تصلّح؟" })).toHaveValue("");
    expect(screen.queryByLabelText("الموديل")).not.toBeInTheDocument();
    await details(user);
    for (const label of ["نوع الجهاز", "الموديل", "نوع الصيانة", "الحي / المدينة"]) expect(screen.getByLabelText(label)).toHaveValue("");
    expect(screen.queryByRole("textbox", { name: "وش تبي تصلّح؟" })).not.toBeInTheDocument();
  });
  it("validates empty text in Arabic and focuses the missing input", async () => {
    const user = userEvent.setup(); const onSubmit = renderForm();
    await submit(user);
    expect(screen.getByRole("alert")).toHaveTextContent("اكتب طلب الصيانة أولاً.");
    expect(screen.getByRole("textbox", { name: "وش تبي تصلّح؟" })).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });
  it("builds a structured request without asking for a duplicate description", async () => {
    const user = userEvent.setup(); const onSubmit = renderForm();
    await details(user);
    await user.selectOptions(screen.getByLabelText("نوع الجهاز"), "آيفون");
    await user.type(screen.getByLabelText("الموديل"), "15 برو");
    await user.selectOptions(screen.getByLabelText("نوع الصيانة"), "تغيير شاشة");
    await user.type(screen.getByLabelText("الحي / المدينة"), "حي الملقا");
    await user.type(screen.getByLabelText("ملاحظة إضافية (اختياري)"), "أفضل اليوم");
    await submit(user);
    expect(onSubmit).toHaveBeenCalledWith({ category: "electronics_repair", target: null, request_text: "تغيير شاشة آيفون 15 برو، في حي الملقا، أفضل اليوم", slots: { device_model: "آيفون 15 برو", repair_type: "تغيير شاشة" }, area: { label: "حي الملقا", radius_m: 5000 }, max_businesses: 3, missing_slots: [] });
  });
  it("keeps entered fields and focuses the first missing detail", async () => {
    const user = userEvent.setup(); const onSubmit = renderForm();
    await details(user);
    await user.type(screen.getByLabelText("الموديل"), "آيفون 15");
    await submit(user);
    expect(screen.getByLabelText("نوع الصيانة")).toHaveFocus();
    expect(screen.getByLabelText("الموديل")).toHaveValue("آيفون 15");
    expect(onSubmit).not.toHaveBeenCalled();
  });
  it("preserves each input path but excludes stale details from written requests", async () => {
    const user = userEvent.setup(); const onSubmit = renderForm();
    await details(user);
    await user.type(screen.getByLabelText("الموديل"), "جهاز قديم");
    await user.click(screen.getByRole("button", { name: "اكتب طلبك" }));
    await user.type(screen.getByRole("textbox", { name: "وش تبي تصلّح؟" }), "تغيير بطارية جوالي في العليا");
    await submit(user);
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ request_text: "تغيير بطارية جوالي في العليا", slots: {}, area: null }));
    await details(user);
    expect(screen.getByLabelText("الموديل")).toHaveValue("جهاز قديم");
  });
  it("offers an editable stock example without sending it and clears drafts explicitly", async () => {
    const user = userEvent.setup(); const onSubmit = renderForm();
    await user.selectOptions(screen.getByLabelText("نوع الطلب"), "stock_check");
    await user.click(screen.getByRole("button", { name: "استخدم مثالًا تجريبيًا" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText("المنتج أو القطعة")).toHaveValue("آيفون 16");
    await submit(user);
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ category: "stock_check", slots: { item: "آيفون 16" }, request_text: "فحص توفر آيفون 16، في الملقا" }));
    await user.click(screen.getByRole("button", { name: "مسح المسودة" }));
    expect(screen.getByRole("textbox", { name: "وش تبي تصلّح؟" })).toHaveValue("");
  });
});
