import { useState } from "react";
import { buildTaskSummary } from "./taskSummary";

export function CopyTaskSummary({ task }) {
  const [status, setStatus] = useState("");
  const [fallback, setFallback] = useState(false);
  const text = buildTaskSummary(task);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setFallback(false);
      setStatus("تم نسخ ملخص النتيجة.");
    } catch {
      setFallback(true);
      setStatus("تعذر النسخ التلقائي. يمكنك نسخ النص أدناه.");
    }
  }
  return <div className="copy-summary"><button type="button" className="secondary-button" onClick={copy}>نسخ ملخص النتيجة</button><p role="status">{status}</p>{fallback && <textarea readOnly value={text} rows={6} aria-label="ملخص للنسخ اليدوي" onFocus={(event) => event.target.select()} />}</div>;
}
