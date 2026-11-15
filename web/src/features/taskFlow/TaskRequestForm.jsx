import { useState } from "react";
import { DataProvenanceNotice } from "../../components/ui/DataProvenanceNotice";
import { createTaskSpec, SUPPORTED_DEVICE_TYPES, SUPPORTED_REPAIR_TYPES, SUPPORTED_SERVICE_MODES } from "./taskRequestModel";
import { createCompareDraft, describeRequest, requiredDraftFields } from "./requestDraft";

const FIELD_LABELS = { deviceModel: "الموديل", repairType: "نوع الصيانة", item: "المنتج أو القطعة", area: "الحي / المدينة" };

/** Collects either a written request or structured details, with session-owned drafts. */
export function TaskRequestForm({ onSubmit, isSubmitting, error, showFixturePicker = false, scenarioKey = "foundation", onScenarioChange = () => {}, entryCopy = {}, draft, onDraftChange }) {
  const [localDraft, setLocalDraft] = useState(createCompareDraft);
  const [fieldError, setFieldError] = useState(null);
  const values = draft ?? localDraft;
  const detailsMode = values.inputMode === "details";
  const isDemo = entryCopy.title === "العرض التجريبي";
  const title = isDemo ? "العرض التجريبي" : values.category === "stock_check" ? "تأكد من توفر اللي تحتاجه" : "قارن عروض صيانة جوالك";
  const requestError = fieldError?.message ?? error;
  function update(patch) {
    if (draft && onDraftChange) onDraftChange({ ...values, ...patch });
    else setLocalDraft((current) => ({ ...current, ...patch }));
    setFieldError(null);
  }
  function invalid(key) { return fieldError?.key === key; }
  function submit(event) {
    event.preventDefault();
    const missing = detailsMode
      ? requiredDraftFields(values.category).find((key) => !values[key].trim())
      : !values.request.trim() && "request";
    if (missing) {
      setFieldError({ key: missing, message: missing === "request" ? (values.category === "stock_check" ? "اكتب المنتج الذي تبحث عنه أولاً." : "اكتب طلب الصيانة أولاً.") : `أكمل ${FIELD_LABELS[missing]} قبل المتابعة.` });
      event.currentTarget.elements.namedItem(missing)?.focus();
      return;
    }
    setFieldError(null);
    onSubmit(createTaskSpec({
      requestText: detailsMode ? describeRequest(values) : values.request.trim(),
      category: values.category,
      ...(detailsMode ? { deviceType: values.deviceType, deviceModel: values.deviceModel, repairType: values.repairType, item: values.item, area: values.area } : {}),
    }));
  }
  function example() {
    update(values.category === "stock_check"
      ? { inputMode: "details", item: "آيفون 16", area: "الملقا", note: "" }
      : { inputMode: "details", deviceType: "آيفون", deviceModel: "15 برو", repairType: "تغيير شاشة", area: "الملقا", note: "" });
  }
  function textField(key, placeholder) {
    return <div className="field-group"><label htmlFor={`request-${key}`}>{FIELD_LABELS[key]}</label><input id={`request-${key}`} name={key} value={values[key]} onChange={(event) => update({ [key]: event.target.value })} placeholder={placeholder} disabled={isSubmitting} aria-invalid={invalid(key)} aria-describedby={invalid(key) ? "repair-request-error" : undefined} /></div>;
  }
  return <section className={`task-entry${isDemo ? "" : " task-entry--product"}`} aria-labelledby="page-title">
    <header className="task-entry__intro"><div className="task-entry__copy"><p className="eyebrow">{entryCopy.eyebrow ?? "قارن لي"}</p><h1 id="page-title">{title}</h1><p className="lead">{isDemo ? entryCopy.lead : "اختر كتابة طلبك أو تعبئة التفاصيل. بعدها تابع النتائج مع دليل كل معلومة."}</p></div></header>
    <form className="request-form" noValidate onSubmit={submit}>
      <DataProvenanceNotice compact title="بيانات محاكاة فقط" description={entryCopy.notice ?? "النتائج أمثلة محلية، ولا تُجرى مكالمات حقيقية."} source="سيناريوهات تجريبية" />
      {showFixturePicker && <div className="field-group"><label htmlFor="fixture-scenario">السيناريو التجريبي</label><select id="fixture-scenario" value={scenarioKey} onChange={(event) => onScenarioChange(event.target.value)} disabled={isSubmitting}><option value="foundation">طلب مكتمل التفاصيل</option><option value="needs-input">طلب يحتاج معلومات إضافية</option><option value="cannot-compare">عروض لا يمكن مقارنتها</option><option value="stock-check">فحص توفر قطعة إلكترونية</option></select></div>}
      <div className="field-group"><label htmlFor="compare-category">نوع الطلب</label><select id="compare-category" value={values.category} onChange={(event) => update({ category: event.target.value })} disabled={isSubmitting}>{SUPPORTED_SERVICE_MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}</select></div>
      <div className="input-method" role="group" aria-label="طريقة إدخال الطلب"><button type="button" aria-pressed={!detailsMode} disabled={isSubmitting} onClick={() => update({ inputMode: "text" })}>اكتب طلبك</button><button type="button" aria-pressed={detailsMode} disabled={isSubmitting} onClick={() => update({ inputMode: "details" })}>عبّئ التفاصيل</button></div>
      {detailsMode ? <>
        <div className="request-form__details">
          {values.category === "stock_check" ? textField("item", "مثال: آيفون 16، سعة 256 جيجا") : <>
            <div className="field-group"><label htmlFor="device-type">نوع الجهاز</label><select id="device-type" value={values.deviceType} onChange={(event) => update({ deviceType: event.target.value })} disabled={isSubmitting}><option value="">اختر نوع الجهاز (اختياري)</option>{SUPPORTED_DEVICE_TYPES.map((type) => <option key={type}>{type}</option>)}</select></div>
            {textField("deviceModel", "مثال: آيفون 15 برو")}
            <div className="field-group"><label htmlFor="repair-type">نوع الصيانة</label><select id="repair-type" name="repairType" value={values.repairType} onChange={(event) => update({ repairType: event.target.value })} disabled={isSubmitting} aria-invalid={invalid("repairType")} aria-describedby={invalid("repairType") ? "repair-request-error" : undefined}><option value="">اختر نوع الصيانة</option>{SUPPORTED_REPAIR_TYPES.map((type) => <option key={type}>{type}</option>)}</select></div>
          </>}
          {textField("area", "مثال: الملقا")}
        </div>
        <label htmlFor="request-note">ملاحظة إضافية (اختياري)</label><textarea id="request-note" rows={2} value={values.note} onChange={(event) => update({ note: event.target.value })} disabled={isSubmitting} />
        <div className="request-summary" aria-label="ملخص طلبك"><span className="quiet-label">ملخص طلبك</span><p><bdi>{describeRequest(values) || "أكمل التفاصيل ليظهر ملخص طلبك هنا."}</bdi></p></div>
      </> : <>
        <label htmlFor="repair-request">اكتب طلبك كما تحب</label><textarea name="request" id="repair-request" rows={4} value={values.request} onChange={(event) => update({ request: event.target.value })} aria-label={values.category === "stock_check" ? "وش تبي تتأكد من توفره؟" : "وش تبي تصلّح؟"} aria-invalid={invalid("request")} aria-describedby={requestError ? "repair-request-hint repair-request-error" : "repair-request-hint"} placeholder={values.category === "stock_check" ? "مثال: هل آيفون 16 متوفر في الملقا؟" : "مثال: تغيير شاشة آيفون 15 برو في الملقا"} disabled={isSubmitting} />
        <p id="repair-request-hint" className="field-hint">اذكر ما تحتاجه والحي. سنطلب منك أي تفاصيل ناقصة قبل المتابعة.</p>
      </>}
      <button type="button" className="text-button request-example" onClick={example} disabled={isSubmitting}>استخدم مثالًا تجريبيًا</button>
      {requestError && <p id="repair-request-error" className="field-error" role="alert">{requestError}</p>}
      <button type="submit" className="primary-button" disabled={isSubmitting}>{isSubmitting ? "جاري تجهيز الطلب…" : "ابدأ البحث عن العروض"}</button>
      <button type="button" className="text-button" onClick={() => { const empty = createCompareDraft(); if (draft && onDraftChange) onDraftChange(empty); else setLocalDraft(empty); setFieldError(null); }} disabled={isSubmitting}>مسح المسودة</button>
    </form>
  </section>;
}
