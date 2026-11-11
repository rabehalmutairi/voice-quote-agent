import { describe, expect, it } from "vitest";
import {
  hydrateTaskSnapshot,
  initialTaskState,
  taskReducer,
} from "./taskReducer";

const taskId = "task_1";

function event(type, data, overrides = {}) {
  return {
    eventId: overrides.eventId ?? `${type}-${overrides.sequence ?? 1}`,
    sequence: overrides.sequence ?? 1,
    type,
    taskId: overrides.taskId ?? taskId,
    at: "2026-10-26T18:00:00.000Z",
    data,
  };
}

function eventWithoutReplayMetadata(type, data) {
  const next = event(type, data);
  delete next.eventId;
  delete next.sequence;
  return next;
}

function business(placeId) {
  return {
    placeId,
    name: `Shop ${placeId}`,
    phoneE164: "+966501234567",
    address: "Riyadh",
  };
}

const found = (value, evidenceQuote) => ({
  value,
  status: "found",
  evidenceQuote,
  evidenceTurn: 1,
});

const quote = {
  options: [
    {
      partType: found("commercial", "تجاري"),
      priceSar: found(450, "أربعمية وخمسين"),
      warrantyDays: found(30, "ضمان شهر"),
    },
  ],
  turnaroundMinutes: found(45, "خمسة وأربعين دقيقة"),
  evidenceIssues: [],
  transcript: [
    {
      i: 1,
      speaker: "shop",
      t: 21,
      text: "تجاري، أربعمية وخمسين، ضمان شهر، خمسة وأربعين دقيقة.",
    },
  ],
};

function stateWithThreeShops() {
  let state = taskReducer(
    initialTaskState,
    event("task.created", { requestText: "إصلاح شاشة" }, { sequence: 1 }),
  );

  for (const [index, placeId] of ["place_1", "place_2", "place_3"].entries()) {
    state = taskReducer(
      state,
      event("business.found", { business: business(placeId) }, { sequence: index + 2 }),
    );
  }

  return state;
}

