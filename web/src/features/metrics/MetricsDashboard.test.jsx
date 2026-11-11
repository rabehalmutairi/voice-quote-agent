import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MetricsDashboard } from "./MetricsDashboard";
import { metricsFixture } from "../../mocks/metricsFixture";

describe("MetricsDashboard", () => {
  it("labels fixture metrics as simulated and not production measurements", () => {
    render(<MetricsDashboard metrics={metricsFixture} />);

    expect(screen.getByRole("heading", { level: 1, name: "لوحة المقاييس الداخلية" })).toBeVisible();
    expect(screen.getByRole("note", { name: "بيانات محاكاة فقط" })).toBeVisible();
    expect(screen.getByText("هذه الأرقام توضيحية من بيانات محاكاة، وليست قياسات من الإنتاج.")).toBeVisible();
    expect(screen.getByText("المصدر: مجموعة مكالمات اصطناعية للعرض الداخلي")).toBeVisible();
  });

  it("presents headline metrics with units and supporting counts", () => {
    render(<MetricsDashboard metrics={metricsFixture} />);

    expect(screen.getByText("الوصول إلى شخص")).toBeVisible();
    expect(screen.getByText("٢٠ من ٢٤ محاولة محاكاة")).toBeVisible();
    expect(screen.getByText("إكمال المهمة بعد الوصول لشخص")).toBeVisible();
    expect(screen.getByText("١٥ من ٢٠ مكالمة محاكاة")).toBeVisible();
    expect(screen.getByText("التكلفة لكل طلب ناجح")).toBeVisible();
    expect(screen.getByText("$0.91")).toBeVisible();
    expect(screen.getByText("$5.46 ÷ ٦ مهام محاكاة ناجحة · معيار النجاح: عرضان قابلان للاستخدام لكل مهمة")).toBeVisible();
    expect(screen.getByText("زمن المكالمة الوسيط")).toBeVisible();
    expect(screen.getByRole("heading", { name: "زمن المكالمة الوسيط" }).parentElement)
      .toHaveTextContent("١٠٤ ثانية من ٢٤ مكالمة محاكاة");
  });

  it("maps fixture ratios to the metric bar widths", () => {
    const { container } = render(<MetricsDashboard metrics={metricsFixture} />);
    const fills = container.querySelectorAll(".metric-bar__fill");

    expect(fills).toHaveLength(2 + metricsFixture.fieldAccuracy.length + metricsFixture.outcomes.length + 2);
    expect(Number.parseFloat(fills[0].style.getPropertyValue("--metric-width")))
      .toBeCloseTo(metricsFixture.headline.reachRate.value * 100);
    expect(fills[1].style.getPropertyValue("--metric-width"))
      .toBe(`${metricsFixture.headline.taskCompletion.value * 100}%`);
    expect(Number.parseFloat(fills[2].style.getPropertyValue("--metric-width")))
      .toBeCloseTo((metricsFixture.fieldAccuracy[0].correct / metricsFixture.fieldAccuracy[0].labelled) * 100);
    expect(Number.parseFloat(fills[fills.length - 1].style.getPropertyValue("--metric-width")))
      .toBeCloseTo(metricsFixture.headline.unsupportedValueRate.value * 100);
  });

  it("renders zero accuracy rather than NaN for an unlabelled field", () => {
    const zeroLabelledMetrics = {
      ...metricsFixture,
      fieldAccuracy: [{ key: "warranty", label: "الضمان", correct: 0, labelled: 0 }],
      outcomes: [{ key: "other", label: "نتائج أخرى", count: 1 }],
      callLatency: [metricsFixture.callLatency[0]],
    };

    render(<MetricsDashboard metrics={zeroLabelledMetrics} />);

    const warrantyRow = screen.getByRole("row", { name: /الضمان/ });
    expect(warrantyRow).toHaveTextContent("٠٪");
    expect(warrantyRow.querySelector(".metric-bar__fill").style.getPropertyValue("--metric-width"))
      .toBe("0%");
  });

  it("uses an accessible table for field accuracy and a text alternative for latency", () => {
    render(<MetricsDashboard metrics={metricsFixture} />);

    const accuracyTable = screen.getByRole("table", { name: "دقة الحقول الحرجة في بيانات المحاكاة" });
    expect(accuracyTable).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "الحقل" })).toBeVisible();
    expect(screen.getByRole("row", { name: /السعر/ })).toHaveTextContent("٩١٫٧٪");

    const latencyTable = screen.getByRole("table", { name: "زمن كل مكالمة محاكاة" });
    expect(latencyTable).toBeVisible();
    expect(within(latencyTable).getByRole("row", { name: "مكالمة ١ مكتملة ١٠٤ ثانية" })).toBeVisible();
    expect(latencyTable.querySelectorAll("tbody tr")).toHaveLength(24);
  });

  it("falls back safely for unknown latency outcomes", () => {
    const malformedMetrics = {
      ...metricsFixture,
      callLatency: [{ ...metricsFixture.callLatency[0], outcome: "__proto__" }],
    };

    render(<MetricsDashboard metrics={malformedMetrics} />);

    expect(screen.getByRole("row", { name: "مكالمة ١ مكتملة ١٠٤ ثانية" })).toBeVisible();
  });

  it("does not render fabricated values while metrics are loading", () => {
    render(<MetricsDashboard status="loading" metrics={null} />);

    expect(screen.getByRole("status", { name: "جارٍ تحميل المقاييس" })).toBeVisible();
    expect(screen.getByText("لم تصل بيانات المقاييس بعد. لن نعرض أرقاماً مؤقتة على أنها نتائج.")).toBeVisible();
    expect(screen.queryByText("٪")).not.toBeInTheDocument();
  });

  it("renders an honest error state instead of dereferencing a failed source", () => {
    render(<MetricsDashboard status="error" metrics={null} error="تعذر الاتصال بمصدر المقاييس" />);

    expect(screen.getByRole("alert", { name: "تعذر تحميل المقاييس" })).toBeVisible();
    expect(screen.getByText("تعذر الاتصال بمصدر المقاييس")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "مؤشرات أساسية" })).not.toBeInTheDocument();
  });

  it("renders an empty state when the source has no observations", () => {
    const emptyMetrics = {
      ...metricsFixture,
      headline: {
        ...metricsFixture.headline,
        reachRate: { ...metricsFixture.headline.reachRate, value: 0 },
        medianCallLatency: { ...metricsFixture.headline.medianCallLatency, value: 0, sampleSize: 0 },
        taskCompletion: { ...metricsFixture.headline.taskCompletion, value: 0 },
      },
      fieldAccuracy: [],
      outcomes: [],
      callLatency: [],
    };

    render(<MetricsDashboard metrics={emptyMetrics} />);

    expect(screen.getByRole("status", { name: "لا توجد مقاييس متاحة" })).toBeVisible();
    expect(screen.getByText("لم تتوفر ملاحظات كافية لبناء هذه اللوحة. لن نعرض أصفاراً على أنها بيانات فعلية.")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "مؤشرات أساسية" })).not.toBeInTheDocument();
  });

  it("does not label a non-simulated source as simulated", () => {
    const externalMetrics = {
      ...metricsFixture,
      dataMode: "external",
      provenance: {
        ...metricsFixture.provenance,
        label: "مصدر خارجي غير موثق",
        notice: "لم يتم التحقق من هذا المصدر في بيئة المحاكاة.",
      },
    };

    render(<MetricsDashboard metrics={externalMetrics} />);

    expect(screen.getByRole("note", { name: "مصدر خارجي غير موثق" })).toBeVisible();
    expect(screen.queryByText("محاكاة", { selector: ".data-provenance__badge" })).not.toBeInTheDocument();
  });

  it("shows an honest malformed-data state instead of NaN values", () => {
    const malformedMetrics = {
      ...metricsFixture,
      headline: {
        ...metricsFixture.headline,
        reachRate: { ...metricsFixture.headline.reachRate, value: "unknown" },
      },
    };

    render(<MetricsDashboard metrics={malformedMetrics} />);

    expect(screen.getByRole("alert", { name: "تعذر قراءة المقاييس" })).toBeVisible();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });
});
