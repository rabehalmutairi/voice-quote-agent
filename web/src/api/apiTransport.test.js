import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApiTransport } from "./apiTransport";
import spec from "../test/backendExamples/task_spec.json";
import business from "../test/backendExamples/business.json";
import result from "../test/backendExamples/call_result.json";
import quote from "../test/backendExamples/quote.json";

const event = (type, data, seq) => ({ type, data, seq, task_id: spec.task_id, at: spec.created_at });
const comparison = { task_id: spec.task_id, status: "ranked", basis: "السعر", ranking: [{ place_id: business.place_id, rank: 1, reason: "السعر الأقل" }], excluded: [], cannot_compare_reasons: [] };
const events = [event("task.created", spec, 1), event("business.found", business, 2), event("call.started", { call_id: result.call_id, place_id: business.place_id }, 3), event("call.ended", result, 4), event("quote.ready", quote, 5), event("comparison.ready", comparison, 6)];
function snapshot(complete = true) {
  return { task_id: spec.task_id, state: complete ? "done" : "calling", task_spec: spec, follow_up_questions: [], businesses: [business],
    calls: [{ call_id: result.call_id, place_id: business.place_id, status: complete ? "ended" : "calling", attempts: 1, outcome: complete ? result.outcome : null, reason: null, quote_ready: complete }],
    quotes: complete ? [quote] : [], excluded: [], comparison: complete ? comparison : null, failure_reason: null, cost_usd: 0, last_seq: complete ? 6 : 3 };
}
class FakeSource {
  static instances = [];
  static replay = true;
  readyState = 0;
  listeners = new Map();
  constructor(url) {
    this.url = url;
    FakeSource.instances.push(this);
    queueMicrotask(() => {
      if (this.readyState === 2) return;
      this.readyState = 1;
      this.emit("open", {});
      if (FakeSource.replay) events.forEach((item) => this.emit(item.type, { data: JSON.stringify(item), lastEventId: String(item.seq) }));
    });
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  emit(type, message) { if (this.readyState !== 2) this.listeners.get(type)?.(message); }
  close() { this.readyState = 2; }
}
beforeEach(() => { FakeSource.instances = []; FakeSource.replay = true; });
describe("HTTP and native named SSE transport", () => {
  it("reopens a saved task and restores transcript evidence without starting calls", async () => {
    const fetchImpl = vi.fn(async () => Response.json(snapshot()));
    const api = createApiTransport({ fetchImpl, EventSourceImpl: FakeSource });
    const reopened = await api.getTask(spec.task_id);
    expect(reopened.shops[0].transcript).toEqual(result.transcript);
    expect(reopened.shops[0].quote.options[0].priceSar.value).toBe(1200);
    expect(fetchImpl.mock.calls.every(([, options]) => options.method === "GET")).toBe(true);
    expect(FakeSource.instances[0].readyState).toBe(2);
  });
  it("skips snapshot history, delivers each new event once and closes on completion", async () => {
    const api = createApiTransport({ fetchImpl: async () => Response.json(snapshot(false)), EventSourceImpl: FakeSource });
    await api.getTask(spec.task_id);
    const onEvent = vi.fn(); const connection = vi.fn();
    api.subscribe(spec.task_id, onEvent, connection);
    await new Promise(queueMicrotask);
    expect(onEvent.mock.calls.map(([item]) => item.sequence)).toEqual([4, 5, 6]);
    expect(connection).toHaveBeenLastCalledWith({ state: "complete" });
    expect(FakeSource.instances.at(-1).readyState).toBe(2);
  });
  it("keeps network errors separate from task failure and never silently falls back", async () => {
    const api = createApiTransport({ fetchImpl: async () => { throw new TypeError("offline"); }, EventSourceImpl: FakeSource });
    await expect(api.getTask(spec.task_id)).rejects.toMatchObject({ code: "connection_error", userMessage: expect.stringContaining("الخادم") });
    expect(FakeSource.instances).toHaveLength(0);
  });
  it("shows backend Arabic validation errors and their field without retrying POST", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ error: { code: "unsafe_custom_question", message_ar: "السؤال غير مسموح", field: "custom_questions[0]" } }, { status: 422 }));
    const api = createApiTransport({ fetchImpl });
    await expect(api.createTask("طلب صيانة")).rejects.toMatchObject({ userMessage: "السؤال غير مسموح", field: "custom_questions[0]", status: 422 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("keeps the same EventSource during reconnect and ignores duplicate events", async () => {
    const fetchImpl = vi.fn(async () => Response.json(snapshot(false)));
    const api = createApiTransport({ fetchImpl, EventSourceImpl: FakeSource });
    await api.getTask(spec.task_id);
    FakeSource.replay = false;
    const onEvent = vi.fn(); const onConnection = vi.fn();
    const stop = api.subscribe(spec.task_id, onEvent, onConnection);
    await new Promise(queueMicrotask);
    const source = FakeSource.instances.at(-1);
    source.readyState = 0;
    source.emit("error", {});
    expect(onConnection).toHaveBeenLastCalledWith({ state: "reconnecting" });
    source.readyState = 1;
    source.emit("open", {});
    for (const item of [events[3], events[3], events[4]]) source.emit(item.type, { data: JSON.stringify(item), lastEventId: String(item.seq) });
    expect(onEvent.mock.calls.map(([item]) => item.sequence)).toEqual([4, 5]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    stop();
    source.emit(events[5].type, { data: JSON.stringify(events[5]), lastEventId: "6" });
    expect(onEvent).toHaveBeenCalledTimes(2);
  });
  it("quarantines events for another task instead of applying their data", async () => {
    const api = createApiTransport({ fetchImpl: async () => Response.json(snapshot(false)), EventSourceImpl: FakeSource });
    await api.getTask(spec.task_id);
    FakeSource.replay = false;
    const onEvent = vi.fn(); const onConnection = vi.fn();
    api.subscribe(spec.task_id, onEvent, onConnection);
    await new Promise(queueMicrotask);
    FakeSource.instances.at(-1).emit("call.ended", { data: JSON.stringify({ ...events[3], task_id: "tsk_other" }), lastEventId: "4" });
    expect(onEvent).not.toHaveBeenCalled();
    expect(onConnection).toHaveBeenLastCalledWith(expect.objectContaining({ state: "disconnected" }));
  });
});
