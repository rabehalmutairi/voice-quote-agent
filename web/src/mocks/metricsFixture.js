import { deriveMetrics } from "../features/metrics/deriveMetrics";

/**
 * Synthetic source records for the internal PR 5 dashboard.
 *
 * These values are intentionally illustrative. They must never be described as
 * production performance or used to make an evaluation claim.
 */
export const metricsFixtureSource = {
  dataMode: "simulated",
  provenance: {
    label: "بيانات محاكاة فقط",
    notice: "هذه الأرقام توضيحية من بيانات محاكاة، وليست قياسات من الإنتاج.",
    source: "مجموعة مكالمات اصطناعية للعرض الداخلي",
  },
  successCriteria: {
    minimumUsableQuotes: 2,
    description: "تُعد المهمة ناجحة عندما تقدم محلان على الأقل عرضاً قابلاً للاستخدام.",
  },
  tasks: [
    {
      taskId: "sim_task_01",
      calls: [
        { callId: "call_01", outcome: "human_completed", durationSeconds: 104, costUsd: 0.24, usableQuote: true },
        { callId: "call_02", outcome: "human_completed", durationSeconds: 110, costUsd: 0.24, usableQuote: true },
        { callId: "call_03", outcome: "no_answer", durationSeconds: 58, costUsd: 0.08, usableQuote: false },
      ],
    },
    {
      taskId: "sim_task_02",
      calls: [
        { callId: "call_04", outcome: "human_completed", durationSeconds: 62, costUsd: 0.24, usableQuote: true },
        { callId: "call_05", outcome: "human_completed", durationSeconds: 68, costUsd: 0.24, usableQuote: true },
        { callId: "call_06", outcome: "human_partial", durationSeconds: 72, costUsd: 0.18, usableQuote: false },
      ],
    },
    {
      taskId: "sim_task_03",
      calls: [
        { callId: "call_07", outcome: "human_completed", durationSeconds: 76, costUsd: 0.24, usableQuote: true },
        { callId: "call_08", outcome: "human_partial", durationSeconds: 80, costUsd: 0.18, usableQuote: true },
        { callId: "call_09", outcome: "other", durationSeconds: 84, costUsd: 0.72, usableQuote: false },
      ],
    },
    {
      taskId: "sim_task_04",
      calls: [
        { callId: "call_10", outcome: "human_completed", durationSeconds: 88, costUsd: 0.24, usableQuote: true },
        { callId: "call_11", outcome: "human_completed", durationSeconds: 92, costUsd: 0.24, usableQuote: true },
        { callId: "call_12", outcome: "no_answer", durationSeconds: 96, costUsd: 0.08, usableQuote: false },
      ],
    },
    {
      taskId: "sim_task_05",
      calls: [
        { callId: "call_13", outcome: "human_completed", durationSeconds: 100, costUsd: 0.24, usableQuote: true },
        { callId: "call_14", outcome: "human_partial", durationSeconds: 104, costUsd: 0.18, usableQuote: true },
        { callId: "call_15", outcome: "human_completed", durationSeconds: 108, costUsd: 0.24, usableQuote: true },
      ],
    },
    {
      taskId: "sim_task_06",
      calls: [
        { callId: "call_16", outcome: "human_completed", durationSeconds: 110, costUsd: 0.24, usableQuote: true },
        { callId: "call_17", outcome: "human_partial", durationSeconds: 112, costUsd: 0.18, usableQuote: true },
        { callId: "call_18", outcome: "no_answer", durationSeconds: 116, costUsd: 0.08, usableQuote: false },
      ],
    },
    {
      taskId: "sim_task_07",
      calls: [
        { callId: "call_19", outcome: "human_completed", durationSeconds: 120, costUsd: 0.24, usableQuote: true },
        { callId: "call_20", outcome: "human_completed", durationSeconds: 124, costUsd: 0.24, usableQuote: false },
        { callId: "call_21", outcome: "human_completed", durationSeconds: 128, costUsd: 0.24, usableQuote: false },
      ],
    },
    {
      taskId: "sim_task_08",
      calls: [
        { callId: "call_22", outcome: "human_completed", durationSeconds: 132, costUsd: 0.24, usableQuote: true },
        { callId: "call_23", outcome: "human_completed", durationSeconds: 136, costUsd: 0.24, usableQuote: false },
        { callId: "call_24", outcome: "human_partial", durationSeconds: 140, costUsd: 0.18, usableQuote: false },
      ],
    },
  ],
  fieldResults: {
    price: { label: "السعر", correct: 22, labelled: 24 },
    partType: { label: "نوع القطعة", correct: 21, labelled: 24 },
    warranty: { label: "الضمان", correct: 18, labelled: 20 },
    turnaround: { label: "مدة الإصلاح", correct: 14, labelled: 16 },
  },
  unsupportedValues: {
    count: 1,
    total: 84,
  },
  outcomeLabels: [
    { key: "human_completed", label: "اكتملت مع شخص" },
    { key: "human_partial", label: "اكتملت جزئياً" },
    { key: "no_answer", label: "لم يرد المحل" },
    { key: "other", label: "نتائج أخرى" },
  ],
};

export const metricsFixture = deriveMetrics(metricsFixtureSource);
