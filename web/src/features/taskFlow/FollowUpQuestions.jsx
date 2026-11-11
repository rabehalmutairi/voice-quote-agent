import { useEffect, useRef, useState } from "react";

function initialAnswers(questions) {
  return Object.fromEntries(questions.map((question) => [question.key, ""]));
}

/**
 * Collects planner follow-up answers while preserving the user's input on validation errors.
 * @param {{ questions: Array<{ key: string, prompt: string }>, onSubmit: (answers: Object) => void, isSubmitting: boolean }} props
 */
export function FollowUpQuestions({ questions, onSubmit, isSubmitting }) {
  const [answers, setAnswers] = useState(() => initialAnswers(questions));
  const [validationError, setValidationError] = useState(null);
  const inputRefs = useRef(new Map());

  useEffect(() => {
    const firstQuestion = questions[0];
    if (firstQuestion) {
      inputRefs.current.get(firstQuestion.key)?.focus();
    }
  }, [questions]);

  function handleSubmit(event) {
    event.preventDefault();
    const firstInvalidQuestion = questions.find((question) => !answers[question.key]?.trim());

    if (firstInvalidQuestion) {
      setValidationError("أكمل التفاصيل المطلوبة قبل المتابعة.");
      inputRefs.current.get(firstInvalidQuestion.key)?.focus();
      return;
    }

    setValidationError(null);
    onSubmit(Object.fromEntries(
      questions.map((question) => [question.key, answers[question.key].trim()]),
    ));
  }

  function handleChange(key, event) {
    setAnswers((currentAnswers) => ({
      ...currentAnswers,
      [key]: event.target.value,
    }));
    if (validationError) {
      setValidationError(null);
    }
  }

  return (
    <section className="follow-up-panel" aria-labelledby="follow-up-title">
      <h2 id="follow-up-title">نحتاج تفاصيل إضافية</h2>
      <p>جاوب عن الأسئلة التالية عشان نرسل طلباً واضحاً للمحلات.</p>
      <form className="follow-up-form" noValidate onSubmit={handleSubmit}>
        <fieldset>
          <legend className="visually-hidden">تفاصيل طلب الصيانة</legend>
          {questions.map((question) => (
            <div className="field-group" key={question.key}>
              <label htmlFor={`follow-up-${question.key}`}>{question.prompt}</label>
              <input
                ref={(element) => {
                  if (element) {
                    inputRefs.current.set(question.key, element);
                  } else {
                    inputRefs.current.delete(question.key);
                  }
                }}
                id={`follow-up-${question.key}`}
                name={question.key}
                value={answers[question.key] ?? ""}
                onChange={(event) => handleChange(question.key, event)}
                aria-invalid={Boolean(validationError && !answers[question.key]?.trim())}
              />
            </div>
          ))}
        </fieldset>
        {validationError ? <p className="field-error" role="alert">{validationError}</p> : null}
        <button type="submit" className="primary-button" disabled={isSubmitting}>
          {isSubmitting ? "جاري حفظ التفاصيل…" : "متابعة البحث"}
        </button>
      </form>
    </section>
  );
}
