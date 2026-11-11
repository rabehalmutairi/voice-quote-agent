import { shopStateSchema } from "../contracts/provisionalSchemas";

const transcript = [
  { i: 0, speaker: "agent", t: 0, text: "السلام عليكم، نبي نتأكد من توفر القطعة." },
  { i: 1, speaker: "shop", t: 8, text: "إيه، الشاشة التجارية موجودة الحين." },
];

const quote = {
  options: [
    {
      partType: {
        value: "commercial",
        status: "found",
        confidence: 0.92,
        evidenceQuote: "الشاشة التجارية",
        evidenceTurn: 1,
      },
      priceSar: { status: "not_mentioned" },
      warrantyDays: { status: "not_mentioned" },
    },
  ],
  turnaroundMinutes: { status: "not_mentioned" },
  availability: {
    value: "available",
    status: "found",
    confidence: 0.96,
    evidenceQuote: "موجودة الحين",
    evidenceTurn: 1,
  },
  evidenceIssues: [],
};

const business = {
  placeId: "fixture_stock_shop",
  name: "محل تجربة التوفر",
  phoneE164: "+966501111111",
  numberType: "mobile",
  address: "حي الملقا، الرياض",
  mapsUrl: "https://maps.google.com/?cid=fixture-stock",
  openNow: true,
  rating: 4.3,
};

// Validate the underlying shop/quote through the existing provisional contract
// at module load. Custom question fields deliberately live outside this schema.
const validatedShop = shopStateSchema.parse({
  ...business,
  status: "ready",
  callId: "call_fixture_stock",
  outcome: "human_completed",
  quote,
  transcript,
});

export const stockAvailabilityFixture = Object.freeze({
  fixture_id: "fixture_stock_availability",
  fixture_type: "electronics_repair_availability",
  provenance: {
    mode: "fixture",
    label: "محاكاة التوفر",
    notice: "هذه نتيجة تجريبية مبنية على محادثة محاكاة، وليست نتيجة اتصال حقيقي.",
  },
  task_spec: {
    category: "electronics_repair",
    request_text: "أبي أتأكد إذا شاشة آيفون 15 برو متوفرة",
    slots: {
      device_model: "آيفون 15 برو",
      repair_type: "تغيير شاشة",
    },
    area: {
      label: "حي الملقا",
      radius_m: 5000,
    },
    max_businesses: 1,
    missing_slots: [],
    created_at: "2026-10-26T18:00:00Z",
  },
  business: validatedShop,
  quote: validatedShop.quote,
  transcript: validatedShop.transcript,
  custom_questions: [],
  custom_answers: [],
});
