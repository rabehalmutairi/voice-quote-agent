import { parseTaskEvent, parseTaskSnapshot } from "../contracts/provisionalSchemas";
import { getQuoteTranscript } from "../utils/evidence";

export const initialTaskState = {
  taskId: null,
  phase: "idle",
  requestText: null,
  answers: {},
  missingQuestions: [],
  shops: {},
  comparison: null,
  error: null,
  // These fields are local replay metadata. The backend contract has not finalized them.
  processedEventKeys: [],
  lastSequence: null,
};

const FAILURE_OUTCOMES = new Set([
  "voicemail",
  "ivr",
  "no_answer",
  "busy",
  "hung_up",
  "wrong_business",
  "failed",
]);

const SHOP_STATUS_RANK = {
  discovered: 0,
  calling: 1,
  talking: 2,
  extracting: 3,
  ready: 4,
  failed: 4,
};

const TASK_PHASE_RANK = {
  idle: 0,
  needs_input: 1,
  discovering: 2,
  calling: 3,
  extracting: 4,
  comparing: 5,
  done: 6,
  partial: 6,
  failed: 6,
};

const TERMINAL_TASK_PHASES = new Set(["done", "partial", "failed"]);

function stableSerialize(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }

  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`);

  return `{${entries.join(",")}}`;
}

function getEventKey(event) {
  if (event.eventId) {
    return `id:${event.eventId}`;
  }
  if (typeof event.sequence === "number") return `seq:${event.sequence}`;

  // A deterministic fallback prevents replaying identical fixture events without making
  // the provisional eventId field a requirement for the eventual backend contract.
  return `payload:${event.type}:${stableSerialize(event.data)}`;
}

function addShopFromBusiness(business) {
  return {
    ...business,
    status: "discovered",
    callId: undefined,
    outcome: undefined,
    quote: null,
    transcript: [],
    error: undefined,
  };
}

function updateShop(state, placeId, update) {
  const currentShop = state.shops[placeId];
  if (!currentShop) {
    return null;
  }

  return {
    ...state,
    shops: {
      ...state.shops,
      [placeId]: { ...currentShop, ...update },
    },
  };
}

function comparisonReferencesKnownShops(state, comparison) {
  return [...comparison.ranking, ...comparison.excluded]
    .every((item) => Boolean(state.shops[item.placeId]));
}

function advanceTaskPhase(currentPhase, nextPhase) {
  if (TERMINAL_TASK_PHASES.has(currentPhase)) {
    return currentPhase;
  }

  return TASK_PHASE_RANK[nextPhase] >= TASK_PHASE_RANK[currentPhase]
    ? nextPhase
    : currentPhase;
}

function shopEventStatus(event) {
  switch (event.type) {
    case "business.found":
      return "discovered";
    case "call.started":
      return "calling";
    case "call.talking":
      return "talking";
    case "call.ended":
      return FAILURE_OUTCOMES.has(event.data.outcome) ? "failed" : "extracting";
    case "call.failed":
      return "failed";
    case "quote.ready":
      return "ready";
    default:
      return null;
  }
}

/**
 * Events can arrive without stable ordering metadata. A shop's lifecycle is still
 * monotonic, so an older event must not move it back to a previous state or replace
 * a terminal result with a different call.
 */
function isStaleShopEvent(shop, event) {
  if (!shop) {
    return false;
  }
  if (event.type === "call.started" && typeof event.sequence === "number"
    && shop.callId === event.data.callId && shop.status === "failed"
    && ["no_answer", "busy", "failed"].includes(shop.outcome) && (shop.attempt ?? 1) < 2) {
    return false;
  }

  const incomingStatus = shopEventStatus(event);
  if (!incomingStatus) {
    return false;
  }

  const currentRank = SHOP_STATUS_RANK[shop.status] ?? -1;
  const incomingRank = SHOP_STATUS_RANK[incomingStatus] ?? -1;
  const incomingCallId = event.data.callId;

  if (
    shop.callId
    && incomingCallId
    && shop.callId !== incomingCallId
    && currentRank >= SHOP_STATUS_RANK.calling
  ) {
    return true;
  }

  if (incomingRank < currentRank) {
    return true;
  }

  if (shop.status === "failed") {
    return true;
  }

  return shop.status === "ready" && event.type !== "quote.ready";
}

function canAcceptNeedsInput(state) {
  return (state.phase === "idle" || state.phase === "discovering" || state.phase === "needs_input")
    && Object.keys(state.shops).length === 0;
}

function applyKnownEvent(state, event) {
  if (TERMINAL_TASK_PHASES.has(state.phase)) {
    return state;
  }

  switch (event.type) {
    case "task.created":
      return {
        ...state,
        taskId: event.taskId,
        phase: advanceTaskPhase(state.phase, "discovering"),
        requestText: state.requestText ?? event.data.requestText,
        error: null,
      };

    case "task.needs_input":
      if (!canAcceptNeedsInput(state)) {
        return state;
      }

      return {
        ...state,
        phase: "needs_input",
        missingQuestions: event.data.questions,
      };

    case "business.found": {
      const business = event.data.business;
      const existing = state.shops[business.placeId];

      if (isStaleShopEvent(existing, event)) {
        return state;
      }

      return {
        ...state,
        phase: advanceTaskPhase(state.phase, "discovering"),
        shops: {
          ...state.shops,
          [business.placeId]: existing
            ? { ...existing, ...business }
            : addShopFromBusiness(business),
        },
      };
    }

    case "call.started": {
      if (isStaleShopEvent(state.shops[event.data.placeId], event)) {
        return state;
      }

      const next = updateShop(state, event.data.placeId, {
        status: "calling",
        attempt: state.shops[event.data.placeId]?.status === "failed" ? 2 : 1,
        callId: event.data.callId,
        outcome: undefined,
        error: undefined,
      });

      return next
        ? { ...next, phase: advanceTaskPhase(next.phase, "calling") }
        : next;
    }

    case "call.talking": {
      if (isStaleShopEvent(state.shops[event.data.placeId], event)) {
        return state;
      }

      const next = updateShop(state, event.data.placeId, {
        status: "talking",
        callId: event.data.callId,
      });

      return next
        ? { ...next, phase: advanceTaskPhase(next.phase, "calling") }
        : next;
    }

    case "call.ended": {
      if (isStaleShopEvent(state.shops[event.data.placeId], event)) {
        return state;
      }

      const failed = FAILURE_OUTCOMES.has(event.data.outcome);
      const next = updateShop(state, event.data.placeId, {
        status: failed ? "failed" : "extracting",
        callId: event.data.callId,
        outcome: event.data.outcome,
        error: failed ? `Call ended with outcome: ${event.data.outcome}` : undefined,
      });

      return next
        ? { ...next, phase: failed ? next.phase : advanceTaskPhase(next.phase, "extracting") }
        : next;
    }

    case "call.failed": {
      if (isStaleShopEvent(state.shops[event.data.placeId], event)) {
        return state;
      }

      const next = updateShop(state, event.data.placeId, {
        status: "failed",
        callId: event.data.callId,
        outcome: event.data.outcome ?? "failed",
        error: event.data.reason,
      });

      return next
        ? { ...next, phase: advanceTaskPhase(next.phase, "calling") }
        : next;
    }

    case "quote.ready": {
      const shop = state.shops[event.data.placeId];

      if (
        !shop
        || !shop.callId
        || shop.callId !== event.data.callId
        || isStaleShopEvent(shop, event)
      ) {
        return state;
      }

      const next = updateShop(state, event.data.placeId, {
        status: "ready",
        callId: event.data.callId,
        quote: event.data.quote,
        transcript: getQuoteTranscript(
          event.data.quote,
          event.data.transcript ?? shop.transcript ?? [],
        ),
        error: undefined,
      });

      return next
        ? { ...next, phase: advanceTaskPhase(next.phase, "extracting") }
        : next;
    }

    case "comparison.ready":
      if (!comparisonReferencesKnownShops(state, event.data.comparison)) {
        return state;
      }

      return {
        ...state,
        phase: event.data.comparison.status === "partial" ? "partial" : "done",
        comparison: event.data.comparison,
      };

    case "task.failed":
      return {
        ...state,
        phase: "failed",
        error: event.data.reason,
      };

    default:
      return state;
  }
}

/**
 * Hydrates a validated provisional snapshot without changing replay metadata.
 * A snapshot for another task is ignored so reconnects cannot replace active state.
 */
export function hydrateTaskSnapshot(state, snapshot) {
  const parsed = parseTaskSnapshot(snapshot);

  if (!parsed.success || (state.taskId && state.taskId !== parsed.data.taskId)) {
    return state;
  }

  return {
    ...state,
    taskId: parsed.data.taskId,
    phase: parsed.data.phase,
    requestText: parsed.data.requestText ?? null,
    answers: parsed.data.answers,
    missingQuestions: parsed.data.missingQuestions,
    shops: Object.fromEntries(parsed.data.shops.map((shop) => [shop.placeId, shop])),
    comparison: parsed.data.comparison ?? null,
    error: parsed.data.error ?? null,
  };
}

function isOutOfOrderEvent(state, event) {
  return typeof event.sequence === "number"
    && typeof state.lastSequence === "number"
    && event.sequence <= state.lastSequence;
}

function rememberEvent(state, event, eventKey) {
  return {
    ...state,
    processedEventKeys: [...state.processedEventKeys, eventKey],
    lastSequence: typeof event.sequence === "number" ? event.sequence : state.lastSequence,
  };
}

/**
 * Reduces only known, valid events for the active task. Events without finalized replay
 * metadata are accepted and deduplicated by a deterministic payload key for fixtures.
 */
export function taskReducer(state = initialTaskState, rawEvent) {
  const parsed = parseTaskEvent(rawEvent);

  if (!parsed.success) {
    return state;
  }

  const event = parsed.data;

  if (state.taskId && event.taskId !== state.taskId) {
    return state;
  }

  if (isOutOfOrderEvent(state, event)) {
    return state;
  }

  const eventKey = getEventKey(event);
  if (state.processedEventKeys.includes(eventKey)) {
    return state;
  }

  const next = applyKnownEvent(state, event);

  // Relational events for an unknown shop are safely ignored, including replay metadata.
  if (next === null || next === state) {
    return state;
  }

  return rememberEvent(next, event, eventKey);
}

/**
 * Converts reducer state to the provisional snapshot shape used by the mock transport.
 */
export function taskStateToSnapshot(state) {
  return {
    taskId: state.taskId,
    phase: state.phase,
    requestText: state.requestText ?? undefined,
    answers: state.answers,
    missingQuestions: state.missingQuestions,
    shops: Object.values(state.shops),
    comparison: state.comparison,
    error: state.error ?? undefined,
  };
}
