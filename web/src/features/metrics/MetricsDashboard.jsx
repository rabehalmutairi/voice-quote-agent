import { DataProvenanceNotice } from "../../components/ui/DataProvenanceNotice";
import { metricsFixture } from "../../mocks/metricsFixture";
import { useId } from "react";

const HEADLINE_METRIC_KEYS = [
  "reachRate",
  "medianCallLatency",
  "taskCompletion",
  "criticalFieldAccuracy",
  "unsupportedValueRate",
  "costPerSuccessfulTaskUsd",
];

const LATENCY_OUTCOME_LABELS = {
  no_answer: "لم يرد",
  human_partial: "جزئية",
  other: "نتيجة أخرى",
};

function formatNumber(value, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("ar-SA", { maximumFractionDigits }).format(value);
}

function normalizedRatio(value) {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
}

function formatPercent(value) {
  return `${formatNumber(normalizedRatio(value) * 100, 1)}٪`;
}

function formatSeconds(value) {
  return `${formatNumber(value)} ثانية`;
}

function formatUsd(value) {
  return `$${value.toFixed(2)}`;
}

function formatLatencyOutcome(outcome) {
  return Object.hasOwn(LATENCY_OUTCOME_LABELS, outcome)
    ? LATENCY_OUTCOME_LABELS[outcome]
    : "مكتملة";
}

function fieldAccuracy(item) {
  return item.labelled === 0 ? 0 : item.correct / item.labelled;
}

function MetricBar({ value, label }) {
  const percentage = Math.min(Math.max(value * 100, 0), 100);

  return (
    <span className="metric-bar" role="img" aria-label={label}>
      <span className="metric-bar__fill" style={{ "--metric-width": `${percentage}%` }} />
    </span>
  );
}

function HeadlineMetric({ label, value, supporting, tone = "neutral", barValue, barLabel }) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <h3 className="metric-card__label">{label}</h3>
      <p className="metric-card__value">{value}</p>
      {barValue !== undefined ? <MetricBar value={barValue} label={barLabel} /> : null}
      <p className="metric-card__supporting">{supporting}</p>
    </article>
  );
}

