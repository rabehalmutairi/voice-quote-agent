import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { TaskJourneyContext } from "../features/taskFlow/TaskJourneyContext";
import { ReferenceComparisonPage, ReferenceTrackingPage } from "./ReferencePages";

function readyShop() {
  return {
    placeId: "place_1",
    name: "محل تجريبي",
    address: "حي الملقا، الرياض",
    phoneE164: "+966501234567",
    mapsUrl: "https://maps.google.com/?cid=fixture1",
    openNow: true,
    status: "ready",
    quote: {
      options: [{
        partType: { status: "not_mentioned" },
        priceSar: { value: 450, status: "found", evidenceQuote: "أربعمية وخمسين", evidenceTurn: 1 },
        warrantyDays: { status: "not_mentioned" },
      }],
      turnaroundMinutes: { status: "not_mentioned" },
      availability: { status: "not_mentioned" },
      evidenceIssues: [],
    },
    transcript: [{ i: 1, speaker: "shop", t: 0, text: "التجاري بأربعمية وخمسين." }],
  };
}

function renderWithJourney(ui, taskState, actions = {}) {
  return render(
    <MemoryRouter>
      <TaskJourneyContext.Provider value={{ taskState, ...actions }}>
        {ui}
      </TaskJourneyContext.Provider>
    </MemoryRouter>,
  );
}

