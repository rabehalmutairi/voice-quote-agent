import { describe, expect, it } from "vitest";
import quote from "../test/backendExamples/quote.json";
import result from "../test/backendExamples/call_result.json";
import comparison from "../test/backendExamples/comparison.json";
import business from "../test/backendExamples/business.json";
import spec from "../test/backendExamples/task_spec.json";
import { assertBackendEvent, assertBackendSnapshot } from "../contracts/backendContracts";
import { mapBackendSnapshot, mapBackendEvent, toCreateBody } from "./backendAdapter";

const event = (type, data, seq = 1) => ({ type, data, seq, task_id: spec.task_id, at: spec.created_at });
export function savedSnapshot(overrides = {}) {
  return { task_id: spec.task_id, state: "done", state_history: ["created", "done"], task_spec: spec,
    follow_up_questions: [], businesses: [business], calls: [{ call_id: result.call_id, place_id: business.place_id, status: "ended", attempts: 1, outcome: result.outcome, reason: null, quote_ready: true }],
    quotes: [quote], excluded: [], comparison: { ...comparison, ranking: [comparison.ranking[0]], excluded: [] , status: "ranked" }, failure_reason: null, cost_usd: 0.45, last_seq: 5, ...overrides };
}

describe("R5 contract adapter", () => {
  it("sends text and an area label instead of leaking the provisional TaskSpec", () => {
    expect(toCreateBody({ request_text: "تغيير شاشة", category: "electronics_repair", slots: {}, target: null, area: { label: "الملقا", radius_m: 5000 }, max_businesses: 3 }))
      .toEqual({ text: "تغيير شاشة", area: "الملقا", custom_questions: [], max_businesses: 3 });
  });
  it("validates the canonical envelope and rejects wrong payload types", () => {
    expect(assertBackendEvent(event("quote.ready", quote))).toBeTruthy();
    expect(() => assertBackendEvent(event("quote.ready", { ...quote, offers: "bad" }))).toThrow();
    expect(() => assertBackendEvent(event("quote.ready", { ...quote, task_id: "tsk_other" }))).toThrow();
    expect(() => assertBackendSnapshot(savedSnapshot({ last_seq: -1 }))).toThrow();
  });
  it("preserves ranges, refusal evidence and the original option order", () => {
    const state = mapBackendSnapshot(assertBackendSnapshot(savedSnapshot()), new Map([[result.call_id, result.transcript]]));
    expect(state.shops[0].quote.options[0].warrantyDays).toMatchObject({ status: "refused", evidenceTurn: 7 });
    expect(state.shops[0].quote.turnaroundMinutes).toMatchObject({ status: "found", valueMin: 60, valueMax: 120 });
    expect(state.lastSequence).toBe(5);
    expect(state.shops[0].transcript).toHaveLength(result.transcript.length);
  });
  it("joins quote evidence to its exact call transcript", () => {
    const mapped = mapBackendEvent(event("quote.ready", quote), new Map([[result.call_id, result.transcript]]));
    expect(mapped.sequence).toBe(1);
    expect(mapped.data.transcript).toEqual(result.transcript);
    expect(mapped.data.placeId).toBe(quote.place_id);
    expect(() => mapBackendEvent(event("quote.ready", quote), new Map())).toThrow();
  });
  it("accepts an empty canonical quote so cannot-compare results remain available", () => {
    const empty = { ...quote, offers: [], fields: {}, answers: [] };
    const cannotCompare = { task_id: spec.task_id, status: "cannot_compare", basis: null, ranking: [], excluded: [], cannot_compare_reasons: ["لم يذكر المحل عرضًا صالحًا"] };
    const state = mapBackendSnapshot(assertBackendSnapshot(savedSnapshot({ quotes: [empty], comparison: cannotCompare })), new Map([[result.call_id, result.transcript]]));
    expect(state.comparison.status).toBe("cannot_compare");
    expect(state.shops[0].quote.options).toEqual([]);
    expect(state.comparison.ranking).toEqual([]);
  });
});
