import { useCallback, useEffect, useRef, useState } from "react";
import { assertTaskTransport } from "../../api/transportContract";
import { parseTaskSnapshot } from "../../contracts/provisionalSchemas";
import {
  hydrateTaskSnapshot,
  initialTaskState,
  taskReducer,
} from "../../state/taskReducer";

function needsInput(taskState) {
  return taskState.phase === "needs_input"
    || (taskState.phase === "idle" && taskState.missingQuestions.length > 0);
}

function getUserFacingError(error) {
  if (error?.userMessage) return error.userMessage;
  if (error instanceof TypeError) {
    return "تحقق من البيانات المطلوبة ثم حاول مرة أخرى.";
  }

  return "تعذر بدء طلب العروض الآن. حاول مرة أخرى.";
}

function getRequestText(request) {
  if (typeof request === "string") {
    return request.trim();
  }

  return typeof request?.request_text === "string"
    ? request.request_text.trim()
    : "";
}

function assertSnapshotForTask(taskId, snapshot) {
  const parsed = parseTaskSnapshot(snapshot);

  if (!parsed.success || parsed.data.taskId !== taskId) {
    throw new Error("The transport returned an invalid task snapshot.");
  }

  return parsed.data;
}

/**
 * Coordinates the structured request form with the transport and keeps event reduction
 * outside presentational components. Legacy strings remain accepted for focused fixture
 * tests while the active form sends a TaskSpec object.
 * @param {import("../../api/transportContract").TaskTransport} transport
 */
