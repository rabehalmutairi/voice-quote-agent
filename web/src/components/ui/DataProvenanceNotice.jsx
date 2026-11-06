import { useId } from "react";

/**
 * Makes the origin and limits of a data view persistent and visible.
 * @param {{ title: string, description: string, source?: string, coverage?: string, className?: string }} props
 */
export function DataProvenanceNotice({
  title,
  description,
  source,
  coverage,
  className = "",
  compact = false,
}) {
  const titleId = `data-provenance-${useId().replaceAll(":", "")}`;
  const noticeClassName = ["data-provenance", className].filter(Boolean).join(" ");

  if (compact) return (
    <aside className={`provenance-compact ${className}`} role="note" aria-labelledby={titleId}>
      <details><summary><strong id={titleId}>{title}</strong></summary>
        <p>{description}</p>{source && <p>المصدر: {source}</p>}{coverage && <p>النطاق: {coverage}</p>}
      </details>
    </aside>
  );

  return (
    <aside className={noticeClassName} role="note" aria-labelledby={titleId}>
      <div className="data-provenance__heading">
        <span className="data-provenance__badge" aria-hidden="true">محاكاة</span>
        <strong id={titleId}>{title}</strong>
      </div>
      <p className="data-provenance__description">{description}</p>
      {source ? <p className="data-provenance__meta">المصدر: {source}</p> : null}
      {coverage ? <p className="data-provenance__meta">النطاق: {coverage}</p> : null}
    </aside>
  );
}
