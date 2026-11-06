import { useMemo, useState } from "react";
import { createQuickCallMockTransport } from "../../api/quickCallMockTransport";
import { useTaskFlow } from "../taskFlow/useTaskFlow";
import { createInquiryDraft } from "./inquiryModel";
import { createQuickDraft } from "../taskFlow/requestDraft";

export function useQuickCall(onCreated, { formDraft, onFormDraftChange } = {}) {
  const [localDraft, setLocalDraft] = useState(createQuickDraft);
  const setFormDraft = onFormDraftChange ?? setLocalDraft;
  const transport = useMemo(() => createQuickCallMockTransport(), []);
  const flow = useTaskFlow(transport, { manualStart: true });
  const [details, setDetails] = useState({ step: "request", candidates: [], business: null, draft: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function find(input) {
    setBusy(true);
    setError(null);
    try {
      const draft = createInquiryDraft(input);
      const id = await flow.beginTask({ ...draft, previewOutcome: input.previewOutcome });
      if (!id) return;
      onCreated?.();
      const candidates = await transport.findCandidates(id);
      setDetails({ step: "candidates", candidates, business: null, draft, previewOutcome: input.previewOutcome ?? "answered" });
    } catch (caught) {
      setError(caught instanceof TypeError ? caught.message : "أكمل نوع المحل والحي وسؤالاً أو سؤالين.");
    } finally { setBusy(false); }
  }
  async function select(business) {
    setBusy(true);
    setError(null);
    try {
      await transport.selectBusiness(flow.taskState.taskId, business.placeId);
      setDetails((current) => ({ ...current, business, step: "confirm" }));
    } catch { setError("تعذر اختيار هذا المحل. اختر رقماً مباشراً من القائمة."); }
    finally { setBusy(false); }
  }
  async function confirm() {
    setDetails((current) => ({ ...current, step: "running" }));
    if (!await flow.confirmStart()) setDetails((current) => ({ ...current, step: "confirm" }));
  }
  function reset() {
    flow.reset();
    setError(null);
    setDetails({ step: "request", candidates: [], business: null, draft: null });
    setFormDraft(createQuickDraft());
  }
  function edit() {
    flow.reset();
    setError(null);
    setDetails((current) => ({ ...current, step: "request", candidates: [], business: null }));
  }
  return { ...flow, ...details, formDraft: formDraft ?? localDraft, setFormDraft, busy: busy || flow.isSubmitting, error: error || flow.error, find, select, confirm, reset, edit,
    back: () => setDetails((current) => ({ ...current, business: null, step: "candidates" })) };
}
