import { useEffect, useRef } from "react";
import { InquiryAnswers } from "./InquiryAnswers";
import { JourneyProgress } from "../taskFlow/JourneyNavigation";
import { CopyTaskSummary } from "../taskFlow/CopyTaskSummary";

function InquiryForm({ quick }) {
  const { query, area, questions, previewOutcome } = quick.formDraft;
  function update(patch) { quick.setFormDraft({ ...quick.formDraft, ...patch }); }
  function example() { update({ query: "محل طباعة", area: "الملقا", questions: ["تطبعون A2 اليوم وكم سعر الورقة؟"] }); }
  return <form className="inquiry-form" onSubmit={(event) => { event.preventDefault(); quick.find({ query, area, questions, previewOutcome }); }}>
    <header><p className="quiet-label">اسأل عني</p><h1>نسأل عنك. وأنت تختار المحل.</h1><p>اختر المحل، راجع سؤالك، ثم أكّد الاتصال.</p></header>
    <div className="inquiry-fields"><label>نوع المحل<input required maxLength={300} value={query} onChange={(e) => update({ query: e.target.value })} placeholder="مثال: محل طباعة" /></label>
      <label>الحي أو المدينة<input required maxLength={300} value={area} onChange={(e) => update({ area: e.target.value })} placeholder="مثال: الملقا" /></label></div>
    {questions.map((question, index) => <div className="inquiry-question" key={index}>
      <label htmlFor={`inquiry-question-${index}`}>{index === 0 ? "وش تبي نسأل المحل؟" : "السؤال الثاني"}</label>
      <textarea id={`inquiry-question-${index}`} required maxLength={300} rows={3} value={question} onChange={(event) => update({ questions: questions.map((item, i) => i === index ? event.target.value : item) })} placeholder="مثال: تطبعون A2 اليوم وكم سعر الورقة؟" />
    </div>)}
    <button type="button" className="text-button" onClick={() => update({ questions: questions.length === 1 ? [...questions, ""] : questions.slice(0, 1) })}>{questions.length === 1 ? "+ أضف سؤالاً ثانياً" : "إزالة السؤال الثاني"}</button>
    <p className="quiet-note">استفسارات فقط، بدون حجز أو دفع أو بيانات شخصية.</p>
    <details className="preview-options"><summary>جرّب مثال الطباعة</summary><p>الردود مكتوبة مسبقاً لمطبعة افتراضية. الأنواع الأخرى تعرض حالة «لا توجد نتائج».</p><button type="button" className="secondary-button" onClick={example}>استخدم المثال</button>
      <label>حالة المحاكاة<select value={previewOutcome} onChange={(event) => update({ previewOutcome: event.target.value })}><option value="answered">إجابة من المحل</option><option value="no_answer">المحل لا يرد</option><option value="not_mentioned">السؤال بدون إجابة</option></select></label>
    </details>
    <button className="primary-button" disabled={quick.busy}>{quick.busy ? "نجهز الخيارات…" : "اعرض المحلات"}</button>
  </form>;
}

export function QuickCallView({ quick }) {
  const viewRef = useRef(null);
  const previousStep = useRef(quick.step);
  useEffect(() => {
    if (previousStep.current !== quick.step) {
      const heading = viewRef.current?.querySelector("h1");
      if (heading) { heading.tabIndex = -1; heading.focus(); }
      previousStep.current = quick.step;
    }
  }, [quick.step]);
  const shops = Object.values(quick.taskState.shops);
  const done = ["done", "failed", "partial"].includes(quick.taskState.phase);
  const answers = shops.flatMap((shop) => shop.quote?.answers ?? []);
  const resultTitle = quick.taskState.phase === "failed" ? "ما قدرنا نوصل للمحل"
    : answers.some((answer) => answer.status === "found") ? "وصلنا الرد"
      : answers.some((answer) => ["unclear", "refused"].includes(answer.status)) ? "انتهت المكالمة بإجابة غير مؤكدة"
        : "انتهت المكالمة بدون إجابة";
  return <section ref={viewRef} className="quick-call" dir="rtl" lang="ar-SA">
    <p className="simulation-line">محاكاة محلية · لا تُجرى مكالمات حقيقية</p>
    <JourneyProgress steps={["الطلب", "المحل", "التأكيد", "النتيجة"]} current={["request", "candidates", "confirm", "running"].indexOf(quick.step)} />
    {quick.error && <p className="field-error" role="alert">{quick.error}</p>}
    {quick.step === "request" && <InquiryForm quick={quick} />}
    {quick.step === "candidates" && <>
      <header><p className="quiet-label">١ / اختر المحل</p><h1>من نَسأل عنك؟</h1><p>اختيار المحل يجهز الطلب. الاتصال يبدأ بعد تأكيدك.</p></header>
      {quick.candidates.length ? <ul className="candidate-list">{quick.candidates.map((business) => <li key={business.placeId}>
        <div><h2>{business.name}</h2><p>{business.callable ? "رقم مباشر · قابل للاتصال" : business.numberType === "unified_920" ? "رقم موحد 920 · غير قابل للاتصال" : "رقم مجاني 800 · غير قابل للاتصال"}</p></div>
        <button className="secondary-button" type="button" disabled={!business.callable || quick.busy} onClick={() => quick.select(business)}>اختر المحل<span className="sr-only"> {business.name}</span></button>
      </li>)}</ul> : <p role="status" className="empty-state">ما لقينا محلات لهذا النوع في بيانات المحاكاة. جرّب مثال الطباعة.</p>}
      <button type="button" className="text-button" onClick={quick.edit}>تعديل الطلب</button>
    </>}
    {quick.step === "confirm" && <>
      <header><p className="quiet-label">٢ / راجع وأكّد</p><h1>نتصل بهذا المحل؟</h1><p>مكالمة واحدة للمحل الذي اخترته. لن نستبدله بمحل آخر.</p></header>
      <div className="inquiry-review"><h2>{quick.business.name}</h2><p>{quick.draft.area.label}</p><ol>{quick.draft.custom_questions.map((question) => <li key={question}>{question}</li>)}</ol></div>
      <div className="inquiry-actions"><button className="primary-button" type="button" disabled={quick.busy} onClick={quick.confirm}>أكّد وابدأ الاتصال التجريبي</button><button className="text-button" type="button" disabled={quick.busy} onClick={quick.back}>اختيار محل آخر</button></div>
    </>}
    {quick.step === "running" && <>
      <header><p className="quiet-label">{done ? "النتيجة" : "متابعة الاتصال"}</p><h1>{done ? resultTitle : "نسأل المحل عنك…"}</h1><p>{quick.business.name}</p></header>
      {!done && <p role="status">{shops.some((shop) => shop.status === "extracting") ? "نراجع الإجابة والدليل…" : "المكالمة التجريبية قيد المتابعة…"}</p>}
      {quick.taskState.error && <p role="alert">{quick.taskState.error}</p>}
      {shops.filter((shop) => shop.quote?.answers?.length).map((shop) => <InquiryAnswers key={shop.placeId} shop={shop} />)}
      {done && <><p className="sr-only" role="status">{resultTitle}</p><CopyTaskSummary task={quick.taskState} /><button className="secondary-button" type="button" onClick={quick.reset}>اسأل عن شيء آخر</button></>}
    </>}
  </section>;
}
