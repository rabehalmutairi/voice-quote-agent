import { useState } from "react";
import { DataProvenanceNotice } from "../../components/ui/DataProvenanceNotice";
import { EvidenceDrawer } from "../evidence/EvidenceDrawer";
import { customQuestionFixtures } from "../../mocks/customQuestionFixtures";
import { CustomQuestions } from "./CustomQuestions";
import { getQuoteTranscript } from "../../utils/evidence";

const FIXTURE_LABELS = {
  missing: "لم تصل إجابات إضافية",
  partial: "إجابات جزئية",
  unanswered: "لم تصل إجابة لسؤال",
};

const ANSWER_STATUS_COPY = {
  found: "إجابة مؤكدة",
  partial: "إجابة جزئية",
  unanswered: "لم تصل إجابة",
};

const DEFAULT_FIXTURE_ID = "fixture_custom_questions_partial";

function getFixture(fixtureId) {
  return customQuestionFixtures.find((fixture) => fixture.fixture_id === fixtureId)
    ?? customQuestionFixtures[0];
}

function answerForQuestion(fixture, questionId) {
  return fixture.custom_answers.find((answer) => answer.question_id === questionId) ?? null;
}

function answerTone(answer) {
  if (answer?.answer_status === "found") {
    return "success";
  }

  if (answer?.answer_status === "partial") {
    return "warning";
  }

  return "neutral";
}

function savedQuestionsCopy(count) {
  if (count === 1) {
    return "تم حفظ سؤال واحد";
  }

  return "تم حفظ سؤالين";
}

/**
 * Shows the optional-question UI and the three bounded fixture result states.
 * This is intentionally demo-only: the current canonical transport has no
 * custom-question fields or answer events, so these examples never masquerade
 * as part of the active task payload.
 */
export function CustomQuestionFixturePanel() {
  const [fixtureId, setFixtureId] = useState(DEFAULT_FIXTURE_ID);
  const [savedQuestions, setSavedQuestions] = useState([]);
  const [selectedEvidence, setSelectedEvidence] = useState(null);
  const fixture = getFixture(fixtureId);
  const transcript = getQuoteTranscript(fixture.quote, fixture.transcript);

  function handleQuestionsSubmit(questions) {
    setSavedQuestions(questions);
  }

  function inspectAnswer(question, answer) {
    if (!answer || answer.answer_status === "unanswered") {
      return;
    }

    setSelectedEvidence({
      field: {
        status: "found",
        evidenceQuote: answer.evidence_quote,
        evidenceTurn: answer.evidence_turn,
      },
      label: `إجابة ${question.question_text}`,
      context: fixture.business.name,
      shop: {
        name: fixture.business.name,
        quote: fixture.quote,
        transcript,
      },
    });
  }

  return (
    <section className="custom-question-demo-panel" aria-labelledby="custom-question-demo-title" dir="rtl" lang="ar">
      <header className="custom-question-demo-panel__header">
        <div>
          <p className="eyebrow">امتداد اختياري داخل المحاكاة</p>
          <h2 id="custom-question-demo-title">أسئلة إضافية للمحل</h2>
          <p>
            أضف سؤالين كحد أقصى، ثم راجع كيف تظهر الإجابة مع حالتها ودليلها من نص المكالمة.
          </p>
        </div>
        <span className="custom-question-demo-panel__badge" aria-hidden="true">٢</span>
      </header>

      <DataProvenanceNotice
        title="بيانات محاكاة فقط"
        description="هذه أمثلة محلية لتوضيح حالات الإجابة، ولا تُرسل الأسئلة إلى خدمة إنتاجية."
        source="customQuestionFixtures"
      />

      <CustomQuestions
        key={savedQuestions.map((question) => question.question_id).join("|") || "empty"}
        initialQuestions={savedQuestions}
        onSubmit={handleQuestionsSubmit}
      />

      {savedQuestions.length > 0 ? (
        <p className="custom-question-demo-panel__saved" role="status">
          {savedQuestionsCopy(savedQuestions.length)} في معاينة المحاكاة فقط.
        </p>
      ) : null}

      <div className="custom-question-demo-panel__results">
        <div className="custom-question-demo-panel__results-heading">
          <div>
            <p className="eyebrow">نتائج نموذجية</p>
            <h3>حالة إجابات المحل</h3>
          </div>
          <div className="field-group custom-question-demo-panel__fixture-select">
            <label htmlFor="custom-question-fixture">حالة الإجابة</label>
            <select
              id="custom-question-fixture"
              value={fixture.fixture_id}
              onChange={(event) => setFixtureId(event.target.value)}
            >
              {customQuestionFixtures.map((candidate) => (
                <option key={candidate.fixture_id} value={candidate.fixture_id}>
                  {FIXTURE_LABELS[candidate.result_state] ?? candidate.result_state}
                </option>
              ))}
            </select>
          </div>
        </div>

        {fixture.custom_answers.length === 0 ? (
          <p className="empty-state" role="status">لم تصل إجابات إضافية في هذا السيناريو.</p>
        ) : (
          <ul className="custom-question-answer-list">
            {fixture.custom_questions.map((question) => {
              const answer = answerForQuestion(fixture, question.question_id);
              const canInspect = Boolean(answer && answer.answer_status !== "unanswered");

              return (
                <li className={`custom-question-answer custom-question-answer--${answerTone(answer)}`} key={question.question_id}>
                  <div className="custom-question-answer__heading">
                    <strong>{question.question_text}</strong>
                    <span>{ANSWER_STATUS_COPY[answer?.answer_status] ?? "لم تصل إجابة"}</span>
                  </div>
                  <p>{answer?.answer_text ?? "ما حصلنا إجابة من المحل."}</p>
                  {answer?.evidence_quote ? (
                    <blockquote>«<bdi>{answer.evidence_quote}</bdi>»</blockquote>
                  ) : null}
                  {canInspect ? (
                    <button
                      className="reference-evidence-link custom-question-answer__evidence"
                      type="button"
                      onClick={() => inspectAnswer(question, answer)}
                    >
                      عرض الدليل من المكالمة
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {selectedEvidence ? (
        <EvidenceDrawer
          shopName={selectedEvidence.context}
          evidence={selectedEvidence}
          transcript={selectedEvidence.shop.transcript}
          onClose={() => setSelectedEvidence(null)}
        />
      ) : null}
    </section>
  );
}
