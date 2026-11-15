/** Connection loss does not change the server task's outcome or start it again. */
export function TaskConnectionNotice({ flow }) {
  if (flow?.transportMode !== "api") return null;
  const state = flow.connection?.state;
  const needsRecovery = ["reconnecting", "disconnected"].includes(state) || Boolean(flow.error);
  if (flow.isRestoring) return <p role="status" aria-live="polite">نستعيد طلبك وتحديثاته…</p>;
  if (!needsRecovery && flow.taskState?.phase !== "idle") return null;
  return <div className="task-connection-notice">
    {needsRecovery && <p role="status">{flow.connection?.message ?? (flow.error ? "يمكنك تحديث حالة الطلب بإعادة الاتصال." : "انقطع الاتصال بالتحديثات. النتائج المعروضة باقية، ونحاول استعادة الاتصال.")}</p>}
    {needsRecovery && (flow.requestedTaskId || flow.taskState?.taskId) && <button className="secondary-button" type="button" onClick={() => flow.resumeTask(flow.requestedTaskId || flow.taskState.taskId)}>إعادة الاتصال</button>}
    {!needsRecovery && flow.taskState?.taskId && flow.taskState.phase === "idle" && <button className="primary-button" type="button" disabled={flow.isSubmitting} onClick={flow.confirmStart}>ابدأ تنفيذ الطلب</button>}
  </div>;
}
