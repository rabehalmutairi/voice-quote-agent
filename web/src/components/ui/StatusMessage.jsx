const VALID_TONES = new Set(["info", "success", "warning", "danger"]);

/**
 * Persistent feedback for information that must remain available to the user.
 * @param {{ tone?: "info" | "success" | "warning" | "danger", title: string, children: import("react").ReactNode }} props
 */
export function StatusMessage({ tone = "info", title, children }) {
  const safeTone = VALID_TONES.has(tone) ? tone : "info";

  return (
    <div className={`status-message status-message--${safeTone}`} role="status">
      <strong>{title}</strong>
      <span>{children}</span>
    </div>
  );
}
