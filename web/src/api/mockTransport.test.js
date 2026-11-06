import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockTransport } from "./mockTransport";
import { foundationScenario } from "../mocks/scenarios/foundationScenario";
import { stockCheckScenario } from "../mocks/scenarios/stockCheckScenario";
import { createTaskSpec } from "../features/taskFlow/taskRequestModel";

function shortScenario() {
  return {
    ...foundationScenario,
    events: foundationScenario.events.slice(0, 3),
  };
}

function needsInputScenario() {
  return {
    ...foundationScenario,
    snapshot: {
      ...foundationScenario.snapshot,
      phase: "needs_input",
      missingQuestions: [
        { key: "device_model", prompt: "وش نوع الجهاز؟" },
      ],
    },
    events: [],
  };
}

describe("mock task transport", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("creates a task, stores answers, starts it, and returns its snapshot", async () => {
    const transport = createMockTransport(shortScenario());
    const created = await transport.createTask("  أبي أغير الشاشة  ");

    expect(created.taskId).toBe("fixture_foundation");
    expect(created.requestText).toBe("أبي أغير الشاشة");
    expect(created.phase).toBe("idle");

    const answered = await transport.submitAnswers(created.taskId, { device_model: "iPhone 15 Pro" });
    expect(answered.answers).toEqual({ device_model: "iPhone 15 Pro" });

    const started = await transport.startTask(created.taskId);
    expect(started.phase).toBe("discovering");
    await expect(transport.getTask(created.taskId)).resolves.toMatchObject({ phase: "discovering" });
  });

  it("uses TaskSpec missing_slots for incomplete requests without changing request_text", async () => {
    const transport = createMockTransport(shortScenario());
    const taskSpec = createTaskSpec({ requestText: "أبي أصلح المكيف" });
    const created = await transport.createTask(taskSpec);

    expect(created.requestText).toBe("أبي أصلح المكيف");
    expect(created.phase).toBe("needs_input");
    expect(created.missingQuestions.map((question) => question.key)).toEqual([
      "device_model",
      "repair_type",
      "area",
    ]);
    expect(created.requestText).not.toContain("آيفون");
    expect(created.requestText).not.toContain("الرياض");
  });

  it("keeps a missing-input fixture paused until answers start it", async () => {
    const transport = createMockTransport(needsInputScenario());
    const created = await transport.createTask("أبي أصلح جوالي");

    expect(created.phase).toBe("needs_input");
    expect(created.missingQuestions).toHaveLength(1);

    await expect(transport.submitAnswers(created.taskId, {})).rejects.toThrow(TypeError);
    await expect(transport.startTask(created.taskId)).rejects.toThrow(TypeError);

    const answered = await transport.submitAnswers(created.taskId, { device_model: "iPhone 15 Pro" });
    expect(answered.phase).toBe("needs_input");
    expect(answered.answers).toEqual({ device_model: "iPhone 15 Pro" });

    const started = await transport.startTask(created.taskId);
    expect(started.phase).toBe("discovering");
    expect(started.missingQuestions).toEqual([]);
  });

  it("rejects missing or mismatched task identities", async () => {
    const transport = createMockTransport(shortScenario());

    await expect(transport.getTask("missing")).rejects.toThrow("No active mock task");
    await expect(transport.createTask("   ")).rejects.toThrow("non-empty request");

    await transport.createTask("طلب صالح");
    await expect(transport.getTask("other_task")).rejects.toThrow("Task identity mismatch");
    await expect(transport.submitAnswers("other_task", { area: "الملقا" })).rejects.toThrow("Task identity mismatch");
  });

  it("emits validated lifecycle events and updates the task snapshot", async () => {
    const transport = createMockTransport(shortScenario());
    const created = await transport.createTask("طلب صالح");
    await transport.startTask(created.taskId);
    const received = [];

    transport.subscribe(created.taskId, (event) => received.push(event));
    await vi.advanceTimersByTimeAsync(100);

    expect(received.map((event) => event.type)).toEqual([
      "task.created",
      "business.found",
      "business.found",
    ]);
    await expect(transport.getTask(created.taskId)).resolves.toMatchObject({
      phase: "discovering",
    });
  });

  it("models overlapping calls before earlier calls finish", async () => {
    const transport = createMockTransport(foundationScenario);
    const created = await transport.createTask("طلب صالح");
    await transport.startTask(created.taskId);
    const received = [];

    transport.subscribe(created.taskId, (event) => received.push(event));
    await vi.advanceTimersByTimeAsync(90);

    const secondCallStarted = received.findIndex(
      (event) => event.type === "call.started" && event.data.callId === "call_2",
    );
    const firstCallEnded = received.findIndex(
      (event) => event.type === "call.ended" && event.data.callId === "call_1",
    );

    expect(secondCallStarted).toBeGreaterThanOrEqual(0);
    expect(firstCallEnded).toBe(-1);
    expect(received.some(
      (event) => event.type === "call.started" && event.data.callId === "call_3",
    )).toBe(true);

    await vi.advanceTimersByTimeAsync(200);

    await expect(transport.getTask(created.taskId)).resolves.toMatchObject({
      phase: "partial",
      shops: expect.arrayContaining([
        expect.objectContaining({ placeId: "place_1", status: "ready" }),
        expect.objectContaining({ placeId: "place_2", status: "ready" }),
        expect.objectContaining({ placeId: "place_3", status: "failed" }),
      ]),
    });
  });

  it("replays the electronics stock-check fixture through the existing availability contract", async () => {
    const transport = createMockTransport(stockCheckScenario);
    const taskSpec = createTaskSpec({
      requestText: "أبي أتأكد إذا شاشة آيفون 15 برو متوفرة",
      deviceType: "آيفون",
      deviceModel: "15 برو",
      repairType: "تغيير شاشة",
      area: "حي الملقا",
      maxBusinesses: 1,
    });
    const created = await transport.createTask(taskSpec);
    const received = [];

    expect(created.requestText).toBe(taskSpec.request_text);
    expect(created.phase).toBe("idle");

    await transport.startTask(created.taskId);
    transport.subscribe(created.taskId, (event) => received.push(event));
    await vi.advanceTimersByTimeAsync(150);

    const finalSnapshot = await transport.getTask(created.taskId);
    expect(received.map((event) => event.type)).toEqual([
      "task.created",
      "business.found",
      "call.started",
      "call.talking",
      "call.ended",
      "quote.ready",
      "comparison.ready",
    ]);
    expect(finalSnapshot.comparison.status).toBe("ranked");
    expect(finalSnapshot.shops[0].quote.availability).toMatchObject({
      status: "found",
      value: "available",
      evidenceTurn: 1,
    });
  });

  it("returns an unsubscribe function that prevents future events", async () => {
    const transport = createMockTransport(shortScenario());
    const created = await transport.createTask("طلب صالح");
    await transport.startTask(created.taskId);
    const received = [];

    const unsubscribe = transport.subscribe(created.taskId, (event) => received.push(event));
    await vi.advanceTimersByTimeAsync(15);
    unsubscribe();
    unsubscribe();
    await vi.advanceTimersByTimeAsync(500);

    expect(received.map((event) => event.type)).toEqual(["task.created"]);
  });

  it("requires startTask and a callback before subscribing", async () => {
    const transport = createMockTransport(shortScenario());
    const created = await transport.createTask("طلب صالح");

    expect(() => transport.subscribe(created.taskId, () => {})).toThrow("Start the mock task");
    await transport.startTask(created.taskId);
    expect(() => transport.subscribe(created.taskId)).toThrow("callback");
  });

  it("rejects scenarios with malformed or cross-task events", () => {
    const invalid = structuredClone(shortScenario());
    invalid.events[0].event.taskId = "other_task";

    expect(() => createMockTransport(invalid)).toThrow("taskId");
  });
});
