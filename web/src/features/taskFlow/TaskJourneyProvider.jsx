import { useMemo, useState } from "react";
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

function TaskJourneySession({ scenarioKey, onScenarioChange, children, compareDraft, setCompareDraft, quickDraft, setQuickDraft }) {
  const transport = useMemo(
    () => createMockTransport(FIXTURE_SCENARIOS[scenarioKey] ?? foundationScenario),
    [scenarioKey],
  );
  const demoFlow = useTaskFlow(transport);
  const productTransport = useMemo(() => createMockTransport(), []);
  const productFlow = useTaskFlow(productTransport);
  const [compareSource, setCompareSource] = useState("product");
  const flow = compareSource === "demo" ? demoFlow : productFlow;
  const [activeProductMode, setActiveProductMode] = useState("compare");
  const quickCall = useQuickCall(() => setActiveProductMode("quick"), { formDraft: quickDraft, onFormDraftChange: setQuickDraft });
  const [productMode, setProductMode] = useState("compare");

  function withSource(source, sourceFlow) {
    return { ...sourceFlow, beginTask: async (request) => {
      const id = await sourceFlow.beginTask(request);
      if (id) { setActiveProductMode("compare"); setCompareSource(source); }
      return id;
    } };
  }
  const value = {
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
