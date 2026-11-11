import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HomePage } from "../../pages/HomePage";
import { createMockTransport } from "../../api/mockTransport";
import { foundationScenario } from "../../mocks/scenarios/foundationScenario";

function renderTaskFlow(transport) {
  return render(
    <StrictMode>
      <HomePage transport={transport} />
    </StrictMode>,
  );
}

async function fillRepairDetails(user) {
  await user.click(screen.getByRole("button", { name: "عبّئ التفاصيل" }));
  await user.selectOptions(screen.getByLabelText("نوع الجهاز"), "آيفون");
  await user.type(screen.getByLabelText("الموديل"), "15 برو");
  await user.selectOptions(screen.getByLabelText("نوع الصيانة"), "تغيير شاشة");
  await user.type(screen.getByLabelText("الحي / المدينة"), "حي الملقا");
}

function needsInputSnapshot() {
  return {
    taskId: "fixture_needs_input",
    phase: "needs_input",
    requestText: "أبي أغير شاشة جوالي",
    answers: {},
    missingQuestions: [
      { key: "device_model", prompt: "وش نوع الجهاز وموديله بالضبط؟" },
      { key: "area", prompt: "وين تبي المحلات تكون؟" },
    ],
    shops: [],
    comparison: null,
  };
}

function createNeedsInputTransport() {
  const initialSnapshot = needsInputSnapshot();

  return {
    createTask: vi.fn(async (request) => ({
      ...initialSnapshot,
      requestText: typeof request === "string" ? request : request.request_text,
    })),
    submitAnswers: vi.fn(async (_taskId, answers) => ({
      ...initialSnapshot,
      phase: "needs_input",
      answers,
    })),
    startTask: vi.fn(async () => ({
      ...initialSnapshot,
      phase: "discovering",
      answers: { device_model: "iPhone 15 Pro", area: "حي الملقا" },
      missingQuestions: [],
    })),
    getTask: vi.fn(async () => initialSnapshot),
    subscribe: vi.fn(() => () => {}),
  };
}

