import { useState } from "react";
import { EvidenceDrawer } from "../evidence/EvidenceDrawer";
import { getTranscriptTurnForEvidence } from "../../utils/evidence";

const STATUS = { found: "إجابة موثقة", unclear: "إجابة غير واضحة", refused: "المحل امتنع عن الإجابة", not_mentioned: "لم يذكر المحل الإجابة" };

/** Canonical Quote.answers presentation; evidence is checked against a shop turn. */
export function InquiryAnswers({ shop }) {
  const [selected, setSelected] = useState(null);
  const transcript = shop.transcript ?? [];
  return <section className="inquiry-answers" aria-label={`إجابات ${shop.name}`}>
    <p className="quiet-label">إجابة {shop.name}</p>
    {(shop.quote?.answers ?? []).map((answer) => {
      const evidence = answer.evidence.map((item) => ({ status: "found", evidenceQuote: item.quote, evidenceTurn: item.turn }));
      const verified = evidence.length > 0 && evidence.every((field) => getTranscriptTurnForEvidence(field, transcript));
      return <article className="inquiry-answer" key={answer.question_index}>
        <span className="quiet-label">{answer.status === "found" && !verified ? "إجابة غير موثقة" : STATUS[answer.status]}</span>
        <h2>{answer.question}</h2>
        <p>{verified ? answer.summary_ar : answer.status === "not_mentioned" ? "ما حصلنا إجابة لهذا السؤال من المحل." : "تعذر التحقق من الإجابة، لذلك لم نعرضها كمعلومة مؤكدة."}</p>
        {verified && <details className="answer-evidence"><summary>اقرأ الدليل من المكالمة</summary>
          {evidence.map((field) => <div key={`${field.evidenceTurn}-${field.evidenceQuote}`}>
            <blockquote>«<bdi>{field.evidenceQuote}</bdi>»</blockquote>
            <button type="button" className="text-button" onClick={() => setSelected({ field, label: answer.question, context: shop.name })}>عرض الدور في المحادثة</button>
          </div>)}
        </details>}
      </article>;
    })}
    {selected && <EvidenceDrawer shopName={shop.name} evidence={selected} transcript={transcript} onClose={() => setSelected(null)} />}
  </section>;
}
