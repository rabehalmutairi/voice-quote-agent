import { createMockTransport } from "./mockTransport";
import { createInquiryDraft, isCallableBusiness } from "../features/quickCall/inquiryModel";
import { createQuickCallScenario, quickCallCandidates } from "../mocks/scenarios/quickCallScenario";

/** Local ADR preview; uses the existing reducer/transport pipeline after selection.
 * findCandidates/selectBusiness mirror planned R5 capabilities, not live endpoints.
 */
export function createQuickCallMockTransport() {
  let draft = null;
  let candidates = null;
  let delegate = null;
  let started = false;
  let outcome = "answered";
  const taskId = "fixture_quick_call";
  function checkTask(id) {
    if (!draft || id !== taskId) throw new TypeError("Unknown task.");
  }
  const snapshot = () => ({ taskId, phase: "idle", requestText: draft.request_text, shops: [], missingQuestions: [], answers: {} });
  return {
    async createTask(input) {
      draft = createInquiryDraft({ query: input.target?.query, area: input.area?.label, questions: input.custom_questions });
      candidates = null;
      delegate = null;
      started = false;
      outcome = input.previewOutcome ?? "answered";
      return snapshot();
    },
    async findCandidates(id) {
      checkTask(id);
      candidates = /طبع|طباع|مطبعة/i.test(draft.target.query) ? quickCallCandidates : [];
      return structuredClone(candidates.map((business) => ({ ...business, callable: isCallableBusiness(business) })));
    },
    async selectBusiness(id, placeId) {
      checkTask(id);
      if (started) throw new TypeError("Task already started.");
      const business = candidates?.find((candidate) => candidate.placeId === placeId);
      if (!business || !isCallableBusiness(business)) throw new TypeError("Business is not a callable candidate.");
      draft = { ...draft, target: { ...draft.target, business }, missing_slots: [] };
      delegate = createMockTransport(createQuickCallScenario(draft, business, outcome));
      return delegate.createTask(draft.request_text);
    },
    async startTask(id) {
      checkTask(id);
      if (!delegate || started) throw new TypeError("Select and confirm a business before starting once.");
      started = true;
      try { return await delegate.startTask(id); }
      catch (error) { started = false; throw error; }
    },
    async getTask(id) { checkTask(id); return delegate ? delegate.getTask(id) : snapshot(); },
    async submitAnswers() { throw new TypeError("Business selection is not a planner answer."); },
    subscribe(id, listener) {
      checkTask(id);
      if (!started) throw new TypeError("Explicit confirmation required.");
      return delegate.subscribe(id, listener);
    },
  };
}
