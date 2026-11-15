import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { createApiTransport } from "../../api/apiTransport";
import { frontendConfig } from "../../api/config";
import { createMockTransport } from "../../api/mockTransport";
import { cannotCompareScenario } from "../../mocks/scenarios/cannotCompareScenario";
import { foundationScenario } from "../../mocks/scenarios/foundationScenario";
import { missingInputScenario } from "../../mocks/scenarios/missingInputScenario";
import { stockCheckScenario } from "../../mocks/scenarios/stockCheckScenario";
import { useTaskFlow } from "./useTaskFlow";
import { TaskJourneyContext } from "./TaskJourneyContext";
import { useQuickCall } from "../quickCall/useQuickCall";
import { createCompareDraft, createQuickDraft } from "./requestDraft";

const FIXTURE_SCENARIOS = {
  foundation: foundationScenario,
  "needs-input": missingInputScenario,
  "cannot-compare": cannotCompareScenario,
  "stock-check": stockCheckScenario,
};

function prepareResultScreens() { return import("../../pages/ReferencePages"); }

function TaskJourneySession({ scenarioKey, onScenarioChange, children, compareDraft, setCompareDraft, quickDraft, setQuickDraft }) {
  const transport = useMemo(
    () => createMockTransport(FIXTURE_SCENARIOS[scenarioKey] ?? foundationScenario),
    [scenarioKey],
  );
  const demoFlow = useTaskFlow(transport);
  const productTransport = useMemo(() => frontendConfig.transportMode === "api" ? createApiTransport() : createMockTransport(), []);
  const productFlow = useTaskFlow(productTransport, { beforeCreate: productTransport.mode === "api" ? prepareResultScreens : undefined });
  const [compareSource, setCompareSource] = useState("product");
  const flow = compareSource === "demo" ? demoFlow : productFlow;
  const [activeProductMode, setActiveProductMode] = useState("compare");
  const quickCall = useQuickCall(() => setActiveProductMode("quick"), { formDraft: quickDraft, onFormDraftChange: setQuickDraft });
  const [productMode, setProductMode] = useState("compare");
  const location = useLocation();
  const navigate = useNavigate();
  const restoredQueryRef = useRef(null);
  const requestedTaskId = new URLSearchParams(location.search).get("task");
  const taskRoute = ["/tracking", "/comparison"].includes(location.pathname);
  const restoreProductTask = productFlow.resumeTask;
  const productTaskId = productFlow.taskState.taskId;
  const productTransportMode = productFlow.transportMode;
  const savedRoute = taskRoute && productTransportMode === "api" ? requestedTaskId : null;
  const [selectedSavedRoute, setSelectedSavedRoute] = useState(null);
  // A saved API URL explicitly selects this journey, including Back from a demo.
  // Adjust selection during render so an unrelated result is never committed.
  if (selectedSavedRoute !== savedRoute) {
    setSelectedSavedRoute(savedRoute);
    if (savedRoute) {
      setActiveProductMode("compare");
      setCompareSource("product");
    }
  }
  useEffect(() => {
    if (!taskRoute || productTransportMode !== "api") return;
    if (!requestedTaskId && (compareSource !== "product" || activeProductMode !== "compare")) return;
    if (requestedTaskId && requestedTaskId !== productTaskId) {
      if (restoredQueryRef.current !== requestedTaskId) {
        restoredQueryRef.current = requestedTaskId;
        void restoreProductTask(requestedTaskId);
      }
    } else if (!requestedTaskId && productTaskId) {
      navigate({ pathname: location.pathname, search: `?task=${encodeURIComponent(productTaskId)}` }, { replace: true });
    }
    return () => { restoredQueryRef.current = null; };
  }, [taskRoute, requestedTaskId, productTaskId, productTransportMode, restoreProductTask, compareSource, activeProductMode, navigate, location.pathname]);

  function withSource(source, sourceFlow) {
    return { ...sourceFlow, beginTask: async (request) => {
      const id = await sourceFlow.beginTask(request);
      if (id) { setActiveProductMode("compare"); setCompareSource(source); }
      return id;
    } };
  }
  const value = {
    apiEnabled: productTransportMode === "api",
    requestedTaskId,
    ...flow,
    productFlow: withSource("product", productFlow),
    demoFlow: withSource("demo", demoFlow),
    compareDraft,
    setCompareDraft,
    activeProductMode,
    quickCall,
    productMode,
    setProductMode,
    scenarioKey,
    onScenarioChange: (nextScenario) => {
      // A fixture change resets only its demo; product/Quick Call work stays alive.
      demoFlow.reset();
      if (compareSource === "demo") setCompareSource("product");
      onScenarioChange(nextScenario);
    },
  };

  return (
    <TaskJourneyContext.Provider value={value}>
      {children}
    </TaskJourneyContext.Provider>
  );
}

/**
 * Keeps one fixture-backed task journey alive while the user moves between routes.
 * Changing the selected fixture resets only the demo and never persists task data.
 */
export function TaskJourneyProvider({ children }) {
  const [scenarioKey, setScenarioKey] = useState("foundation");
  const [compareDraft, setCompareDraft] = useState(createCompareDraft);
  const [quickDraft, setQuickDraft] = useState(createQuickDraft);

  return (
    <TaskJourneySession
      scenarioKey={scenarioKey}
      onScenarioChange={setScenarioKey}
      compareDraft={compareDraft}
      setCompareDraft={setCompareDraft}
      quickDraft={quickDraft}
      setQuickDraft={setQuickDraft}
    >
      {children}
    </TaskJourneySession>
  );
}
