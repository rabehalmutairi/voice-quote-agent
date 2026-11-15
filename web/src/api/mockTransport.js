import { assertMockScenario, assertTaskEvent, assertTaskSnapshot } from "../contracts/provisionalSchemas";
import {
  assertTaskSpec,
  createMissingSlotQuestions,
} from "../features/taskFlow/taskRequestModel";
import { foundationScenario } from "../mocks/scenarios/foundationScenario";
import { stockCheckScenario } from "../mocks/scenarios/stockCheckScenario";
import {
  hydrateTaskSnapshot,
  initialTaskState,
  taskReducer,
  taskStateToSnapshot,
} from "../state/taskReducer";
import { assertTaskTransport } from "./transportContract";

function clone(value) {
  return structuredClone(value);
}

function hasRequiredAnswers(questions, submittedAnswers) {
  return questions.every(
    (question) => typeof submittedAnswers?.[question.key] === "string"
      && submittedAnswers[question.key].trim().length > 0,
  );
}

function isValidAnswerMap(answers) {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    return false;
  }

  return Object.entries(answers).every(
    ([key, value]) => key.trim().length > 0
      && typeof value === "string"
      && value.trim().length > 0,
  );
}

function getTaskRequestDetails(request, scenario) {
  if (typeof request === "string") {
    const requestText = request.trim();

    if (!requestText) {
      throw new TypeError("A non-empty request is required.");
    }

    return {
      requestText,
      missingQuestions: scenario.snapshot.missingQuestions,
      initialAnswers: {},
    };
  }

  const taskSpec = assertTaskSpec(request);
  const missingQuestions = scenario.snapshot.missingQuestions.length > 0
    ? scenario.snapshot.missingQuestions
    : createMissingSlotQuestions(taskSpec.missing_slots);
  const initialAnswers = {
    ...taskSpec.slots,
    ...(taskSpec.area?.label ? { area: taskSpec.area.label } : {}),
  };

  return {
    requestText: taskSpec.request_text.trim(),
    missingQuestions,
    initialAnswers,
  };
}

/**
 * Development-only transport. It owns one active fixture task and exposes the same
 * lifecycle shape that the future HTTP/SSE transport must implement.
 */
export function createMockTransport(inputScenario = foundationScenario) {
  let scenario = assertMockScenario(inputScenario);
  let activeSnapshot = null;
  let reducerState = initialTaskState;
  let started = false;
  let answers = {};
  let scheduledTimers = new Set();

  function clearScheduledEvents() {
    for (const timer of scheduledTimers) {
      clearTimeout(timer);
    }
    scheduledTimers = new Set();
  }

  function requireCurrentTask(taskId) {
    if (!activeSnapshot) {
      throw new Error("No active mock task. Call createTask first.");
    }

    if (taskId !== activeSnapshot.taskId) {
      throw new Error("Task identity mismatch.");
    }
  }

  function syncSnapshot() {
    activeSnapshot = assertTaskSnapshot({
      ...taskStateToSnapshot(reducerState),
      answers,
    });
    return clone(activeSnapshot);
  }

  const transport = {
    async createTask(request) {
      scenario = assertMockScenario(request?.category === "stock_check" ? stockCheckScenario : inputScenario);
      const requestDetails = getTaskRequestDetails(request, scenario);
      clearScheduledEvents();
      started = false;
      answers = requestDetails.initialAnswers;
      const initialPhase = requestDetails.missingQuestions.length > 0
        ? "needs_input"
        : "idle";
      reducerState = hydrateTaskSnapshot(initialTaskState, {
        ...scenario.snapshot,
        requestText: requestDetails.requestText,
        phase: initialPhase,
        answers,
        missingQuestions: requestDetails.missingQuestions,
      });
      return syncSnapshot();
    },

    async submitAnswers(taskId, submittedAnswers) {
      requireCurrentTask(taskId);

      if (!isValidAnswerMap(submittedAnswers)
        || !hasRequiredAnswers(reducerState.missingQuestions, submittedAnswers)) {
        throw new TypeError("Answers must be a non-empty string map.");
      }

      answers = {
        ...answers,
        ...clone(submittedAnswers),
      };
      return syncSnapshot();
    },

    async startTask(taskId) {
      requireCurrentTask(taskId);

      if (!hasRequiredAnswers(reducerState.missingQuestions, answers)) {
        throw new TypeError("Required answers are missing.");
      }

      started = true;

      if (reducerState.phase === "idle" || reducerState.phase === "needs_input") {
        reducerState = {
          ...reducerState,
          phase: "discovering",
          missingQuestions: [],
        };
      }

      return syncSnapshot();
    },

    async getTask(taskId) {
      requireCurrentTask(taskId);
      return clone(activeSnapshot);
    },

    subscribe(taskId, onEvent) {
      requireCurrentTask(taskId);

      if (!started) {
        throw new Error("Start the mock task before subscribing.");
      }

      if (typeof onEvent !== "function") {
        throw new TypeError("subscribe requires an event callback.");
      }

      let active = true;
      const unsubscribe = () => {
        if (!active) {
          return;
        }

        active = false;
        clearScheduledEvents();
      };

      scheduledTimers = new Set(
        scenario.events.map(({ delayMs, event }) => {
          const timer = setTimeout(() => {
            scheduledTimers.delete(timer);
            if (!active) {
              return;
            }

            const validEvent = assertTaskEvent(event);
            reducerState = taskReducer(reducerState, validEvent);
            syncSnapshot();
            onEvent(clone(validEvent));
          }, delayMs);

          return timer;
        }),
      );

      return unsubscribe;
    },
  };

  return assertTaskTransport(transport);
}
