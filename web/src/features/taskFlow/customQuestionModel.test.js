import { describe, expect, it } from "vitest";
import {
  normalizeCustomQuestionAnswers,
  normalizeCustomQuestions,
  validateCustomQuestions,
} from "./customQuestionModel";

describe("fixture custom question model", () => {
  it("accepts zero, one, or two non-empty user questions with snake_case fields", () => {
    expect(normalizeCustomQuestions()).toEqual([]);
    expect(normalizeCustomQuestions(["هل القطعة متوفرة؟"])).toEqual([
      { question_id: "custom_question_1", question_text: "هل القطعة متوفرة؟" },
    ]);
    expect(normalizeCustomQuestions([
      { question_id: "availability", question_text: "هل القطعة متوفرة؟" },
      { question_text: "كم مدة الضمان؟" },
    ])).toEqual([
      { question_id: "availability", question_text: "هل القطعة متوفرة؟" },
      { question_id: "custom_question_2", question_text: "كم مدة الضمان؟" },
    ]);
  });

  it("rejects more than two questions and empty questions", () => {
    expect(() => normalizeCustomQuestions(["سؤال ١", "سؤال ٢", "سؤال ٣"])).toThrow("at most 2");
    expect(validateCustomQuestions(["   "]).success).toBe(false);
    expect(validateCustomQuestions(["سؤال", " "]).error).toContain("non-empty");
  });

  it("requires evidence for found and partial answers", () => {
    expect(normalizeCustomQuestionAnswers([
      {
        question_id: "availability",
        answer_text: "نعم، القطعة متوفرة.",
        answer_status: "found",
        evidence_quote: "موجودة الحين",
        evidence_turn: 3,
      },
      {
        question_id: "warranty",
        answer_text: "ذكر المحل وجود ضمان لكنه لم يذكر المدة.",
        answer_status: "partial",
        evidence_quote: "عليه ضمان",
        evidence_turn: 4,
      },
    ])).toMatchObject([
      { answer_status: "found", evidence_quote: "موجودة الحين", evidence_turn: 3 },
      { answer_status: "partial", evidence_quote: "عليه ضمان", evidence_turn: 4 },
    ]);

    expect(() => normalizeCustomQuestionAnswers([{
      question_id: "availability",
      answer_text: "ما تأكدنا.",
      answer_status: "partial",
    }])).toThrow("evidence_quote and evidence_turn");
  });

  it("can verify custom evidence against shop transcript turns when provided", () => {
    const transcript = [
      { i: 1, speaker: "agent", text: "بسجل سؤالك." },
      { i: 2, speaker: "shop", text: "إيه، موجودة الحين." },
    ];

    expect(() => normalizeCustomQuestionAnswers([{
      question_id: "availability",
      answer_text: "نعم، متوفرة.",
      answer_status: "found",
      evidence_quote: "بسجل سؤالك",
      evidence_turn: 1,
    }], { transcript })).toThrow("match the referenced shop transcript turn");

    expect(() => normalizeCustomQuestionAnswers([{
      question_id: "availability",
      answer_text: "نعم، متوفرة.",
      answer_status: "found",
      evidence_quote: "غير موجود في المكالمة",
      evidence_turn: 2,
    }], { transcript })).toThrow("match the referenced shop transcript turn");

    expect(normalizeCustomQuestionAnswers([{
      question_id: "availability",
      answer_text: "نعم، متوفرة.",
      answer_status: "found",
      evidence_quote: "موجودة الحين",
      evidence_turn: 2,
    }], {
      questions: [{ question_id: "availability", question_text: "هل القطعة متوفرة؟" }],
      transcript,
    })).toHaveLength(1);
  });

  it("keeps answer identifiers bounded and unique without an expected question list", () => {
    expect(() => normalizeCustomQuestionAnswers([{
      question_id: "Availability?",
      answer_text: "نعم.",
      answer_status: "unanswered",
    }])).toThrow("must use letters, numbers, and underscores");

    expect(() => normalizeCustomQuestionAnswers([
      { question_id: "availability", answer_text: "نعم.", answer_status: "unanswered" },
      { question_id: "availability", answer_text: "نعم.", answer_status: "unanswered" },
    ])).toThrow("must be unique");
  });

  it("keeps unanswered results explicit without fabricated evidence", () => {
    expect(normalizeCustomQuestionAnswers([{
      question_id: "warranty",
      answer_text: "ما حصلنا إجابة من المحل.",
      answer_status: "unanswered",
    }])).toEqual([{
      question_id: "warranty",
      answer_text: "ما حصلنا إجابة من المحل.",
      answer_status: "unanswered",
    }]);

    expect(() => normalizeCustomQuestionAnswers([{
      question_id: "warranty",
      answer_text: "ما حصلنا إجابة.",
      answer_status: "unanswered",
      evidence_quote: "لم يجب",
      evidence_turn: 2,
    }])).toThrow("must not contain evidence");
  });
});
