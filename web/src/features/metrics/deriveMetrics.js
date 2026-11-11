function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function median(values) {
  if (values.length === 0) {
    return 0;
  }

  const sortedValues = [...values].sort((left, right) => left - right);
  const middleIndex = Math.floor(sortedValues.length / 2);

  if (sortedValues.length % 2 === 0) {
    return (sortedValues[middleIndex - 1] + sortedValues[middleIndex]) / 2;
  }

  return sortedValues[middleIndex];
}

function arabicNumber(value, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("ar-SA", { maximumFractionDigits }).format(value);
}

/**
 * Turns the explicit synthetic source records into the dashboard view model.
 * Keeping this calculation pure makes sample sizes and denominators testable.
 * @param {Object} source
 * @returns {Object}
 */
export function deriveMetrics(source) {
  const calls = source.tasks.flatMap((task) => task.calls.map((call) => ({ ...call, taskId: task.taskId })));
  const humanCalls = calls.filter((call) => call.outcome.startsWith("human_"));
  const completedCalls = calls.filter((call) => call.outcome === "human_completed");
  const successfulTasks = source.tasks.filter((task) => (
    task.calls.filter((call) => call.usableQuote).length >= source.successCriteria.minimumUsableQuotes
  ));
  const totalCostUsd = calls.reduce((total, call) => total + call.costUsd, 0);
  const latencyValues = calls.map((call) => call.durationSeconds);
  const fieldTotals = Object.values(source.fieldResults).reduce(
    (totals, field) => ({
      labelled: totals.labelled + field.labelled,
      correct: totals.correct + field.correct,
    }),
    { labelled: 0, correct: 0 },
  );
  const outcomeCounts = new Map();

  calls.forEach((call) => {
    outcomeCounts.set(call.outcome, (outcomeCounts.get(call.outcome) ?? 0) + 1);
  });

  const latencyMedian = median(latencyValues);
  const costPerSuccessfulTaskUsd = successfulTasks.length === 0
    ? 0
    : totalCostUsd / successfulTasks.length;

  return {
    dataMode: source.dataMode,
    provenance: {
      ...source.provenance,
      coverage: `${arabicNumber(calls.length)} محاولة و${arabicNumber(source.tasks.length)} مهام محاكاة`,
    },
    successCriteria: source.successCriteria,
    headline: {
      reachRate: {
        value: ratio(humanCalls.length, calls.length),
        numerator: humanCalls.length,
        denominator: calls.length,
        supporting: `${arabicNumber(humanCalls.length)} من ${arabicNumber(calls.length)} محاولة محاكاة`,
      },
      taskCompletion: {
        value: ratio(completedCalls.length, humanCalls.length),
        numerator: completedCalls.length,
        denominator: humanCalls.length,
        supporting: `${arabicNumber(completedCalls.length)} من ${arabicNumber(humanCalls.length)} مكالمة محاكاة`,
      },
      criticalFieldAccuracy: {
        value: ratio(fieldTotals.correct, fieldTotals.labelled),
        numerator: fieldTotals.correct,
        denominator: fieldTotals.labelled,
        supporting: `${arabicNumber(fieldTotals.correct)} من ${arabicNumber(fieldTotals.labelled)} قيمة موسومة`,
      },
      unsupportedValueRate: {
        value: ratio(source.unsupportedValues.count, source.unsupportedValues.total),
        numerator: source.unsupportedValues.count,
        denominator: source.unsupportedValues.total,
        supporting: `${arabicNumber(source.unsupportedValues.count)} من ${arabicNumber(source.unsupportedValues.total)} قيمة محاكاة`,
      },
      costPerSuccessfulTaskUsd: {
        value: Number(costPerSuccessfulTaskUsd.toFixed(2)),
        totalCostUsd: Number(totalCostUsd.toFixed(2)),
        successfulTaskCount: successfulTasks.length,
        supporting: `$${totalCostUsd.toFixed(2)} ÷ ${arabicNumber(successfulTasks.length)} مهام محاكاة ناجحة · معيار النجاح: عرضان قابلان للاستخدام لكل مهمة`,
      },
      medianCallLatency: {
        value: latencyMedian,
        sampleSize: calls.length,
        supporting: `${arabicNumber(latencyMedian)} ثانية من ${arabicNumber(calls.length)} مكالمة محاكاة`,
      },
    },
    fieldAccuracy: Object.entries(source.fieldResults).map(([key, field]) => ({
      key,
      label: field.label,
      correct: field.correct,
      labelled: field.labelled,
    })),
    callLatency: calls.map((call, index) => ({
      callId: call.callId,
      label: `مكالمة ${arabicNumber(index + 1)}`,
      outcome: call.outcome,
      seconds: call.durationSeconds,
    })),
    outcomes: source.outcomeLabels.map(({ key, label }) => ({
      key,
      label,
      count: outcomeCounts.get(key) ?? 0,
    })),
  };
}