describe("taskReducer", () => {
  it("shows a single ordered retry for the same call, even without eventId", () => {
    let state = stateWithThreeShops();
    const next = (sequence, type, data) => {
      const value = event(type, data, { sequence });
      delete value.eventId;
      state = taskReducer(state, value);
    };
    const data = { callId: "call_1", placeId: "place_1" };
    next(5, "call.started", data);
    next(6, "call.failed", { ...data, outcome: "no_answer", reason: "no answer" });
    next(7, "call.started", data);
    expect(state.shops.place_1).toMatchObject({ status: "calling", attempt: 2 });
    next(8, "call.failed", { ...data, outcome: "no_answer", reason: "no answer" });
    next(9, "call.started", data);
    expect(state.shops.place_1.status).toBe("failed");
  });
  it("hydrates a task snapshot and preserves its shops", () => {
    const snapshot = {
      taskId,
      phase: "calling",
      requestText: "إصلاح شاشة",
      answers: { device_model: "iPhone 15 Pro" },
      missingQuestions: [],
      shops: [
        { ...business("place_1"), status: "discovered" },
        { ...business("place_2"), status: "discovered" },
      ],
      comparison: null,
    };

    const state = hydrateTaskSnapshot(initialTaskState, snapshot);

    expect(state).toMatchObject({
      taskId,
      phase: "calling",
      requestText: "إصلاح شاشة",
      answers: { device_model: "iPhone 15 Pro" },
    });
    expect(Object.keys(state.shops)).toEqual(["place_1", "place_2"]);
  });

  it("keeps the hydrated request when the replayed creation event has fixture copy", () => {
    const hydrated = hydrateTaskSnapshot(initialTaskState, {
      taskId,
      phase: "idle",
      requestText: "طلب المستخدم المخصص",
      shops: [],
    });
    const replayed = taskReducer(
      hydrated,
      event("task.created", { requestText: "طلب fixture مختلف" }, { sequence: 1 }),
    );

    expect(replayed.requestText).toBe("طلب المستخدم المخصص");
  });

  it("ignores invalid and cross-task snapshots", () => {
    const hydrated = hydrateTaskSnapshot(initialTaskState, {
      taskId,
      phase: "idle",
      shops: [],
    });
    const invalid = hydrateTaskSnapshot(hydrated, { taskId, phase: "not-a-phase", shops: [] });
    const otherTask = hydrateTaskSnapshot(hydrated, { taskId: "task_2", phase: "idle", shops: [] });

    expect(invalid).toBe(hydrated);
    expect(otherTask).toBe(hydrated);
  });

  it("rejects events belonging to another task without replay metadata changes", () => {
    const state = taskReducer(initialTaskState, event("task.created", {}, { sequence: 1 }));
    const otherTask = taskReducer(
      state,
      event("task.needs_input", { questions: [{ key: "area", prompt: "وين؟" }] }, {
        taskId: "task_2",
        sequence: 2,
      }),
    );

    expect(otherTask).toBe(state);
  });

  it("ignores unknown event types before touching state or replay metadata", () => {
    const state = taskReducer(initialTaskState, event("task.created", {}, { sequence: 1 }));
    const unknown = taskReducer(
      state,
      {
        eventId: "future-event",
        sequence: 2,
        type: "future.event",
        taskId,
        at: "2026-10-26T18:00:01.000Z",
        data: { arbitrary: true },
      },
    );

    expect(unknown).toBe(state);
  });

  it("ignores duplicate and out-of-order events", () => {
    const created = event("task.created", {}, { sequence: 2 });
    const state = taskReducer(initialTaskState, created);
    const duplicate = taskReducer(state, created);
    const older = taskReducer(
      state,
      event("task.needs_input", { questions: [] }, { sequence: 1 }),
    );

    expect(duplicate).toBe(state);
    expect(older).toBe(state);
  });

  it("deduplicates fixture events even when provisional replay fields are absent", () => {
    const first = taskReducer(initialTaskState, {
      type: "task.created",
      taskId,
      at: "2026-10-26T18:00:00.000Z",
      data: { requestText: "إصلاح شاشة" },
    });
    const second = taskReducer(initialTaskState, {
      type: "task.created",
      taskId,
      at: "2026-10-26T18:00:00.000Z",
      data: { requestText: "إصلاح شاشة" },
    });

    expect(second).toEqual(first);
    expect(first.processedEventKeys).toHaveLength(1);
    expect(first.lastSequence).toBeNull();
  });

  it("tracks independent discovery and call lifecycle state for three shops", () => {
    let state = stateWithThreeShops();
    state = taskReducer(state, event("call.started", { callId: "call_1", placeId: "place_1" }, { sequence: 5 }));
    state = taskReducer(state, event("call.talking", { callId: "call_2", placeId: "place_2" }, { sequence: 6 }));
    state = taskReducer(state, event("call.failed", {
      callId: "call_3",
      placeId: "place_3",
      outcome: "no_answer",
      reason: "لم يرد",
    }, { sequence: 7 }));
    state = taskReducer(state, event("quote.ready", {
      callId: "call_1",
      placeId: "place_1",
      quote,
    }, { sequence: 8 }));

    expect(state.shops.place_1).toMatchObject({ status: "ready", callId: "call_1", quote });
    expect(state.shops.place_2).toMatchObject({ status: "talking", callId: "call_2" });
    expect(state.shops.place_3).toMatchObject({ status: "failed", outcome: "no_answer" });
  });

  it("keeps the transcript beside a quote so evidence can identify its shop turn", () => {
    const transcript = [
      {
        i: 1,
        speaker: "shop",
        t: 21,
        text: "تجاري، أربعمية وخمسين، ضمان شهر، خمسة وأربعين دقيقة.",
      },
    ];
    let state = taskReducer(
      stateWithThreeShops(),
      event("call.started", { callId: "call_1", placeId: "place_1" }, { sequence: 5 }),
    );
    state = taskReducer(
      state,
      event("quote.ready", {
        callId: "call_1",
        placeId: "place_1",
        quote,
        transcript,
      }, { sequence: 8 }),
    );

    expect(state.shops.place_1.transcript).toEqual(transcript);
  });

  it("ignores a quote that does not belong to the shop's active call", () => {
    let state = taskReducer(
      stateWithThreeShops(),
      event("call.started", { callId: "call_1", placeId: "place_1" }, { sequence: 5 }),
    );

    const mismatched = taskReducer(
      state,
      event("quote.ready", {
        callId: "call_other",
        placeId: "place_1",
        quote,
      }, { sequence: 6 }),
    );

    expect(mismatched).toBe(state);
    expect(mismatched.shops.place_1.quote).toBeNull();
  });

  it("does not regress shop state when delayed events omit sequence metadata", () => {
    let state = taskReducer(
      initialTaskState,
      eventWithoutReplayMetadata("task.created", { requestText: "إصلاح شاشة" }),
    );
    state = taskReducer(
      state,
      eventWithoutReplayMetadata("business.found", { business: business("place_1") }),
    );
    state = taskReducer(
      state,
      eventWithoutReplayMetadata("call.started", { callId: "call_1", placeId: "place_1" }),
    );
    state = taskReducer(
      state,
      eventWithoutReplayMetadata("call.talking", { callId: "call_1", placeId: "place_1" }),
    );
    state = taskReducer(
      state,
      eventWithoutReplayMetadata("call.ended", {
        callId: "call_1",
        placeId: "place_1",
        outcome: "human_completed",
      }),
    );
    state = taskReducer(
      state,
      eventWithoutReplayMetadata("quote.ready", {
        callId: "call_1",
        placeId: "place_1",
        quote,
      }),
    );

    const delayedDiscovery = taskReducer(
      state,
      eventWithoutReplayMetadata("business.found", {
        business: { ...business("place_1"), name: "اسم قديم للمحل" },
      }),
    );
    const delayedCall = taskReducer(
      delayedDiscovery,
      eventWithoutReplayMetadata("call.started", { callId: "call_old", placeId: "place_1" }),
    );
    const delayedTalking = taskReducer(
      delayedCall,
      eventWithoutReplayMetadata("call.talking", { callId: "call_old", placeId: "place_1" }),
    );

    expect(delayedDiscovery).toBe(state);
    expect(delayedCall).toBe(state);
    expect(delayedTalking).toBe(state);
    expect(state.shops.place_1).toMatchObject({
      status: "ready",
      callId: "call_1",
      quote,
      name: "Shop place_1",
    });
  });

  it("keeps a failed shop terminal when a late quote arrives without sequence metadata", () => {
    let state = taskReducer(
      initialTaskState,
      eventWithoutReplayMetadata("task.created", { requestText: "إصلاح شاشة" }),
    );
    state = taskReducer(
      state,
      eventWithoutReplayMetadata("business.found", { business: business("place_1") }),
    );
    state = taskReducer(
      state,
      eventWithoutReplayMetadata("call.started", { callId: "call_failed", placeId: "place_1" }),
    );
    state = taskReducer(
      state,
      eventWithoutReplayMetadata("call.failed", {
        callId: "call_failed",
        placeId: "place_1",
        outcome: "no_answer",
        reason: "لم يرد",
      }),
    );

    const lateQuote = taskReducer(
      state,
      eventWithoutReplayMetadata("quote.ready", {
        callId: "call_failed",
        placeId: "place_1",
        quote,
      }),
    );

    expect(lateQuote).toBe(state);
    expect(lateQuote.shops.place_1).toMatchObject({ status: "failed", outcome: "no_answer" });
  });

  it("does not reopen clarification after discovery has started", () => {
    let state = taskReducer(
      initialTaskState,
      eventWithoutReplayMetadata("task.created", { requestText: "إصلاح شاشة" }),
    );
    state = taskReducer(
      state,
      eventWithoutReplayMetadata("business.found", { business: business("place_1") }),
    );

    const delayedNeedsInput = taskReducer(
      state,
      eventWithoutReplayMetadata("task.needs_input", {
        questions: [{ key: "area", prompt: "وين؟" }],
      }),
    );

    expect(delayedNeedsInput).toBe(state);
    expect(delayedNeedsInput.phase).toBe("discovering");
  });

  it("accepts additional discovered shops and supports partial task outcomes", () => {
    const state = stateWithThreeShops();
    const fourth = taskReducer(
      state,
      event("business.found", { business: business("place_4") }, { sequence: 10 }),
    );
    const partial = taskReducer(
      state,
      event("comparison.ready", {
        comparison: {
          status: "partial",
          basis: "commercial price",
          ranking: [{ placeId: "place_1", rank: 1, reason: "lowest" }],
          excluded: [{ placeId: "place_3", reason: "no answer" }],
          cannotCompareReasons: [],
        },
      }, { sequence: 11 }),
    );

    expect(Object.keys(fourth.shops)).toHaveLength(4);
    expect(partial.phase).toBe("partial");
    expect(partial.comparison.status).toBe("partial");
  });

  it("rejects malformed known events without changing state", () => {
    const state = stateWithThreeShops();
    const malformed = taskReducer(state, event("quote.ready", {
      callId: "call_1",
      placeId: "place_1",
      quote: {
        options: [{
          partType: { value: "commercial", status: "found" },
          priceSar: { status: "not_mentioned" },
        }],
        turnaroundMinutes: { status: "not_mentioned" },
      },
    }, { sequence: 20 }));

    expect(malformed).toBe(state);
  });
});
