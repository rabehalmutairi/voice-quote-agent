import { isEvidenceFieldTraceable } from "../../utils/evidence";
import { formatEvidenceValue } from "./formatEvidence";

const STATUS_MESSAGES = {
  not_mentioned: "لم يذكر المحل هذه المعلومة.",
  refused: "المحل رفض إعطاء هذه المعلومة.",
  unclear: "إجابة المحل غير واضحة.",
  unverified: "لم نتمكن من التحقق من هذه المعلومة.",
};

function getFieldStatus(field) {
  return field?.status ?? "not_mentioned";
}

function getDisplayValue(field, formatter, status, isVerified) {
  if (status !== "found") {
    return STATUS_MESSAGES[status] ?? "لا توجد معلومة مؤكدة.";
  }

  if (!isVerified) {
    return STATUS_MESSAGES.unverified;
  }

  return formatEvidenceValue(field, formatter);
}

/**
 * Renders one evidence-backed value and keeps the transcript action explicit.
 * @param {{ label: string, field?: Object, formatter?: (value: unknown) => string, transcript?: Array<Object>, context?: string, onInspect: (evidence: Object) => void }} props
 */
export function EvidenceField({
  label,
  field,
  formatter = String,
  transcript = [],
  context,
  onInspect,
}) {
  const status = getFieldStatus(field);
  const isVerified = isEvidenceFieldTraceable(field, transcript);
  const displayStatus = status === "found" && !isVerified ? "unverified" : status;
  const accessibleContext = context ? ` من ${context}` : "";

  return (
    <div className="evidence-field">
      <dt>{label}</dt>
      <dd>
        <span className={`evidence-field__value evidence-field__value--${displayStatus}`}>
          <bdi>{getDisplayValue(field, formatter, status, isVerified)}</bdi>
        </span>
        {isVerified ? (
          <>
            <span className="evidence-field__quote">
              «<bdi>{field.evidenceQuote}</bdi>»
            </span>
            <button
              type="button"
              className="text-button"
              onClick={() => onInspect({ field, label, context })}
              aria-label={`عرض دليل ${label}${accessibleContext}`}
            >
              عرض الدليل
            </button>
          </>
        ) : null}
      </dd>
    </div>
  );
}