describe("Reference task pages", () => {
  it("lets the user answer missing information on the tracking route", async () => {
    const user = userEvent.setup();
    const submitAnswers = vi.fn();
    renderWithJourney(<ReferenceTrackingPage />, {
      taskId: "task_1", phase: "needs_input", requestText: "صيانة شاشة", shops: {},
      missingQuestions: [{ key: "device_model", prompt: "وش موديل الجهاز؟" }],
    }, { submitAnswers, isAnswering: false });
    await user.type(screen.getByRole("textbox", { name: "وش موديل الجهاز؟" }), "آيفون 15");
    await user.click(screen.getByRole("button", { name: "متابعة البحث" }));
    expect(submitAnswers).toHaveBeenCalledWith({ device_model: "آيفون 15" });
    expect(screen.queryByText("لم تصل بيانات المحلات بعد.")).not.toBeInTheDocument();
  });
  it("shows canonical answer-only side_by_side results without inventing offers", () => {
    const shop = readyShop();
    shop.quote.options = [];
    shop.quote.answers = [{ question_index: 0, question: "وش السعر؟", status: "found", summary_ar: "السعر 450 ريال.", evidence: [{ quote: "أربعمية وخمسين", turn: 1 }] }];
    renderWithJourney(<ReferenceComparisonPage />, {
      taskId: "task_1", phase: "done", shops: { place_1: shop },
      comparison: { status: "side_by_side", basis: null, ranking: [], excluded: [], cannotCompareReasons: [] },
    });
    expect(screen.getByText("السعر 450 ريال.")).toBeVisible();
    expect(screen.getByText("إجابات موثقة بدون ترتيب")).toBeVisible();
    expect(screen.queryByText("لا توجد عروض مكتملة لعرضها.")).not.toBeInTheDocument();
  });
  it("renders optional shop actions and open status from the active tracking task", () => {
    renderWithJourney(
      <ReferenceTrackingPage />,
      { taskId: "task_1", phase: "calling", requestText: "تغيير شاشة", shops: { place_1: readyShop() } },
    );

    expect(screen.getByText("حي الملقا، الرياض")).toBeVisible();
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("مفتوح الآن")).toBeVisible();
    expect(screen.queryByRole("link", { name: "اتصل بـ محل تجريبي" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "عرض موقع محل تجريبي على خرائط Google" })).toHaveAttribute(
      "href",
      "https://maps.google.com/?cid=fixture1",
    );
  });

  it("does not invent a comparison evidence winner for cannot_compare", () => {
    renderWithJourney(
      <ReferenceComparisonPage />,
      {
        taskId: "task_1",
        phase: "done",
        requestText: "تغيير شاشة",
        shops: { place_1: readyShop() },
        comparison: {
          status: "cannot_compare",
          basis: "نوع القطعة والسعر",
          ranking: [],
          excluded: [],
          cannotCompareReasons: ["لم يذكر المحلان النوع نفسه."],
        },
      },
    );

    expect(screen.getByText("ما نقدر نقارن العروض بشكل عادل")).toBeVisible();
    expect(screen.getByText("لم يذكر المحلان النوع نفسه.")).toBeVisible();
    expect(screen.queryByText("دليل من المكالمة")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "ترتيب العروض" })).not.toBeInTheDocument();
  });

  it("only renders ranking entries backed by returned offers and opens verified transcript evidence", async () => {
    const user = userEvent.setup();
    renderWithJourney(
      <ReferenceComparisonPage />,
      {
        taskId: "task_1",
        phase: "done",
        requestText: "تغيير شاشة",
        shops: { place_1: readyShop() },
        comparison: {
          status: "ranked",
          basis: "السعر",
          ranking: [{ placeId: "missing_place", rank: 1, reason: "غير مدعوم" }],
          excluded: [],
          cannotCompareReasons: [],
        },
      },
    );

    expect(screen.queryByText("الترتيب الذي وصل من المهمة")).not.toBeInTheDocument();
    expect(screen.queryByText("محل غير معروف")).not.toBeInTheDocument();

    // The page must only navigate to transcript evidence when the comparison names a returned offer.
    expect(screen.getByRole("button", { name: "عرض دليل السعر من محل تجريبي" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "عرض دليل السعر من محل تجريبي" }));
    expect(screen.getByRole("dialog", { name: "دليل السعر" })).toBeVisible();
    expect(screen.getByText("التجاري بأربعمية وخمسين.")).toBeVisible();
  });

  it("keeps failed and unavailable task pages empty instead of showing fixture shops", () => {
    const { unmount } = renderWithJourney(<ReferenceTrackingPage />, {
      taskId: "task_failed",
      phase: "failed",
      requestText: "تغيير شاشة",
      shops: {},
      error: "تعذر الاتصال",
    });

    expect(screen.getByText("لم تصل بيانات المحلات بعد.")).toBeVisible();
    expect(screen.queryByText("محل الريان للجوالات")).not.toBeInTheDocument();
    unmount();

    renderWithJourney(<ReferenceComparisonPage />, null);
    expect(screen.getByRole("heading", { name: "لا توجد مقارنة متاحة" })).toBeVisible();
    expect(screen.queryByText("ورشة الأمان")).not.toBeInTheDocument();
  });
});

it("does not label an untraceable answer as documented", () => {
  const shop = readyShop(); shop.quote.options = [];
  shop.quote.answers = [{ question_index: 0, question: "هل يوجد ضمان؟", status: "found", summary_ar: "ضمان ثلاث سنوات", evidence: [{ quote: "ضمان ثلاث سنوات", turn: 1 }] }];
  renderWithJourney(<ReferenceComparisonPage />, { taskId: "task_1", phase: "done", shops: { place_1: shop }, comparison: { status: "side_by_side", ranking: [], excluded: [] } });
  expect(screen.getByText("إجابة غير موثقة")).toBeVisible();
  expect(screen.queryByText("ضمان ثلاث سنوات")).not.toBeInTheDocument();
});

it("places the result summary before the offer details", () => {
  const { container } = renderWithJourney(<ReferenceComparisonPage />, { taskId: "task_1", phase: "partial", shops: { place_1: readyShop() }, comparison: { status: "partial", ranking: [], excluded: [] } });
  const summary = screen.getByRole("region", { name: "نتيجة المهمة" });
  expect(summary.compareDocumentPosition(container.querySelector(".reference-offer-card")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