function AccuracyTable({ items, sourceLabel }) {
  return (
    <div className="metrics-table-wrapper">
      <table className="metrics-table" aria-label={`دقة الحقول الحرجة في ${sourceLabel}`}>
        <caption>دقة الحقول الحرجة في {sourceLabel}</caption>
        <thead>
          <tr>
            <th scope="col" data-label="الحقل">الحقل</th>
            <th scope="col" data-label="الصحيح / الموسوم">الصحيح / الموسوم</th>
            <th scope="col" data-label="الدقة">الدقة</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const accuracy = fieldAccuracy(item);
            return (
              <tr key={item.key}>
                <th scope="row" data-label="الحقل">{item.label}</th>
                <td data-label="الصحيح / الموسوم">{formatNumber(item.correct)} / {formatNumber(item.labelled)}</td>
                <td data-label="الدقة">
                  <div className="metrics-table__value">
                    <span>{formatPercent(accuracy)}</span>
                    <MetricBar value={accuracy} label={`دقة ${item.label} ${formatPercent(accuracy)}`} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LatencyTable({ items, sourceLabel }) {
  return (
    <div className="metrics-table-wrapper">
      <table className="metrics-table" aria-label={`زمن كل مكالمة ${sourceLabel}`}>
        <caption>زمن كل مكالمة {sourceLabel}</caption>
        <thead>
          <tr>
            <th scope="col" data-label="المكالمة">المكالمة</th>
            <th scope="col" data-label="النتيجة">النتيجة</th>
            <th scope="col" data-label="الزمن">الزمن</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.callId}>
              <th scope="row" data-label="المكالمة">{item.label}</th>
              <td data-label="النتيجة">
                {formatLatencyOutcome(item.outcome)}
              </td>
              <td data-label="الزمن" className="tabular-nums">{formatSeconds(item.seconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OutcomeBreakdown({ outcomes, sourceLabel }) {
  const total = outcomes.reduce((sum, outcome) => sum + outcome.count, 0);

  return (
    <ul className="outcome-list" aria-label={`نتائج محاولات ${sourceLabel}`}>
      {outcomes.map((outcome) => {
        const share = total === 0 ? 0 : outcome.count / total;
        return (
          <li className="outcome-list__item" key={outcome.key}>
            <div className="outcome-list__label">
              <span>{outcome.label}</span>
              <bdi>{formatNumber(outcome.count)} من {formatNumber(total)}</bdi>
            </div>
            <MetricBar value={share} label={`${outcome.label}: ${formatPercent(share)}`} />
          </li>
        );
      })}
    </ul>
  );
}

function MetricsState({ title, description, role = "status" }) {
  const stateId = useId().replaceAll(":", "");

  return (
    <section
      className="empty-state metrics-state"
      role={role}
      aria-live="polite"
      aria-labelledby={`${stateId}-title`}
      aria-describedby={`${stateId}-description`}
    >
      <h1 id={`${stateId}-title`}>{title}</h1>
      <p id={`${stateId}-description`}>{description}</p>
    </section>
  );
}

function hasMetricObservations(metrics) {
  return metrics.callLatency.length > 0
    || metrics.fieldAccuracy.some((item) => item.labelled > 0)
    || metrics.outcomes.some((outcome) => outcome.count > 0);
}

function hasValidHeadlineMetrics(headline) {
  return HEADLINE_METRIC_KEYS.every((key) => Number.isFinite(headline?.[key]?.value));
}

function hasDashboardShape(metrics) {
  if (!metrics?.provenance || !metrics.headline) {
    return false;
  }

  if (!Array.isArray(metrics.fieldAccuracy)
    || !Array.isArray(metrics.outcomes)
    || !Array.isArray(metrics.callLatency)) {
    return false;
  }

  const { headline } = metrics;

  return hasValidHeadlineMetrics(headline)
    && Number.isFinite(headline.medianCallLatency.sampleSize)
    && metrics.fieldAccuracy.every((item) => (
      Number.isFinite(item?.correct)
      && Number.isFinite(item?.labelled)
    ))
    && metrics.outcomes.every((outcome) => Number.isFinite(outcome?.count))
    && metrics.callLatency.every((item) => Number.isFinite(item?.seconds));
}

function MetricsProvenance({ metrics }) {
  const provenance = metrics.provenance ?? {};
  const isSimulated = metrics.dataMode === "simulated";

  if (isSimulated) {
    return (
      <DataProvenanceNotice
        title={provenance.label}
        description={provenance.notice}
        source={provenance.source}
        coverage={provenance.coverage}
        className="metrics-provenance"
      />
    );
  }

  const title = provenance.label || "مصدر البيانات غير محدد";
  const description = provenance.notice || "لا يمكن التحقق من مصدر هذه البيانات بعد.";
  const titleId = "metrics-provenance-title";

  return (
    <aside className="data-provenance metrics-provenance" role="note" aria-labelledby={titleId}>
      <div className="data-provenance__heading">
        <strong id={titleId}>{title}</strong>
      </div>
      <p className="data-provenance__description">{description}</p>
      {provenance.source ? <p className="data-provenance__meta">المصدر: {provenance.source}</p> : null}
      {provenance.coverage ? <p className="data-provenance__meta">النطاق: {provenance.coverage}</p> : null}
    </aside>
  );
}

/**
 * Presents internal evaluation-shaped metrics while keeping fixture provenance visible.
 * @param {{ metrics?: Object, status?: "ready" | "loading" | "error", error?: string }} props
 */
export function MetricsDashboard({ metrics = metricsFixture, status = "ready", error }) {
  if (status === "loading") {
    return (
      <MetricsState
        title="جارٍ تحميل المقاييس"
        description="لم تصل بيانات المقاييس بعد. لن نعرض أرقاماً مؤقتة على أنها نتائج."
      />
    );
  }

  if (status === "error") {
    return (
      <MetricsState
        title="تعذر تحميل المقاييس"
        description={error || "لم نتمكن من قراءة مصدر المقاييس. حاول مرة أخرى لاحقاً."}
        role="alert"
      />
    );
  }

  if (!metrics) {
    return (
      <MetricsState
        title="لا توجد مقاييس متاحة"
        description="لم تصل بيانات قابلة للعرض بعد، لذلك لن نعرض أرقاماً أو مؤشرات مفترضة."
      />
    );
  }

  if (!hasDashboardShape(metrics)) {
    return (
      <MetricsState
        title="تعذر قراءة المقاييس"
        description="مصدر المقاييس غير مكتمل، لذلك لن نعرض لوحة قد توحي بنتائج غير مؤكدة."
        role="alert"
      />
    );
  }

  if (!hasMetricObservations(metrics)) {
    return (
      <MetricsState
        title="لا توجد مقاييس متاحة"
        description="لم تتوفر ملاحظات كافية لبناء هذه اللوحة. لن نعرض أصفاراً على أنها بيانات فعلية."
      />
    );
  }

  const isSimulated = metrics.dataMode === "simulated";
  const headline = metrics.headline;
  const sourceLabel = isSimulated ? "المحاكاة" : "المصدر غير الموثق";
  const sourceDescription = isSimulated
    ? "مقاييس محاكاة للتأكد من تجربة العرض فقط."
    : "هذا المصدر غير موثق؛ لا تستخدم الأرقام للحكم على الأداء الحقيقي.";

  return (
    <div className="metrics-dashboard">
      <header className="metrics-page__header">
        <div>
          <p className="eyebrow">رؤية داخلية · PR 5</p>
          <h1>لوحة المقاييس الداخلية</h1>
          <p className="metrics-page__lead">
            نعرض هنا شكل مؤشرات التقييم التي ستتصل لاحقاً ببيانات R3 وR5.
          </p>
        </div>
        <div className="metrics-page__header-actions">
          <span className="date-range-meta">آخر ٧ أيام <span aria-hidden="true">▣</span></span>
          <span className={`metrics-mode metrics-mode--${isSimulated ? "simulated" : "unknown"}`}>
            {isSimulated ? "بيانات محاكاة فقط" : "مصدر البيانات غير محدد"}
          </span>
        </div>
      </header>

      <MetricsProvenance metrics={metrics} />

      <section className="metrics-section" aria-labelledby="headline-metrics-title">
        <div className="metrics-section__heading">
          <div>
            <p className="eyebrow">ملخص سريع</p>
            <h2 id="headline-metrics-title">مؤشرات أساسية</h2>
          </div>
          <p>{sourceDescription}</p>
        </div>
        <div className="metric-card-grid">
          <HeadlineMetric
            label="الوصول إلى شخص"
            value={formatPercent(headline.reachRate.value)}
            supporting={headline.reachRate.supporting}
            tone="positive"
            barValue={headline.reachRate.value}
            barLabel={`الوصول إلى شخص ${formatPercent(headline.reachRate.value)}`}
          />
          <HeadlineMetric
            label="زمن المكالمة الوسيط"
            value={formatSeconds(headline.medianCallLatency.value)}
            supporting={headline.medianCallLatency.supporting}
          />
          <HeadlineMetric
            label="إكمال المهمة بعد الوصول لشخص"
            value={formatPercent(headline.taskCompletion.value)}
            supporting={headline.taskCompletion.supporting}
            tone="positive"
            barValue={headline.taskCompletion.value}
            barLabel={`إكمال المهمة ${formatPercent(headline.taskCompletion.value)}`}
          />
        </div>
      </section>

      <div className="metrics-panel-grid">
        <section className="metrics-panel" aria-labelledby="accuracy-title">
          <div className="metrics-panel__heading">
            <div>
              <p className="eyebrow">جودة الاستخراج</p>
              <h2 id="accuracy-title">الدقة حسب الحقل</h2>
            </div>
            <p>{isSimulated ? "المقام هو القيم الموسومة في هذه العينة المحاكاة." : "المقام هو القيم الموسومة في هذا المصدر غير الموثق."}</p>
          </div>
          <AccuracyTable items={metrics.fieldAccuracy} sourceLabel={isSimulated ? "بيانات المحاكاة" : "المصدر غير الموثق"} />
        </section>

        <section className="metrics-panel metrics-panel--outcome" aria-labelledby="outcome-title">
          <div className="metrics-panel__heading">
            <div>
              <p className="eyebrow">توزيع النتائج</p>
              <h2 id="outcome-title">نتائج محاولات المحاكاة</h2>
            </div>
            <p>{sourceDescription}</p>
          </div>
          <OutcomeBreakdown outcomes={metrics.outcomes} sourceLabel={sourceLabel} />
        </section>
      </div>

      <section className="metrics-panel metrics-panel--secondary" aria-labelledby="latency-title">
        <div className="metrics-panel__heading">
          <div>
            <p className="eyebrow">الزمن</p>
            <h2 id="latency-title">زمن المكالمات</h2>
          </div>
          <p>
            الوسيط محسوب من {formatNumber(headline.medianCallLatency.sampleSize)} {isSimulated ? "مكالمة محاكاة" : "مكالمة من مصدر غير موثق"}، وليس SLA.
          </p>
        </div>
        <LatencyTable items={metrics.callLatency} sourceLabel={isSimulated ? "محاكاة" : "من مصدر غير موثق"} />
      </section>

      <section className="metrics-section metrics-section--secondary" aria-labelledby="secondary-metrics-title">
        <div className="metrics-section__heading">
          <div>
            <p className="eyebrow">تفاصيل إضافية</p>
            <h2 id="secondary-metrics-title">جودة الاستخراج والتكلفة</h2>
          </div>
          <p>مقاييس المساندة تبقى متاحة دون منافسة مؤشرات الاتصال الأساسية.</p>
        </div>
        <div className="metric-card-grid metric-card-grid--secondary">
          <HeadlineMetric
            label="دقة الحقول الحرجة"
            value={formatPercent(headline.criticalFieldAccuracy.value)}
            supporting={headline.criticalFieldAccuracy.supporting}
            tone="positive"
            barValue={headline.criticalFieldAccuracy.value}
            barLabel={`دقة الحقول الحرجة ${formatPercent(headline.criticalFieldAccuracy.value)}`}
          />
          <HeadlineMetric
            label="معدل القيم غير المدعومة"
            value={formatPercent(headline.unsupportedValueRate.value)}
            supporting={headline.unsupportedValueRate.supporting}
            tone="caution"
            barValue={headline.unsupportedValueRate.value}
            barLabel={`القيم غير المدعومة ${formatPercent(headline.unsupportedValueRate.value)}`}
          />
          <HeadlineMetric
            label="التكلفة لكل طلب ناجح"
            value={<bdi dir="ltr">{formatUsd(headline.costPerSuccessfulTaskUsd.value)}</bdi>}
            supporting={headline.costPerSuccessfulTaskUsd.supporting}
          />
        </div>
      </section>
    </div>
  );
}
