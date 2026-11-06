import { FollowUpQuestions } from "./FollowUpQuestions";
import { ShopCard } from "./ShopCard";
import { TaskRequestForm } from "./TaskRequestForm";
import { ComparisonSummary } from "../comparison/ComparisonSummary";
import { DataProvenanceNotice } from "../../components/ui/DataProvenanceNotice";
import { Icon } from "../../components/ui/Icon";
import { createCompareDraft } from "./requestDraft";

const PHASE_MESSAGES = {
  idle: "اكتب طلب الصيانة عشان نبدأ.",
  needs_input: "نحتاج تفاصيل إضافية قبل بدء الاتصال.",
  discovering: "نبحث عن محلات قريبة مناسبة لطلبك.",
  calling: "بدأنا الاتصال بالمحلات، وستظهر حالتها هنا.",
  extracting: "نستخرج تفاصيل العروض من المكالمات.",
  comparing: "نقارن الإجابات بين المحلات.",
  done: "اكتملت النتائج.",
  partial: "اكتملت النتائج جزئياً.",
  failed: "تعذر إكمال الطلب.",
};

const PHASE_LEADS = {
  needs_input: "أكمل التفاصيل المطلوبة قبل أن نبدأ الاتصال بالمحلات.",
  discovering: "نجهز قائمة المحلات المناسبة لطلبك.",
  calling: "نجري حالياً الاتصالات مع محلات الصيانة في حيك.",
  extracting: "نراجع تفاصيل العروض التي وصلت من المكالمات.",
  comparing: "نقارن الإجابات التي وصلت من المحلات.",
  done: "اكتملت النتائج، ويمكنك مراجعة العروض الموثقة.",
  partial: "اكتملت النتائج جزئياً؛ بعض المحلات لم تقدم عرضاً قابلاً للمقارنة.",
  failed: "تعذر إكمال بعض أجزاء الطلب؛ نعرض فقط الحالات التي وصلت.",
};

function getPhaseMessage(phase, shops) {
  const total = shops.length;
  const finished = shops.filter((shop) => shop.status === "ready" || shop.status === "failed").length;

  if (phase === "discovering" && total === 0) {
    return "نبحث عن محلات قريبة مناسبة لطلبك.";
  }

  if ((phase === "calling" || phase === "extracting") && total > 0 && finished > 0) {
    return `تمت معالجة ${finished} من ${total} محلات، والبقية قيد المتابعة.`;
  }

  if ((phase === "done" || phase === "partial") && total > 0) {
    return `${PHASE_MESSAGES[phase]} تمت معالجة ${finished} من ${total} محلات.`;
  }

  return PHASE_MESSAGES[phase] ?? PHASE_MESSAGES.discovering;
}

function getPhaseLead(phase) {
  return PHASE_LEADS[phase] ?? PHASE_LEADS.discovering;
}

function getEmptyShopMessage(phase) {
  if (phase === "needs_input") {
    return "ستظهر المحلات بعد إكمال التفاصيل المطلوبة.";
  }

  if (phase === "done" || phase === "partial") {
    return "لم يصل عرض موثق من أي محل في هذه المهمة.";
  }

  if (phase === "failed") {
    return "تعذر الوصول إلى محلات في هذه المهمة، لذلك لا نعرض نتائج افتراضية.";
  }

  return "نجهز قائمة المحلات المناسبة لطلبك…";
}

function TaskOutcome({ phase, comparisonStatus }) {
  if (comparisonStatus === "cannot_compare") {
    return (
      <p className="task-outcome task-outcome--warning">
        اكتملت النتائج، لكن ما نقدر نقارن العروض بشكل عادل.
      </p>
    );
  }

  if (phase === "partial") {
    return <p className="task-outcome task-outcome--warning">اكتملت النتائج جزئياً.</p>;
  }

  if (phase === "done") {
    return <p className="task-outcome task-outcome--success">اكتملت النتائج.</p>;
  }

  if (phase === "failed") {
    return <p className="task-outcome task-outcome--danger">تعذر إكمال الطلب.</p>;
  }

  return null;
}

function getActiveStep(phase, shops) {
  if (phase === "idle" || phase === "needs_input") {
    return 0;
  }

  if (["discovering", "calling", "extracting"].includes(phase)) {
    return 1;
  }

  if (["comparing", "done", "partial"].includes(phase)) {
    return 2;
  }

  return shops.length > 0 ? 1 : 0;
}

const TASK_STEPS = [
  "استلام الطلب",
  "الاتصال بالمحلات",
  "مقارنة العروض",
];

/**
 * Composes the PR 2 fixture journey from request entry through live shop states.
 * @param {{ flow: Object, showActiveTask?: boolean, showFixturePicker?: boolean, scenarioKey?: string, onScenarioChange?: (scenarioKey: string) => void, onTaskCreated?: (taskId: string) => void, entryCopy?: Object }} props
 */
