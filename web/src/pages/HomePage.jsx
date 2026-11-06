import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createMockTransport } from "../api/mockTransport";
import { TaskFlowView } from "../features/taskFlow/TaskFlowView";
import { useTaskJourney } from "../features/taskFlow/TaskJourneyContext";
import { useTaskFlow } from "../features/taskFlow/useTaskFlow";
import { cannotCompareScenario } from "../mocks/scenarios/cannotCompareScenario";
import { foundationScenario } from "../mocks/scenarios/foundationScenario";
import { missingInputScenario } from "../mocks/scenarios/missingInputScenario";
import { stockCheckScenario } from "../mocks/scenarios/stockCheckScenario";
import { QuickCallView } from "../features/quickCall/QuickCallView";

const FIXTURE_SCENARIOS = {
  foundation: foundationScenario,
  "needs-input": missingInputScenario,
  "cannot-compare": cannotCompareScenario,
  "stock-check": stockCheckScenario,
};

const ENTRY_COPY = {
  product: {
    eyebrow: "اطلبها ونحن نسأل",
    title: "قارن عروض صيانة جوالك",
    lead: "اكتب وش تحتاج تصلّح، ونقارن لك عروضاً موثوقة من محلات قريبة.",
    notice: "هذه الرحلة تستخدم بيانات محاكاة إلى أن تتوفر واجهة الإنتاج.",
  },
  demo: {
    eyebrow: "وضع العرض التجريبي",
    title: "العرض التجريبي",
    lead: "شغّل رحلة كاملة ببيانات محاكاة، بدون اتصال بالمحلات أو بيانات إنتاجية.",
    notice: "هذه الرحلة لا تمثل أداء النظام في الإنتاج.",
  },
};

/**
 * The home route owns fixture selection while the task-flow feature owns the journey UI.
 * @param {{ transport?: import("../api/transportContract").TaskTransport, mode?: "product" | "demo" }} props
 */
export function HomePage({ transport, mode = "product" }) {
  const journey = useTaskJourney();

  if (transport) {
    return <LocalHomePage transport={transport} mode={mode} />;
  }

  if (journey) {
    return <JourneyHomePage journey={journey} mode={mode} />;
  }

  return <StandaloneHomePage mode={mode} />;
}

function JourneyHomePage({ journey, mode }) {
  const navigate = useNavigate();

  return (<>
    {mode === "product" && <div className="product-mode" role="group" aria-label="نوع الخدمة">
      <button type="button" aria-pressed={journey.productMode === "compare"} onClick={() => journey.setProductMode("compare")}><strong>قارن لي</strong><span>عروض من محلات قريبة</span></button>
      <button type="button" aria-pressed={journey.productMode === "quick"} onClick={() => journey.setProductMode("quick")}><strong>اسأل عني</strong><span>إجابة من محل تختاره</span></button>
    </div>}
    {mode === "product" && journey.productMode === "quick" ? <QuickCallView quick={journey.quickCall} /> :
    <TaskFlowView
      flow={mode === "demo" ? journey.demoFlow : journey.productFlow}
      draft={journey.compareDraft}
      onDraftChange={journey.setCompareDraft}
      showActiveTask={mode === "demo"}
      showFixturePicker={mode === "demo"}
      scenarioKey={journey.scenarioKey}
      onScenarioChange={journey.onScenarioChange}
      onTaskCreated={mode === "product" ? () => navigate("/tracking") : undefined}
      entryCopy={ENTRY_COPY[mode] ?? ENTRY_COPY.product}
    />
    }
  </>);
}

function LocalHomePage({ transport, mode }) {
  const flow = useTaskFlow(transport);

  return (
    <TaskFlowView
      flow={flow}
      showFixturePicker={false}
      entryCopy={ENTRY_COPY[mode] ?? ENTRY_COPY.product}
    />
  );
}

function StandaloneHomePage({ mode }) {
  const [scenarioKey, setScenarioKey] = useState("foundation");
  const activeTransport = useMemo(
    () => createMockTransport(FIXTURE_SCENARIOS[scenarioKey] ?? foundationScenario),
    [scenarioKey],
  );
  const flow = useTaskFlow(activeTransport);

  return (
    <TaskFlowView
      flow={flow}
      showFixturePicker={mode === "demo"}
      scenarioKey={scenarioKey}
      onScenarioChange={setScenarioKey}
      entryCopy={ENTRY_COPY[mode] ?? ENTRY_COPY.product}
    />
  );
}
