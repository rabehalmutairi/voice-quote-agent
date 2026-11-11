import { useEffect, useRef } from "react";
import { formatNumber } from "./formatEvidence";
import { getTranscriptTurnForEvidence } from "../../utils/evidence";

const DIALOG_TITLE_ID = "evidence-dialog-title";

function speakerLabel(speaker) {
  return speaker === "shop" ? "المحل" : "المساعد";
}

function focusableElements(container) {
  return [...container.querySelectorAll(
    "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
  )].filter((element) => !element.hasAttribute("disabled"));
}

/**
 * Shows the extracted phrase beside the original synthetic transcript turn.
 * @param {{ shopName: string, evidence: { label: string, field: Object }, transcript: Array<Object>, onClose: () => void }} props
 */
export function EvidenceDrawer({ shopName, evidence, transcript = [], onClose }) {
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    closeButtonRef.current?.focus();

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !dialog) {
        return;
      }

      const elements = focusableElements(dialog);
      if (elements.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    dialog?.addEventListener("keydown", handleKeyDown);

    return () => {
      dialog?.removeEventListener("keydown", handleKeyDown);
      if (previousFocus && typeof previousFocus.focus === "function" && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, [onClose]);

  const evidenceTurn = evidence.field.evidenceTurn;
  const matchingTurn = getTranscriptTurnForEvidence(evidence.field, transcript);
  const isVerified = Boolean(matchingTurn);
  return (
    <div className="evidence-dialog-backdrop">
      <section
        ref={dialogRef}
        className="evidence-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={DIALOG_TITLE_ID}
        tabIndex="-1"
      >
        <div className="evidence-dialog__heading">
          <div>
            <p className="eyebrow">دليل من المكالمة</p>
            <h2 id={DIALOG_TITLE_ID}>دليل {evidence.label}</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label={`إغلاق دليل ${evidence.label}`}
          >
            إغلاق
          </button>
        </div>
        <p className="evidence-dialog__shop">{shopName}</p>
        {isVerified ? (
          <div className="evidence-dialog__quote">
            <span>العبارة المستخرجة</span>
            <blockquote>«<bdi>{evidence.field.evidenceQuote}</bdi>»</blockquote>
          </div>
        ) : (
          <p className="evidence-dialog__unverified" role="alert">
            لا نعرض هذه المعلومة لأننا لم نتمكن من ربطها بكلام المحل.
          </p>
        )}
        <div className="evidence-dialog__transcript">
          <h3>نص المكالمة</h3>
          {matchingTurn ? (
            <p className="evidence-dialog__turn-reference">
              الدور رقم <bdi>{formatNumber(evidenceTurn)}</bdi> هو مصدر هذه المعلومة.
            </p>
          ) : (
            <p className="evidence-dialog__turn-reference" role="note">
              لم نتمكن من ربط هذه المعلومة بدور موثوق من كلام المحل.
            </p>
          )}
          {transcript.length > 0 ? (
            <ol className="evidence-transcript">
              {transcript.map((turn) => (
                <li
                  key={turn.i}
                  className={`evidence-transcript__turn${turn === matchingTurn ? " evidence-transcript__turn--active" : ""}`}
                  aria-current={turn === matchingTurn ? "true" : undefined}
                >
                  <span className="evidence-transcript__speaker">{speakerLabel(turn.speaker)}</span>
                  <bdi>{turn.text}</bdi>
                </li>
              ))}
            </ol>
          ) : (
            <p className="empty-state">لا يتوفر نص للمكالمة في هذه التجربة.</p>
          )}
        </div>
      </section>
    </div>
  );
}