export function useTaskFlow(transport, { manualStart = false, beforeCreate } = {}) {
  assertTaskTransport(transport);

  const [taskState, setTaskState] = useState(initialTaskState);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAnswering, setIsAnswering] = useState(false);
  const [error, setError] = useState(null);
  const [connection, setConnection] = useState({ state: "idle" });
  const [isRestoring, setIsRestoring] = useState(false);
  const commandBusyRef = useRef(false);
  const subscriptionRef = useRef(null);
  const activeTaskIdRef = useRef(null);
  const runIdRef = useRef(0);
  const mountedRef = useRef(true);

  const disposeSubscription = useCallback(() => {
    if (typeof subscriptionRef.current === "function") {
      subscriptionRef.current();
    }

    subscriptionRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      runIdRef.current += 1;
      disposeSubscription();
    };
  }, [disposeSubscription]);

  const subscribeToTask = useCallback((taskId, runId) => {
    const unsubscribe = transport.subscribe(taskId, (event) => {
      if (!mountedRef.current || runIdRef.current !== runId) {
        return;
      }

      setTaskState((currentState) => taskReducer(currentState, event));
    }, (status) => {
      if (mountedRef.current && runIdRef.current === runId) setConnection(status);
    });

    subscriptionRef.current = unsubscribe;
  }, [transport]);

  const startAndSubscribe = useCallback(async (taskId, runId) => {
    const startedSnapshot = await transport.startTask(taskId);
    const validStartedSnapshot = assertSnapshotForTask(taskId, startedSnapshot);

    if (!mountedRef.current || runIdRef.current !== runId) {
      return;
    }

    const startedState = hydrateTaskSnapshot(
      taskStateForHydration(taskId),
      validStartedSnapshot,
    );
    setTaskState((currentState) => hydrateTaskSnapshot(currentState, validStartedSnapshot));

    if (!startedState.taskId || needsInput(startedState)) {
      return;
    }

    if (["done", "partial", "failed"].includes(startedState.phase)) {
      setConnection({ state: "complete" });
      return;
    }

    subscribeToTask(taskId, runId);
  }, [subscribeToTask, transport]);

  const beginTask = useCallback(async (request) => {
    if (commandBusyRef.current) return null;
    commandBusyRef.current = true;
    const normalizedRequest = getRequestText(request);
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    disposeSubscription();
    activeTaskIdRef.current = null;
    setTaskState(initialTaskState);
    setError(null);
    setIsSubmitting(true);

    try {
      if (!normalizedRequest) {
        throw new TypeError("A non-empty request is required.");
      }

      const requestPayload = typeof request === "string"
        ? normalizedRequest
        : request;
      // Ensure the recovery/results screen is available before a mutating request.
      // Losing the network immediately after Start must not strand a lazy route.
      if (beforeCreate) await beforeCreate();
      const createdSnapshot = await transport.createTask(requestPayload);

      if (!mountedRef.current || runIdRef.current !== runId) {
        return null;
      }

      const createdState = hydrateTaskSnapshot(initialTaskState, createdSnapshot);
      if (!createdState.taskId) {
        throw new Error("The fixture did not return a task identity.");
      }

      activeTaskIdRef.current = createdState.taskId;
      setTaskState(createdState);

      if (!manualStart && !needsInput(createdState)) {
        await startAndSubscribe(createdState.taskId, runId);
      }

      return createdState.taskId;
    } catch (caughtError) {
      if (mountedRef.current && runIdRef.current === runId) {
        setError(getUserFacingError(caughtError));
      }

      return activeTaskIdRef.current;
    } finally {
      commandBusyRef.current = false;
      if (mountedRef.current && runIdRef.current === runId) {
        setIsSubmitting(false);
      }
    }
  }, [disposeSubscription, startAndSubscribe, transport, manualStart, beforeCreate]);

  const submitAnswers = useCallback(async (answers) => {
    const taskId = activeTaskIdRef.current;
    const runId = runIdRef.current;

    if (!taskId) {
      return;
    }

    const missingAnswer = taskState.missingQuestions.find(
      (question) => typeof answers?.[question.key] !== "string"
        || answers[question.key].trim().length === 0,
    );

    if (missingAnswer) {
      setError("أكمل التفاصيل المطلوبة قبل المتابعة.");
      return;
    }

    setError(null);
    setIsAnswering(true);

    try {
      const answeredSnapshot = await transport.submitAnswers(taskId, answers);

      if (!mountedRef.current || runIdRef.current !== runId) {
        return;
      }

      setTaskState((currentState) => hydrateTaskSnapshot(currentState, answeredSnapshot));
      if (answeredSnapshot.phase === "needs_input" && answeredSnapshot.missingQuestions.some((question) => !answeredSnapshot.answers?.[question.key])) return;
      if (manualStart) {
        return;
      }
      const startedSnapshot = await transport.startTask(taskId);
      const validStartedSnapshot = assertSnapshotForTask(taskId, startedSnapshot);

      if (!mountedRef.current || runIdRef.current !== runId) {
        return;
      }

      const startedState = hydrateTaskSnapshot(taskStateForHydration(taskId), validStartedSnapshot);
      setTaskState((currentState) => hydrateTaskSnapshot(currentState, validStartedSnapshot));

      if (!startedState.taskId || needsInput(startedState)) {
        return;
      }

      if (["done", "partial", "failed"].includes(startedState.phase)) {
        setConnection({ state: "complete" });
        return;
      }

      if (!subscriptionRef.current) {
        subscribeToTask(taskId, runId);
      }
    } catch (caughtError) {
      if (mountedRef.current && runIdRef.current === runId) {
        setError(getUserFacingError(caughtError));
      }
    } finally {
      if (mountedRef.current && runIdRef.current === runId) {
        setIsAnswering(false);
      }
    }
  }, [subscribeToTask, taskState.missingQuestions, transport, manualStart]);

  const confirmStart = useCallback(async () => {
    const taskId = activeTaskIdRef.current;
    const runId = runIdRef.current;
    if (!taskId || isSubmitting || commandBusyRef.current) return false;
    commandBusyRef.current = true;
    setError(null);
    setIsSubmitting(true);
    try {
      await startAndSubscribe(taskId, runId);
      return mountedRef.current && runIdRef.current === runId;
    } catch (caughtError) {
      if (mountedRef.current && runIdRef.current === runId) setError(getUserFacingError(caughtError));
      return false;
    } finally {
      commandBusyRef.current = false;
      if (mountedRef.current && runIdRef.current === runId) setIsSubmitting(false);
    }
  }, [isSubmitting, startAndSubscribe]);

  const resumeTask = useCallback(async (taskId) => {
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    disposeSubscription();
    setIsRestoring(true);
    setError(null);
    if (activeTaskIdRef.current !== taskId) {
      activeTaskIdRef.current = null;
      setTaskState(initialTaskState);
    }
    setConnection({ state: "connecting" });
    try {
      const snapshot = assertSnapshotForTask(taskId, await transport.getTask(taskId));
      if (!mountedRef.current || runId !== runIdRef.current) return;
      activeTaskIdRef.current = taskId;
      setTaskState(hydrateTaskSnapshot(initialTaskState, snapshot));
      if (["done", "partial", "failed"].includes(snapshot.phase)) setConnection({ state: "complete" });
      else if (!["idle", "needs_input"].includes(snapshot.phase)) subscribeToTask(taskId, runId);
      else setConnection({ state: "idle" });
    } catch (caughtError) {
      if (mountedRef.current && runId === runIdRef.current) {
        setError(getUserFacingError(caughtError));
        setConnection({ state: "disconnected" });
      }
    } finally {
      if (mountedRef.current && runId === runIdRef.current) setIsRestoring(false);
    }
  }, [disposeSubscription, subscribeToTask, transport]);

  const reset = useCallback(() => {
    runIdRef.current += 1;
    disposeSubscription();
    activeTaskIdRef.current = null;
    setTaskState(initialTaskState);
    setError(null);
    setIsSubmitting(false);
    setIsAnswering(false);
    setConnection({ state: "idle" });
    setIsRestoring(false);
  }, [disposeSubscription]);

  return {
    taskState,
    isSubmitting,
    isAnswering,
    error,
    connection,
    isRestoring,
    resumeTask,
    transportMode: transport.mode ?? "mock",
    beginTask,
    submitAnswers,
    confirmStart,
    reset,
  };
}

function taskStateForHydration(taskId) {
  return {
    ...initialTaskState,
    taskId,
  };
}
