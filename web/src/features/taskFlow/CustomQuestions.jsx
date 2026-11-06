import { useRef, useState } from "react";
import {
  MAX_CUSTOM_QUESTIONS,
  validateCustomQuestions,
} from "./customQuestionModel";

function getInitialQuestionValues(initialQuestions) {
  if (!Array.isArray(initialQuestions)) {
    return [];
  }

  return initialQuestions
    .slice(0, MAX_CUSTOM_QUESTIONS)
    .map((question) => (typeof question === "string" ? question : question?.question_text ?? ""));
}

/**
 * Optional RTL input for at most two user-authored questions.
 *
 * It intentionally returns only the bounded question view model. The parent
 * decides whether and how the current fixture transport can carry it.
 */
export function CustomQuestions({ initialQuestions = [], onSubmit, isSubmitting = false }) {
  const [questionValues, setQuestionValues] = useState(() => getInitialQuestionValues(initialQuestions));
  const [validationError, setValidationError] = useState(null);
  const inputRefs = useRef([]);

  function handleAddQuestion() {
    if (questionValues.length >= MAX_CUSTOM_QUESTIONS || isSubmitting) {
      return;
    }

    setQuestionValues((currentQuestions) => [...currentQuestions, ""]);
    setValidationError(null);
  }

  function handleRemoveQuestion(index) {
    if (isSubmitting) {
      return;
    }

    setQuestionValues((currentQuestions) => currentQuestions.filter((_, currentIndex) => currentIndex !== index));
    setValidationError(null);
  }

  function handleChange(index, event) {
    setQuestionValues((currentQuestions) => currentQuestions.map((question, currentIndex) => (
      currentIndex === index ? event.target.value : question
    )));
    if (validationError) {
      setValidationError(null);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    const validation = validateCustomQuestions(questionValues);

    if (!validation.success) {
      setValidationError("اكتب السؤال الإضافي أو احذفه قبل المتابعة.");
      const firstInvalidIndex = questionValues.findIndex((question) => !question.trim());
      inputRefs.current[firstInvalidIndex >= 0 ? firstInvalidIndex : 0]?.focus();
      return;
    }

    setValidationError(null);
    onSubmit(validation.data);
  }

  return (
    <section className="follow-up-panel custom-questions" dir="rtl" lang="ar" aria-labelledby="custom-questions-title">
      <h2 id="custom-questions-title">أسئلة إضافية للمحل</h2>
      <p id="custom-questions-description">
        أضف سؤالين كحد أقصى إذا عندك تفاصيل إضافية. هذه الأسئلة اختيارية ويمكنك المتابعة بدونها.
      </p>
      <form className="follow-up-form" noValidate onSubmit={handleSubmit}>
        <fieldset aria-describedby="custom-questions-description">
          <legend className="visually-hidden">أسئلة اختيارية</legend>
          {questionValues.length === 0 ? (
            <p className="field-hint">ما أضفت أي سؤال إضافي.</p>
          ) : null}
          {questionValues.map((question, index) => (
            <div className="field-group" key={`custom-question-${index + 1}`}>
              <label htmlFor={`custom-question-${index + 1}`}>السؤال الإضافي {index + 1}</label>
              <input
                ref={(element) => {
                  inputRefs.current[index] = element;
                }}
                id={`custom-question-${index + 1}`}
                name={`custom_question_${index + 1}`}
                value={question}
                onChange={(event) => handleChange(index, event)}
                aria-invalid={Boolean(validationError && !question.trim())}
                aria-describedby="custom-questions-description"
                maxLength={240}
                disabled={isSubmitting}
              />
              <button
                type="button"
                className="secondary-button"
                onClick={() => handleRemoveQuestion(index)}
                disabled={isSubmitting}
              >
                حذف السؤال
              </button>
            </div>
          ))}
        </fieldset>
        {validationError ? <p className="field-error" role="alert">{validationError}</p> : null}
        <button
          type="button"
          className="secondary-button"
          onClick={handleAddQuestion}
          disabled={isSubmitting || questionValues.length >= MAX_CUSTOM_QUESTIONS}
        >
          إضافة سؤال
        </button>
        <button type="submit" className="primary-button" disabled={isSubmitting}>
          {isSubmitting ? "جاري حفظ الأسئلة…" : "حفظ الأسئلة"}
        </button>
      </form>
    </section>
  );
}
