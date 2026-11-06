import { describe, expect, it } from "vitest";
import { deriveMetrics } from "./deriveMetrics";
import { metricsFixture, metricsFixtureSource } from "../../mocks/metricsFixture";

describe("deriveMetrics", () => {
  it("calculates latency from every source call and reports the real sample size", () => {
    const derivedMetrics = deriveMetrics(metricsFixtureSource);

    expect(derivedMetrics.callLatency).toHaveLength(24);
    expect(derivedMetrics.headline.medianCallLatency).toMatchObject({
      value: 104,
      sampleSize: 24,
    });
    expect(derivedMetrics.headline.reachRate).toMatchObject({
      numerator: 20,
      denominator: 24,
    });
  });

  it("derives cost per successful task from source costs and the two-quote criterion", () => {
    const { costPerSuccessfulTaskUsd } = deriveMetrics(metricsFixtureSource).headline;

    expect(costPerSuccessfulTaskUsd).toMatchObject({
      value: 0.91,
      totalCostUsd: 5.46,
      successfulTaskCount: 6,
    });
    expect(costPerSuccessfulTaskUsd.supporting).toContain("$5.46 ÷ ٦ مهام محاكاة ناجحة");
    expect(metricsFixture.headline.taskCompletion).toMatchObject({
      numerator: 15,
      denominator: 20,
    });
  });

  it("keeps aggregate accuracy at zero when no values are labelled", () => {
    const derivedMetrics = deriveMetrics({
      ...metricsFixtureSource,
      tasks: [],
      fieldResults: {
        warranty: { label: "الضمان", correct: 0, labelled: 0 },
      },
      unsupportedValues: { count: 0, total: 0 },
    });

    expect(derivedMetrics.fieldAccuracy).toEqual([
      { key: "warranty", label: "الضمان", correct: 0, labelled: 0 },
    ]);
    expect(derivedMetrics.headline.criticalFieldAccuracy.value).toBe(0);
  });
});