export function TaskFlowView({
  flow,
  showActiveTask = true,
  showFixturePicker = false,
  scenarioKey,
  onScenarioChange,
  onTaskCreated,
  entryCopy,
  draft,
  onDraftChange,
}) {
  const {
    taskState,
    isSubmitting,
    isAnswering,
    error,
    beginTask,
    submitAnswers,
    reset,
  } = flow;

  const requestSubmitHandler = onTaskCreated
    ? async (request) => {
      const taskId = await beginTask(request);

      if (taskId) {
        onTaskCreated(taskId);
      }
    }
    : beginTask;

  if (!taskState.taskId || !showActiveTask) {
    return (
      <TaskRequestForm
        onSubmit={requestSubmitHandler}
        isSubmitting={isSubmitting}
        error={error}
        showFixturePicker={showFixturePicker}
        scenarioKey={scenarioKey}
        onScenarioChange={onScenarioChange}
        entryCopy={entryCopy}
        draft={draft}
        onDraftChange={onDraftChange}
      />
    );
  }

  const shops = Object.values(taskState.shops);
  const activeStep = getActiveStep(taskState.phase, shops);
  const shopCountLabel = shops.length > 0
    ? `${shops.length} محلات مكتشفة`
    : "بانتظار اكتشاف المحلات";

  return (
    <section
      className="task-flow"
      aria-labelledby="task-title"
      aria-busy={isSubmitting || isAnswering}
    >
      {showFixturePicker || entryCopy?.notice ? (
        <DataProvenanceNotice
          compact
          title="بيانات محاكاة فقط"
          description={entryCopy?.notice ?? "هذه الرحلة تستخدم بيانات محاكاة إلى أن تتوفر واجهة الإنتاج."}
          source="سيناريوهات محلية قابلة للتكرار"
        />
      ) : null}
      <header className="task-flow__header">
        <div>
          <p className="eyebrow">متابعة الطلب · اتصال مباشر</p>
          <h1 id="task-title" aria-label="نتابع طلبك">تتبع طلبك</h1>
          <p className="task-flow__lead">{getPhaseLead(taskState.phase)}</p>
        </div>
        <div className="task-flow__header-meta" aria-label="عدد المحلات">
          <span className="task-flow__header-icon"><Icon name="shop" /></span>
          <span><small>محلات قريبة</small><strong>{shopCountLabel}</strong></span>
        </div>
      </header>
      <div className="task-context">
        <p className="task-request">
          <span>طلبك</span>
          <bdi>{taskState.requestText}</bdi>
        </p>
        <p className="task-progress" role="status" aria-live="polite" aria-atomic="true">
          {getPhaseMessage(taskState.phase, shops)}
        </p>
      </div>
      {error || taskState.error ? (
        <p className="field-error" role="alert">{error ?? taskState.error}</p>
      ) : null}

      <ol id="how-it-works" className="task-flow__steps" aria-label="تقدم الطلب">
        {TASK_STEPS.map((label, index) => {
          const state = index < activeStep ? "complete" : index === activeStep ? "current" : "upcoming";

          return (
            <li
              className={`task-flow__steps-item task-flow__steps-item--${state}`}
              data-state={state}
              aria-current={state === "current" ? "step" : undefined}
              key={label}
            >
              <span>{index + 1}</span><strong>{label}</strong>
            </li>
          );
        })}
      </ol>

      {taskState.phase === "needs_input" ? (
        <FollowUpQuestions
          key={taskState.missingQuestions.map((question) => question.key).join("|")}
          questions={taskState.missingQuestions}
          onSubmit={submitAnswers}
          isSubmitting={isAnswering}
        />
      ) : null}

      <section className="shops-section" aria-labelledby="shops-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">المحلات القريبة</p>
            <h2 id="shops-title">حالة الاتصال</h2>
          </div>
          <span>{shopCountLabel}</span>
        </div>
        {shops.length > 0 ? (
          <div className="shop-grid shop-grid--status-list">
            {shops.map((shop) => <ShopCard key={shop.placeId} shop={shop} />)}
          </div>
        ) : (
          <p className="empty-state">{getEmptyShopMessage(taskState.phase)}</p>
        )}
      </section>

      <ComparisonSummary comparison={taskState.comparison} shops={taskState.shops} />

      <TaskOutcome
        phase={taskState.phase}
        comparisonStatus={taskState.comparison?.status}
      />
      <button type="button" className="secondary-button" onClick={() => { reset(); onDraftChange?.(createCompareDraft()); }}>
        ابدأ طلباً جديداً
      </button>
    </section>
  );
}
