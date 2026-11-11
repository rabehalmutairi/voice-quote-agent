import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MetricsPage } from "./MetricsPage";
import { metricsFixture } from "../mocks/metricsFixture";

describe("MetricsPage", () => {
  it("renders the fixture-backed dashboard with explicit provenance", () => {
    render(<MetricsPage />);

    expect(screen.getByRole("heading", { level: 1, name: "لوحة المقاييس الداخلية" })).toBeVisible();
    expect(screen.getByRole("note", { name: metricsFixture.provenance.label })).toBeVisible();
    expect(screen.getByText(metricsFixture.provenance.notice)).toBeVisible();
    expect(screen.getByText(`المصدر: ${metricsFixture.provenance.source}`)).toBeVisible();
    expect(screen.getByText(`النطاق: ${metricsFixture.provenance.coverage}`)).toBeVisible();
    expect(screen.getByRole("heading", { name: "مؤشرات أساسية" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "أداء المحلات" })).not.toBeInTheDocument();
  });
});
