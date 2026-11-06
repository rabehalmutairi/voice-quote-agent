import { transcriptContainsEvidence } from "../../utils/evidence";

/**
 * Fixture-only model for optional user questions that can be sent along with
 * an electronics-repair request.
 *
 * The backend contracts do not currently define custom-question answers. The
 * model therefore keeps canonical-looking snake_case names and a deliberately
 * small boundary, but must not be treated as a replacement for the backend
 * Quote contract.
 */

export const MAX_CUSTOM_QUESTIONS = 2;
export const MAX_CUSTOM_QUESTION_LENGTH = 240;
export const MAX_CUSTOM_ANSWER_LENGTH = 320;

export const CUSTOM_QUESTION_ANSWER_STATUSES = Object.freeze([
  "found",
  "partial",
  "unanswered",
]);

const answerStatusSet = new Set(CUSTOM_QUESTION_ANSWER_STATUSES);
const evidenceAnswerStatuses = new Set(["found", "partial"]);

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function assertQuestionId(questionId, index, collectionName) {
  if (!/^[a-z][a-z0-9_]*$/u.test(questionId)) {
    throw new TypeError(
      `${collectionName}[${index}].question_id must use letters, numbers, and underscores.`,
    );
  }

  return questionId;
}

function normalizeQuestionId(value, index) {
  const questionId = normalizeText(value) || `custom_question_${index + 1}`;
  return assertQuestionId(questionId, index, "custom_questions");
}

function questionTextFromValue(value) {
  const text = typeof value === "string"
    ? value
    : value?.question_text ?? value?.questionText;
  return normalizeText(text);
}

/**
 * Normalizes a bounded list of optional questions to the fixture view model.
 * Empty arrays are valid because custom questions are optional.
 *
 * @param {Array<string|{question_id?: string, question_text?: string}>} questions
 * @returns {Array<{question_id: string, question_text: string}>}
 */
export function normalizeCustomQuestions(questions = []) {
  if (!Array.isArray(questions)) {
    throw new TypeError("custom_questions must be an array.");
  }

  if (questions.length > MAX_CUSTOM_QUESTIONS) {
    throw new TypeError(`custom_questions supports at most ${MAX_CUSTOM_QUESTIONS} questions.`);
  }

  const normalized = questions.map((question, index) => {
    const questionText = questionTextFromValue(question);

    if (!questionText) {
      throw new TypeError(`custom_questions[${index}].question_text must be non-empty.`);
    }

    if (questionText.length > MAX_CUSTOM_QUESTION_LENGTH) {
      throw new TypeError(`custom_questions[${index}].question_text is too long.`);
    }

    return {
      question_id: normalizeQuestionId(question?.question_id ?? question?.questionId, index),
      question_text: questionText,
    };
  });

  const questionIds = normalized.map((question) => question.question_id);
  if (new Set(questionIds).size !== questionIds.length) {
    throw new TypeError("custom_questions question_id values must be unique.");
  }

  return normalized;
}

/**
 * Safe parser used by UI boundaries that need to show validation feedback.
 */
export function validateCustomQuestions(questions = []) {
  try {
    return { success: true, data: normalizeCustomQuestions(questions), error: null };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: error instanceof Error ? error.message : "Invalid custom questions.",
    };
  }
}

function normalizeAnswerStatus(value, index) {
  const status = normalizeText(value);

  if (!answerStatusSet.has(status)) {
    throw new TypeError(
      `custom_answers[${index}].answer_status must be found, partial, or unanswered.`,
    );
  }

  return status;
}

/**
 * Validates fixture-only, evidence-aware answers. `found` and `partial`
 * answers must point to a shop transcript turn. `unanswered` is intentionally
 * text-only: it explains the missing result without fabricating evidence.
 *
 * @param {Array<Object>} answers
 * @param {{ questions?: Array<Object>, transcript?: Array<Object> }} options
 * @returns {Array<Object>}
 */
