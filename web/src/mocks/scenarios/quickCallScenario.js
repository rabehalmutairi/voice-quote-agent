import { normalizeTranscriptText } from "../../utils/evidence";

const SCRIPTED_QUESTIONS = new Set([
  "تطبعون A2 اليوم وكم سعر الورقة؟",
  "تطبعون A2 اليوم؟",
].map(normalizeTranscriptText));

export const quickCallCandidates = [
  { placeId: "mock_print_direct", name: "مطبعة الحي التجريبية", phoneE164: "+966500000001", numberType: "mobile", address: "موقع افتراضي للمحاكاة" },
  { placeId: "mock_print_landline", name: "مطبعة الورق التجريبية", phoneE164: "+966500000002", numberType: "landline", address: "موقع افتراضي للمحاكاة" },
  { placeId: "mock_print_920", name: "مركز طباعة برقم موحد — تجريبي", numberType: "unified_920" },
  { placeId: "mock_print_800", name: "مركز طباعة برقم مجاني — تجريبي", numberType: "toll_free_800" },
];

// Synthetic, scripted shop replies. No network, live prices or phone calls.
export function createQuickCallScenario(draft, business, outcome = "answered") {
  const taskId = "fixture_quick_call";
  const callId = "fixture_quick_call_01";
  const transcript = [{ i: 0, speaker: "agent", t: 0, text: "السلام عليكم، مساعد صوتي يستفسر عن الطباعة." }];
  const answers = draft.custom_questions.map((question, question_index) => {
    if (outcome === "not_mentioned") return { question_index, question, status: "not_mentioned", summary_ar: null, evidence: [] };
    const recognized = SCRIPTED_QUESTIONS.has(normalizeTranscriptText(question));
    const reply = recognized ? "نطبع A2 اليوم بعشرين ريال للورقة." : "ما أقدر أأكد لك هالمعلومة الآن.";
    const turn = question_index + 1;
    transcript.push({ i: turn, speaker: "shop", t: turn * 10, text: reply });
    return { question_index, question, status: recognized ? "found" : "unclear", summary_ar: reply, evidence: [{ quote: reply, turn }] };
  });
  const quote = { options: [], answers, evidenceIssues: [] };
  const comparison = { status: "side_by_side", basis: null, ranking: [], excluded: [], cannotCompareReasons: [] };
  const event = (sequence, type, data) => ({ delayMs: sequence * 400, event: {
    taskId, type, sequence, eventId: `quick_${sequence}`, at: "2026-11-04T09:00:00.000Z", data,
  } });
  return {
    snapshot: { taskId, phase: "idle", requestText: draft.request_text, shops: [], answers: {}, missingQuestions: [] },
    events: [
      event(1, "task.created", { requestText: draft.request_text }),
      event(2, "business.found", { business }),
      event(3, "call.started", { callId, placeId: business.placeId }),
      ...(outcome === "no_answer" ? [
        event(4, "call.failed", { callId, placeId: business.placeId, outcome: "no_answer", reason: "لم يرد المحل المختار. لم نتصل بمحل بديل." }),
        event(5, "task.failed", { reason: "لم يرد المحل المختار. يمكنك إعادة المحاولة بطلب جديد." }),
      ] : [
        event(4, "call.ended", { callId, placeId: business.placeId, outcome: "human_completed" }),
        event(5, "quote.ready", { callId, placeId: business.placeId, quote, transcript }),
        event(6, "comparison.ready", { comparison }),
      ]),
    ],
  };
}