describe("fixture task flow", () => {
  it("starts a fixture task and updates three shop cards without a refresh", async () => {
    const user = userEvent.setup();
    renderTaskFlow(createMockTransport(foundationScenario));

    const request = screen.getByRole("textbox", { name: "وش تبي تصلّح؟" });
    await user.type(request, "أبي أغير شاشة آيفون 15 برو");
    await fillRepairDetails(user);
    await user.click(screen.getByRole("button", { name: "ابدأ البحث عن العروض" }));

    expect(screen.getByRole("heading", { name: "نتابع طلبك" })).toBeVisible();
    expect(screen.getByRole("status")).toBeVisible();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "محل الريان للجوالات" })).toBeVisible();
      expect(screen.getByRole("heading", { name: "مركز التقنية" })).toBeVisible();
      expect(screen.getByRole("heading", { name: "جوالك بلس" })).toBeVisible();
    });

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("اكتملت النتائج جزئياً.");
      expect(screen.getByText("تعذر الاتصال")).toBeVisible();
      expect(screen.getAllByText("تم استلام العرض")).toHaveLength(2);
    });

    expect(screen.getByRole("heading", { name: "مقارنة العروض" })).toBeVisible();
    expect(screen.getByText("أربعمية وخمسين")).toBeVisible();
    expect(screen.getAllByRole("button", { name: /عرض دليل السعر من/ })).toHaveLength(2);
  });

  it("shows follow-up questions and starts the fixture after answers are submitted", async () => {
    const user = userEvent.setup();
    const transport = createNeedsInputTransport();
    renderTaskFlow(transport);

    await user.type(
      screen.getByRole("textbox", { name: "وش تبي تصلّح؟" }),
      "أبي أغير شاشة جوالي",
    );
    await user.click(screen.getByRole("button", { name: "ابدأ البحث عن العروض" }));

    expect(screen.getByRole("heading", { name: "نحتاج تفاصيل إضافية" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "وش نوع الجهاز وموديله بالضبط؟" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "وين تبي المحلات تكون؟" })).toBeVisible();

    await user.type(
      screen.getByRole("textbox", { name: "وش نوع الجهاز وموديله بالضبط؟" }),
      "iPhone 15 Pro",
    );
    await user.type(screen.getByRole("textbox", { name: "وين تبي المحلات تكون؟" }), "حي الملقا");
    await user.click(screen.getByRole("button", { name: "متابعة البحث" }));

    await waitFor(() => {
      expect(transport.submitAnswers).toHaveBeenCalledWith("fixture_needs_input", {
        device_model: "iPhone 15 Pro",
        area: "حي الملقا",
      });
      expect(transport.startTask).toHaveBeenCalledWith("fixture_needs_input");
      expect(screen.getByText("نبحث عن محلات قريبة مناسبة لطلبك.")).toBeVisible();
    });
  });

  it("keeps the request form accessible and focuses it when submitted empty", async () => {
    const user = userEvent.setup();
    renderTaskFlow(createMockTransport(foundationScenario));

    const request = screen.getByRole("textbox", { name: "وش تبي تصلّح؟" });
    await user.click(screen.getByRole("button", { name: "ابدأ البحث عن العروض" }));

    expect(screen.getByRole("alert")).toHaveTextContent("اكتب طلب الصيانة أولاً.");
    expect(request).toHaveFocus();
  });

  it("does not submit or start until every required answer is present", async () => {
    const user = userEvent.setup();
    const transport = createNeedsInputTransport();
    renderTaskFlow(transport);

    await user.type(
      screen.getByRole("textbox", { name: "وش تبي تصلّح؟" }),
      "أبي أغير شاشة جوالي",
    );
    await user.click(screen.getByRole("button", { name: "ابدأ البحث عن العروض" }));

    const device = screen.getByRole("textbox", { name: "وش نوع الجهاز وموديله بالضبط؟" });
    const area = screen.getByRole("textbox", { name: "وين تبي المحلات تكون؟" });
    await user.type(device, "iPhone 15 Pro");
    await user.click(screen.getByRole("button", { name: "متابعة البحث" }));

    expect(screen.getByRole("alert")).toHaveTextContent("أكمل التفاصيل المطلوبة قبل المتابعة.");
    expect(area).toHaveFocus();
    expect(transport.submitAnswers).not.toHaveBeenCalled();
    expect(transport.startTask).not.toHaveBeenCalled();
  });

  it("shows a safe Arabic error without exposing transport details", async () => {
    const user = userEvent.setup();
    const transport = {
      createTask: vi.fn(async () => {
        throw new Error("provider secret: upstream timeout");
      }),
      submitAnswers: vi.fn(),
      startTask: vi.fn(),
      getTask: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    };
    renderTaskFlow(transport);

    const request = screen.getByRole("textbox", { name: "وش تبي تصلّح؟" });
    await user.type(
      request,
      "أبي أغير شاشة جوالي",
    );
    await user.click(screen.getByRole("button", { name: "ابدأ البحث عن العروض" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("تعذر بدء طلب العروض الآن. حاول مرة أخرى.");
    });
    expect(request).toHaveAttribute("aria-describedby", "repair-request-hint repair-request-error");
    expect(request).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByText("provider secret: upstream timeout")).not.toBeInTheDocument();
  });

  it("uses phase-specific copy when a task fails before discovering shops", async () => {
    const user = userEvent.setup();
    const failedSnapshot = {
      taskId: "fixture_failed_empty",
      phase: "failed",
      requestText: "أبي أغير شاشة جوالي",
      answers: {},
      missingQuestions: [],
      shops: [],
      comparison: null,
      error: "تعذر العثور على محلات.",
    };
    const transport = {
      createTask: vi.fn(async () => failedSnapshot),
      submitAnswers: vi.fn(),
      startTask: vi.fn(async () => failedSnapshot),
      getTask: vi.fn(async () => failedSnapshot),
      subscribe: vi.fn(() => () => {}),
    };

    renderTaskFlow(transport);
    await user.type(screen.getByRole("textbox", { name: "وش تبي تصلّح؟" }), "أبي أغير شاشة جوالي");
    await user.click(screen.getByRole("button", { name: "ابدأ البحث عن العروض" }));

    await waitFor(() => {
      expect(screen.getByText("تعذر إكمال بعض أجزاء الطلب؛ نعرض فقط الحالات التي وصلت.")).toBeVisible();
      expect(screen.getByText("تعذر الوصول إلى محلات في هذه المهمة، لذلك لا نعرض نتائج افتراضية.")).toBeVisible();
    });
  });
});
