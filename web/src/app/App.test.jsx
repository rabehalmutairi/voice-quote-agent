import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AppLayout } from "../layouts/AppLayout";
import { DemoPage } from "../pages/DemoPage";
import { HomePage } from "../pages/HomePage";
import { LandingPage } from "../pages/LandingPage";
import { MetricsPage } from "../pages/MetricsPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { ReferenceComparisonPage, ReferenceTrackingPage } from "../pages/ReferencePages";

function renderRoute(path = "/") {
  const testRouter = createMemoryRouter(
    [
      {
        element: <AppLayout />,
        children: [
          { path: "/", element: <LandingPage /> },
          { path: "/request", element: <HomePage /> },
          { path: "/demo", element: <DemoPage /> },
          { path: "/tracking", element: <ReferenceTrackingPage /> },
          { path: "/comparison", element: <ReferenceComparisonPage /> },
          { path: "/metrics", element: <MetricsPage /> },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
    { initialEntries: [path] },
  );

  return render(<RouterProvider router={testRouter} />);
}

async function fillRepairDetails(user) {
  await user.click(screen.getByRole("button", { name: "عبّئ التفاصيل" }));
  await user.selectOptions(screen.getByLabelText("نوع الجهاز"), "آيفون");
  await user.type(screen.getByLabelText("الموديل"), "15 برو");
  await user.selectOptions(screen.getByLabelText("نوع الصيانة"), "تغيير شاشة");
  await user.type(screen.getByLabelText("الحي / المدينة"), "حي الملقا");
}

describe("application shell", () => {
  it("renders the product landing page with a clear start action", () => {
    renderRoute();

    expect(screen.getByRole("heading", { level: 1, name: /من وصف المشكلة/ })).toBeVisible();
    expect(screen.getByText("معاينة محاكاة · ليست نتيجة اتصال حقيقي")).toBeVisible();
    expect(screen.getByRole("link", { name: /دليل الحي.*الصفحة الرئيسية/ })).toHaveAttribute("href", "/");
    expect(within(screen.getByRole("navigation", { name: "التنقل الرئيسي" })).getByRole("link", { name: "ابدأ طلبك" })).toHaveAttribute("href", "/request");
  });

  it("keeps the request form on its dedicated route", () => {
    renderRoute("/request");

    expect(screen.getByRole("heading", { level: 1, name: "قارن عروض صيانة جوالك" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "وش تبي تصلّح؟" })).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "السيناريو التجريبي" })).not.toBeInTheDocument();
  });

  it("provides a recovery link for unknown routes", () => {
    renderRoute("/missing");

    expect(screen.getByRole("heading", { name: "الصفحة غير موجودة" })).toBeVisible();
    expect(screen.getByRole("link", { name: "العودة إلى الرئيسية" })).toHaveAttribute("href", "/");
  });

  it("exposes the repeatable demo and internal metrics routes", () => {
    renderRoute("/demo");

    expect(screen.getByRole("heading", { level: 1, name: "العرض التجريبي" })).toBeVisible();
    expect(screen.getByRole("link", { name: "لوحة المقاييس" })).toHaveAttribute("href", "/metrics");
  });

  it("renders the internal metrics dashboard route with its provenance notice", () => {
    renderRoute("/metrics");

    expect(screen.getByRole("heading", { level: 1, name: "لوحة المقاييس الداخلية" })).toBeVisible();
    expect(screen.getByRole("note", { name: "بيانات محاكاة فقط" })).toBeVisible();
  });

  it("keeps direct tracking navigation honest when no task is available", () => {
    renderRoute("/tracking");

    expect(screen.getByRole("heading", { name: "لا يوجد طلب متاح" })).toBeVisible();
    expect(screen.getByRole("link", { name: "ابدأ طلباً جديداً" })).toHaveAttribute("href", "/request");
    expect(screen.queryByText("صيانة السريع")).not.toBeInTheDocument();
  });

  it("keeps direct comparison navigation honest when no task is available", () => {
    renderRoute("/comparison");

    expect(screen.getByRole("heading", { name: "لا توجد مقارنة متاحة" })).toBeVisible();
    expect(screen.getByRole("link", { name: "ابدأ طلباً جديداً" })).toHaveAttribute("href", "/request");
    expect(screen.queryByText("ورشة الأمان")).not.toBeInTheDocument();
  });

  it("keeps the active fixture task connected across tracking and comparison routes", async () => {
    const user = userEvent.setup();
    renderRoute("/demo");

    await user.type(screen.getByRole("textbox", { name: "وش تبي تصلّح؟" }), "أبي أغير شاشة آيفون 15 برو");
    await fillRepairDetails(user);
    await user.click(screen.getByRole("button", { name: "ابدأ البحث عن العروض" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "محل الريان للجوالات" })).toBeVisible());
    await user.click(screen.getByRole("link", { name: "طلبك الحالي" }));

    expect(screen.getByRole("heading", { name: "محل الريان للجوالات" })).toBeVisible();
    expect(screen.queryByText("صيانة السريع")).not.toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "مقارنة العروض" }));
    await waitFor(() => expect(screen.getByText("مقارنة جزئية")).toBeVisible());
    expect(screen.getByRole("heading", { name: "مركز التقنية" })).toBeVisible();
    expect(screen.getByText(/عروض خارج المقارنة/)).toBeVisible();
    expect(screen.getByText(/لم يرد المحل/)).toBeVisible();
    expect(screen.queryByText("الأفضل قيمة")).not.toBeInTheDocument();
  });

  it("keeps the request route focused on creating a request when a task is active", async () => {
    const user = userEvent.setup();
    renderRoute("/request");

    await user.type(screen.getByRole("textbox", { name: "وش تبي تصلّح؟" }), "أبي أغير شاشة آيفون 15 برو");
    await fillRepairDetails(user);
    await user.click(screen.getByRole("button", { name: "ابدأ البحث عن العروض" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "تتبع طلبك" })).toBeVisible());
    await user.click(screen.getByRole("link", { name: "ابدأ طلبك" }));

    expect(screen.getByRole("heading", { name: "قارن عروض صيانة جوالك" })).toBeVisible();
    expect(screen.getByLabelText("الموديل")).toHaveValue("15 برو");
    expect(screen.queryByRole("heading", { name: "تتبع طلبك" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "حالة الاتصال" })).not.toBeInTheDocument();
  });

  it("moves focus to the main content after a route change", async () => {
    const user = userEvent.setup();
    renderRoute();

    await user.click(screen.getByRole("link", { name: "لوحة المقاييس" }));

    await waitFor(() => expect(screen.getByRole("main")).toHaveFocus());
    expect(screen.getByRole("heading", { level: 1, name: "لوحة المقاييس الداخلية" })).toBeVisible();
  });

  it("switches to light mode and remembers the selected theme", async () => {
    const user = userEvent.setup();
    const originalTheme = document.documentElement.dataset.theme;
    const originalStoredTheme = window.localStorage.getItem("voice-quote-theme");

    document.documentElement.dataset.theme = "dark";
    window.localStorage.removeItem("voice-quote-theme");

    try {
      renderRoute();

      await user.click(screen.getByRole("button", { name: "تفعيل الوضع الفاتح" }));

      expect(document.documentElement).toHaveAttribute("data-theme", "light");
      expect(window.localStorage.getItem("voice-quote-theme")).toBe("light");
      expect(screen.getByRole("button", { name: "تفعيل الوضع الداكن" })).toHaveAttribute("aria-pressed", "true");
    } finally {
      if (originalStoredTheme === null) {
        window.localStorage.removeItem("voice-quote-theme");
      } else {
        window.localStorage.setItem("voice-quote-theme", originalStoredTheme);
      }

      document.documentElement.dataset.theme = originalTheme ?? "dark";
    }
  });
});

