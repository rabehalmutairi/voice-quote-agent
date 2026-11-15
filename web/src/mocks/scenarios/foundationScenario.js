const taskId = "fixture_foundation";

function event(sequence, type, data) {
  return {
    eventId: `evt_foundation_${sequence}`,
    sequence,
    type,
    taskId,
    at: `2026-10-26T18:00:${String(sequence).padStart(2, "0")}.000Z`,
    data,
  };
}

function foundField(value, evidenceQuote, evidenceTurn = 2) {
  return {
    value,
    status: "found",
    confidence: 0.95,
    evidenceQuote,
    evidenceTurn,
  };
}

const originalQuote = {
  options: [
    {
      partType: foundField("original", "الأصلي"),
      priceSar: foundField(1200, "ألف ومتين"),
      warrantyDays: foundField(90, "ضمان ثلاثة أشهر", 3),
    },
  ],
  turnaroundMinutes: foundField(120, "ساعتين", 4),
  availability: foundField("available", "متوفرة الحين", 4),
  evidenceIssues: [],
};

const commercialQuote = {
  options: [
    {
      partType: foundField("commercial", "التجاري"),
      priceSar: foundField(450, "أربعمية وخمسين"),
      warrantyDays: foundField(30, "ضمان شهر", 3),
    },
  ],
  turnaroundMinutes: foundField(45, "خمسة وأربعين دقيقة", 4),
  availability: foundField("available", "موجودة الحين", 4),
  evidenceIssues: [],
};

const commercialTranscript = [
  { i: 0, speaker: "agent", t: 0, text: "السلام عليكم، معك مساعد ذكاء اصطناعي يتصل نيابة عن العميل." },
  { i: 1, speaker: "shop", t: 6, text: "هلا، تفضل." },
  { i: 2, speaker: "shop", t: 21, text: "التجاري بأربعمية وخمسين." },
  { i: 3, speaker: "shop", t: 32, text: "عليه ضمان شهر." },
  { i: 4, speaker: "shop", t: 43, text: "موجودة الحين، وتاخذ خمسة وأربعين دقيقة." },
];

const originalTranscript = [
  { i: 0, speaker: "agent", t: 0, text: "السلام عليكم، معك مساعد ذكاء اصطناعي يتصل نيابة عن العميل." },
  { i: 1, speaker: "shop", t: 6, text: "هلا، تفضل." },
  { i: 2, speaker: "shop", t: 21, text: "الأصلي بألف ومتين." },
  { i: 3, speaker: "shop", t: 34, text: "عليه ضمان ثلاثة أشهر." },
  { i: 4, speaker: "shop", t: 46, text: "متوفرة الحين، ونخلصها خلال ساعتين." },
];

export const foundationScenario = {
  snapshot: {
    taskId,
    phase: "idle",
    requestText: undefined,
    answers: {},
    missingQuestions: [],
    shops: [],
    comparison: null,
    error: undefined,
  },
  events: [
    { delayMs: 10, event: event(1, "task.created", { requestText: "أبي أغير شاشة آيفون 15 برو" }) },
    {
      delayMs: 20,
      event: event(2, "business.found", {
        business: {
          placeId: "place_1",
          name: "محل الريان للجوالات",
          phoneE164: "+966501234567",
          numberType: "mobile",
          address: "حي الملقا، الرياض",
          mapsUrl: "https://maps.google.com/?cid=fixture1",
          openNow: true,
          rating: 4.4,
        },
      }),
    },
    {
      delayMs: 30,
      event: event(3, "business.found", {
        business: {
          placeId: "place_2",
          name: "مركز التقنية",
          phoneE164: "+966502345678",
          numberType: "mobile",
          address: "حي الياسمين، الرياض",
          mapsUrl: "https://maps.google.com/?cid=fixture2",
          openNow: true,
          rating: 4.1,
        },
      }),
    },
    {
      delayMs: 40,
      event: event(4, "business.found", {
        business: {
          placeId: "place_3",
          name: "جوالك بلس",
          phoneE164: "+966503456789",
          numberType: "landline",
          address: "حي النخيل، الرياض",
          mapsUrl: "https://maps.google.com/?cid=fixture3",
          openNow: true,
          rating: 4.0,
        },
      }),
    },
    { delayMs: 50, event: event(5, "call.started", { callId: "call_1", placeId: "place_1" }) },
    { delayMs: 60, event: event(6, "call.started", { callId: "call_2", placeId: "place_2" }) },
    { delayMs: 70, event: event(7, "call.talking", { callId: "call_1", placeId: "place_1" }) },
    { delayMs: 80, event: event(8, "call.talking", { callId: "call_2", placeId: "place_2" }) },
    { delayMs: 85, event: event(9, "call.started", { callId: "call_3", placeId: "place_3" }) },
    { delayMs: 95, event: event(10, "call.talking", { callId: "call_3", placeId: "place_3" }) },
    {
      delayMs: 110,
      event: event(11, "call.ended", {
        callId: "call_2",
        placeId: "place_2",
        outcome: "human_completed",
        durationSeconds: 110,
      }),
    },
    {
      delayMs: 125,
      event: event(12, "quote.ready", {
        callId: "call_2",
        placeId: "place_2",
        quote: originalQuote,
        transcript: originalTranscript,
      }),
    },
    {
      delayMs: 135,
      event: event(13, "call.failed", {
        callId: "call_3",
        placeId: "place_3",
        outcome: "no_answer",
        reason: "لم يرد المحل على الاتصال.",
      }),
    },
    {
      delayMs: 145,
      event: event(14, "call.ended", {
        callId: "call_1",
        placeId: "place_1",
        outcome: "human_completed",
        durationSeconds: 104,
      }),
    },
    {
      delayMs: 160,
      event: event(15, "quote.ready", {
        callId: "call_1",
        placeId: "place_1",
        quote: commercialQuote,
        transcript: commercialTranscript,
      }),
    },
    {
      delayMs: 180,
      event: event(16, "comparison.ready", {
        comparison: {
          status: "partial",
          basis: "لا يمكن مقارنة القطعة الأصلية بالتجارية كسعر واحد.",
          ranking: [
            { placeId: "place_1", rank: 1, reason: "أرخص عرض تجاري مع ضمان 30 يوماً." },
          ],
          excluded: [
            { placeId: "place_3", reason: "لم يرد المحل." },
          ],
          cannotCompareReasons: ["القطعة الأصلية والتجارية ظهرتا كخيارين مختلفين."],
        },
      }),
    },
  ],
};
