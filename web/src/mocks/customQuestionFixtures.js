import {
  normalizeCustomQuestionAnswers,
  normalizeCustomQuestions,
} from "../features/taskFlow/customQuestionModel";
import { stockAvailabilityFixture } from "./stockAvailabilityFixture";

const customQuestions = normalizeCustomQuestions([
  { question_id: "availability", question_text: "هل القطعة متوفرة الآن؟" },
  { question_id: "originality", question_text: "هل القطعة أصلية؟" },
]);

function createCustomQuestionFixture(fixtureId, resultState, answers) {
  return Object.freeze({
    fixture_id: fixtureId,
    fixture_type: "electronics_repair_custom_questions",
    result_state: resultState,
    provenance: {
      mode: "fixture",
      label: "محاكاة الأسئلة الإضافية",
      notice: "هذه إجابات تجريبية من محادثة محاكاة، وليست نتيجة اتصال حقيقي.",
    },
    task_spec: structuredClone(stockAvailabilityFixture.task_spec),
    business: structuredClone(stockAvailabilityFixture.business),
    quote: structuredClone(stockAvailabilityFixture.quote),
    transcript: structuredClone(stockAvailabilityFixture.transcript),
    custom_questions: structuredClone(customQuestions),
    custom_answers: normalizeCustomQuestionAnswers(answers, {
      questions: customQuestions,
      transcript: stockAvailabilityFixture.transcript,
    }),
  });
}

// No custom answer event was received. This is not the same as an unanswered
// shop response, so it stays a fixture-only result_state and has no answer rows.
export const customQuestionMissingFixture = createCustomQuestionFixture(
  "fixture_custom_questions_missing",
  "missing",
  [],
);

export const customQuestionPartialFixture = createCustomQuestionFixture(
  "fixture_custom_questions_partial",
  "partial",
  [
    {
      question_id: "availability",
      answer_text: "نعم، القطعة متوفرة الآن.",
      answer_status: "found",
      evidence_quote: "موجودة الحين",
      evidence_turn: 1,
    },
    {
      question_id: "originality",
      answer_text: "أكد المحل وجود شاشة، لكنه لم يؤكد أنها أصلية.",
      answer_status: "partial",
      evidence_quote: "الشاشة التجارية موجودة الحين",
      evidence_turn: 1,
    },
  ],
);

export const customQuestionUnansweredFixture = createCustomQuestionFixture(
  "fixture_custom_questions_unanswered",
  "unanswered",
  [
    {
      question_id: "originality",
      answer_text: "ما حصلنا إجابة من المحل.",
      answer_status: "unanswered",
    },
  ],
);

export const customQuestionFixtures = Object.freeze([
  customQuestionMissingFixture,
  customQuestionPartialFixture,
  customQuestionUnansweredFixture,
]);