it("preserves unsent drafts for both modes across route changes", async () => {
  const user = userEvent.setup(); renderRoute("/request");
  await user.type(screen.getByRole("textbox", { name: "وش تبي تصلّح؟" }), "تغيير شاشة جوالي");
  await user.click(screen.getByRole("button", { name: /اسأل عني/ }));
  await user.type(screen.getByLabelText("نوع المحل", { exact: true }), "محل طباعة");
  await user.type(screen.getByLabelText("وش تبي نسأل المحل؟", { exact: true }), "تطبعون A3؟");
  await user.click(screen.getByRole("link", { name: "الرئيسية", exact: true }));
  await user.click(within(screen.getByRole("navigation", { name: "التنقل الرئيسي" })).getByRole("link", { name: "ابدأ طلبك", exact: true }));
  expect(screen.getByLabelText("وش تبي نسأل المحل؟", { exact: true })).toHaveValue("تطبعون A3؟");
  await user.click(screen.getByRole("button", { name: /قارن لي/ }));
  expect(screen.getByRole("textbox", { name: "وش تبي تصلّح؟" })).toHaveValue("تغيير شاشة جوالي");
});

it("keeps the product task alive when changing the demo fixture", async () => {
  const user = userEvent.setup(); renderRoute("/request");
  await user.click(screen.getByRole("button", { name: "استخدم مثالًا تجريبيًا" }));
  await user.click(screen.getByRole("button", { name: "ابدأ البحث عن العروض" }));
  await screen.findByRole("heading", { name: "تتبع طلبك" });
  await user.click(screen.getByRole("link", { name: "العرض التجريبي", exact: true }));
  await user.selectOptions(screen.getByLabelText("السيناريو التجريبي"), "cannot-compare");
  await user.click(screen.getByRole("link", { name: "طلبك الحالي" }));
  expect(screen.getByRole("heading", { name: "تتبع طلبك" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "لا يوجد طلب متاح" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("link", { name: "مقارنة العروض", exact: true }));
  await waitFor(() => expect(screen.getByText("مقارنة جزئية")).toBeVisible());
});

it("keeps Quick Call selection and confirmation across demo changes", async () => {
  const user = userEvent.setup(); renderRoute("/request");
  await user.click(screen.getByRole("button", { name: /اسأل عني/ }));
  await user.click(screen.getByText("جرّب مثال الطباعة"));
  await user.click(screen.getByRole("button", { name: "استخدم المثال" }));
  await user.click(screen.getByRole("button", { name: "اعرض المحلات" }));
  await user.click(await screen.findByRole("button", { name: /اختر المحل.*مطبعة الحي التجريبية/ }));
  await user.click(screen.getByRole("link", { name: "العرض التجريبي", exact: true }));
  await user.selectOptions(screen.getByLabelText("السيناريو التجريبي"), "needs-input");
  await user.click(screen.getByRole("link", { name: "طلبك الحالي" }));
  expect(screen.getByRole("heading", { name: "نتصل بهذا المحل؟" })).toBeVisible();
  expect(screen.getByRole("button", { name: "أكّد وابدأ الاتصال التجريبي" })).toBeEnabled();
});
