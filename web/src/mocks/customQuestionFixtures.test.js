import { describe, expect, it } from "vitest";
import { shopStateSchema } from "../contracts/provisionalSchemas";
import {
  customQuestionFixtures,
  customQuestionMissingFixture,
  customQuestionPartialFixture,
  customQuestionUnansweredFixture,
} from "./customQuestionFixtures";
import { stockAvailabilityFixture } from "./stockAvailabilityFixture";
import {
  validateCustomQuestionAnswers,
  validateCustomQuestions,
} from "../features/taskFlow/customQuestionModel";

function parseFixtureShop(fixture) {
  return shopStateSchema.safeParse({
    ...fixture.business,
    status: "ready",
    quote: fixture.quote,
    transcript: fixture.transcript,
  });
}

describe("custom question and availability fixtures", () => {
  it("keeps stock availability under electronics_repair and validates the existing quote shape", () => {
    expect(stockAvailabilityFixture.fixture_type).toBe("electronics_repair_availability");
    expect(stockAvailabilityFixture.task_spec.category).toBe("electronics_repair");
    expect(stockAvailabilityFixture.provenance.mode).toBe("fixture");
    expect(stockAvailabilityFixture.provenance.notice).toContain("محاكاة");
    expect(parseFixtureShop(stockAvailabilityFixture).success).toBe(true);
    expect(stockAvailabilityFixture.quote.availability).toMatchObject({
      status: "found",
      value: "available",
      evidenceTurn: 1,
    });
  });

  it("keeps missing, partial, and unanswered results explicit and bounded", () => {
    expect(customQuestionFixtures).toHaveLength(3);
    expect(customQuestionMissingFixture.custom_answers).toEqual([]);
    expect(customQuestionPartialFixture.custom_answers.map((answer) => answer.answer_status)).toEqual([
      "found",
      "partial",
    ]);
    expect(customQuestionUnansweredFixture.custom_answers[0]).toEqual({
      question_id: "originality",
      answer_text: "ما حصلنا إجابة من المحل.",
      answer_status: "unanswered",
    });

    for (const fixture of customQuestionFixtures) {
      expect(validateCustomQuestions(fixture.custom_questions).success).toBe(true);
      expect(validateCustomQuestionAnswers(fixture.custom_answers, {
        questions: fixture.custom_questions,
        transcript: fixture.transcript,
      }).success).toBe(true);
      expect(parseFixtureShop(fixture).success).toBe(true);
      expect(fixture.provenance.notice).toContain("محاكاة");
    }
  });
});
