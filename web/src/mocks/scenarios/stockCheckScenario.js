import { stockAvailabilityFixture } from "../stockAvailabilityFixture";

const taskId = "fixture_stock_check";

function event(sequence, type, data) {
  return {
    eventId: `evt_stock_check_${sequence}`,
    sequence,
    type,
    taskId,
    at: `2026-10-26T18:10:${String(sequence).padStart(2, "0")}.000Z`,
    data,
  };
}

const business = {
  placeId: stockAvailabilityFixture.business.placeId,
  name: stockAvailabilityFixture.business.name,
  phoneE164: stockAvailabilityFixture.business.phoneE164,
  numberType: stockAvailabilityFixture.business.numberType,
  address: stockAvailabilityFixture.business.address,
  mapsUrl: stockAvailabilityFixture.business.mapsUrl,
  openNow: stockAvailabilityFixture.business.openNow,
  rating: stockAvailabilityFixture.business.rating,
};

export const stockCheckScenario = {
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
    {
      delayMs: 10,
      event: event(1, "task.created", {
        requestText: stockAvailabilityFixture.task_spec.request_text,
      }),
    },
    { delayMs: 20, event: event(2, "business.found", { business }) },
    {
      delayMs: 35,
      event: event(3, "call.started", {
        callId: "call_fixture_stock",
        placeId: business.placeId,
      }),
    },
    {
      delayMs: 50,
      event: event(4, "call.talking", {
        callId: "call_fixture_stock",
        placeId: business.placeId,
      }),
    },
    {
      delayMs: 75,
      event: event(5, "call.ended", {
        callId: "call_fixture_stock",
        placeId: business.placeId,
        outcome: "human_completed",
        durationSeconds: 48,
      }),
    },
    {
      delayMs: 90,
      event: event(6, "quote.ready", {
        callId: "call_fixture_stock",
        placeId: business.placeId,
        quote: stockAvailabilityFixture.quote,
        transcript: stockAvailabilityFixture.transcript,
      }),
    },
    {
      delayMs: 110,
      event: event(7, "comparison.ready", {
        comparison: {
          status: "ranked",
          basis: "توفر القطعة كما ذكره المحل",
          ranking: [{
            placeId: business.placeId,
            rank: 1,
            reason: "المحل أكد توفر القطعة في المحادثة.",
          }],
          excluded: [],
          cannotCompareReasons: [],
        },
      }),
    },
  ],
};