export function normalizeCustomQuestionAnswers(answers = [], options = {}) {
  if (!Array.isArray(answers)) {
    throw new TypeError("custom_answers must be an array.");
  }

  const expectedQuestions = options?.questions;
  const transcript = options?.transcript;
  const normalizedExpectedQuestions = expectedQuestions === undefined
    ? undefined
    : normalizeCustomQuestions(expectedQuestions);
  const expectedQuestionIds = normalizedExpectedQuestions === undefined
    ? undefined
    : new Set(normalizedExpectedQuestions.map((question) => question.question_id));

  if (transcript !== undefined && !Array.isArray(transcript)) {
    throw new TypeError("transcript must be an array when validating custom answer evidence.");
  }

  if (answers.length > MAX_CUSTOM_QUESTIONS) {
    throw new TypeError(`custom_answers supports at most ${MAX_CUSTOM_QUESTIONS} answers.`);
  }

  const normalized = answers.map((answer, index) => {
    if (!answer || typeof answer !== "object" || Array.isArray(answer)) {
      throw new TypeError(`custom_answers[${index}] must be an object.`);
    }

    const questionId = normalizeText(answer.question_id ?? answer.questionId);
    if (!questionId) {
      throw new TypeError(`custom_answers[${index}].question_id must be non-empty.`);
    }

    // Keep standalone fixture answers on the same bounded identifier surface
    // as normalized questions. Expected-question validation below still owns
    // the cross-reference when a question list is available.
    assertQuestionId(questionId, index, "custom_answers");

    if (expectedQuestionIds !== undefined) {
      if (!expectedQuestionIds.has(questionId)) {
        throw new TypeError(`custom_answers[${index}].question_id must match a custom question.`);
      }
    }

    const answerStatus = normalizeAnswerStatus(answer.answer_status ?? answer.answerStatus, index);
    const answerText = normalizeText(answer.answer_text ?? answer.answerText);
    if (!answerText) {
      throw new TypeError(`custom_answers[${index}].answer_text must be non-empty.`);
    }

    if (answerText.length > MAX_CUSTOM_ANSWER_LENGTH) {
      throw new TypeError(`custom_answers[${index}].answer_text is too long.`);
    }

    const evidenceQuote = normalizeText(answer.evidence_quote ?? answer.evidenceQuote);
    const evidenceTurn = answer.evidence_turn ?? answer.evidenceTurn;
    const normalizedAnswer = {
      question_id: questionId,
      answer_text: answerText,
      answer_status: answerStatus,
    };

    if (evidenceAnswerStatuses.has(answerStatus)) {
      if (!evidenceQuote || !Number.isInteger(evidenceTurn) || evidenceTurn < 0) {
        throw new TypeError(
          `custom_answers[${index}] ${answerStatus} results require evidence_quote and evidence_turn.`,
        );
      }

      if (transcript !== undefined) {
        const evidenceTurnMatch = transcript.find((turn) => turn?.i === evidenceTurn);
        if (
          !evidenceTurnMatch
          || evidenceTurnMatch.speaker !== "shop"
          || !transcriptContainsEvidence(evidenceTurnMatch.text, evidenceQuote)
        ) {
          throw new TypeError(
            `custom_answers[${index}] evidence must match the referenced shop transcript turn.`,
          );
        }
      }

      return {
        ...normalizedAnswer,
        evidence_quote: evidenceQuote,
        evidence_turn: evidenceTurn,
      };
    }

    if (evidenceQuote || evidenceTurn !== undefined) {
      throw new TypeError("Unanswered custom results must not contain evidence.");
    }

    return normalizedAnswer;
  });

  const questionIds = normalized.map((answer) => answer.question_id);
  if (new Set(questionIds).size !== questionIds.length) {
    throw new TypeError("custom_answers question_id values must be unique.");
  }

  return normalized;
}

export function validateCustomQuestionAnswers(answers = [], options = {}) {
  try {
    return {
      success: true,
      data: normalizeCustomQuestionAnswers(answers, options),
      error: null,
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: error instanceof Error ? error.message : "Invalid custom answers.",
    };
  }
}
