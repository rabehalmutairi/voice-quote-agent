import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { DataProvenanceNotice } from "../components/ui/DataProvenanceNotice";
import { EvidenceDrawer } from "../features/evidence/EvidenceDrawer";
import {
  formatAvailability,
  formatCurrency,
  formatDays,
  formatMinutes,
  formatNumber,
  formatPartType,
  formatCondition,
  formatEvidenceValue,
} from "../features/evidence/formatEvidence";
import {
  getQuoteTranscript,
  getTranscriptTurnForEvidence,
  isEvidenceFieldTraceable,
} from "../utils/evidence";
import {
  getShopAddress,
  getShopMapsHref,
  getShopOpenNow,
  getShopPhoneHref,
} from "../features/taskFlow/shopActions";
import { useTaskJourney } from "../features/taskFlow/TaskJourneyContext";
import { QuickCallView } from "../features/quickCall/QuickCallView";
import { InquiryAnswers } from "../features/quickCall/InquiryAnswers";
import { FollowUpQuestions } from "../features/taskFlow/FollowUpQuestions";
import { TaskTabs, JourneyProgress } from "../features/taskFlow/JourneyNavigation";
import { TaskConnectionNotice } from "../features/taskFlow/TaskConnectionNotice";
import { CopyTaskSummary } from "../features/taskFlow/CopyTaskSummary";
import { Icon } from "../components/ui/Icon";

function ReferenceIcon({ children, className = "" }) {
  const names = { "☎": "phone", "⚖": "compare", "ⓘ": "info", "▤": "shop", "▧": "info", "▦": "check", "▥": "phone", "◷": "clock", "▶": "quote" };
  return <span className={`reference-icon ${className}`} aria-hidden="true"><Icon name={names[children] ?? "shop"} /></span>;
}

function ReferenceScreen({ className, children }) {
  return <section className={`reference-screen font-arabic ${className}`} dir="rtl">{children}</section>;
}

function ReferencePageHeading({ eyebrow, title, description, icon, action }) {
  return (
    <header className="reference-page__heading">
      <div className="reference-page__heading-copy">
        <div className="reference-page__title-row">
          <h1>{title}</h1>
          {icon ? <ReferenceIcon className="reference-page__title-icon">{icon}</ReferenceIcon> : null}
        </div>
        <p className="reference-page__description">{description}</p>
        {eyebrow ? <p className="reference-page__eyebrow">{eyebrow}</p> : null}
      </div>
      {action ? <div className="reference-page__heading-action">{action}</div> : null}
    </header>
  );
}

function ReferenceIllustration() {
  return (
    <div className="reference-illustration" aria-hidden="true">
      <span className="reference-illustration__sun" />
      <span className="reference-illustration__palm reference-illustration__palm--one" />
      <span className="reference-illustration__palm reference-illustration__palm--two" />
      <div className="reference-illustration__buildings">
        <span className="reference-illustration__building reference-illustration__building--one" />
        <span className="reference-illustration__building reference-illustration__building--two" />
        <span className="reference-illustration__building reference-illustration__building--three" />
      </div>
      <div className="reference-illustration__phone">
        <span className="reference-illustration__speaker" />
        <span className="reference-illustration__phone-screen">
          <b>صيانة جوالك</b>
          <i />
          <i />
          <i />
        </span>
      </div>
      <span className="reference-illustration__sign">محلات صيانة<br />في حيك</span>
    </div>
  );
}

function ReferenceField({ id, label, icon, children }) {
  return (
    <div className="reference-field">
      <ReferenceIcon className="reference-field__icon">{icon}</ReferenceIcon>
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

const SIMULATION_NOTICE = {
  title: "تجربة محاكاة فقط",
  description: "الحالة والنتائج المعروضة هنا تأتي من سيناريو محلي قابل للتكرار، وليست اتصالات أو عروضاً حقيقية.",
  source: "النقل التجريبي المحلي",
};

const SHOP_STATUS_COPY = {
  discovered: {
    tone: "blue",
    icon: "▤",
    label: "تم العثور على المحل",
    detail: "وجدنا محلاً مناسباً في بيانات المهمة.",
  },
  calling: {
    tone: "blue",
    icon: "☎",
    label: "جاري الاتصال",
    detail: "ننتظر رد المحل الآن.",
  },
  talking: {
    tone: "amber",
    icon: "▥",
    label: "المكالمة جارية",
    detail: "نجمع تفاصيل العرض من المكالمة.",
  },
  extracting: {
    tone: "amber",
    icon: "▥",
    label: "نستخرج العرض",
    detail: "نراجع المعلومات التي ذكرها المحل.",
  },
  ready: {
    tone: "green",
    icon: "▦",
    label: "تم استلام العرض",
    detail: "وصل عرض موثق من كلام المحل.",
  },
  failed: {
    tone: "red",
    icon: "▧",
    label: "تعذر الاتصال",
    detail: "لم يصلنا عرض من هذا المحل.",
  },
};

const SHOP_FAILURE_COPY = {
  voicemail: "وصلنا إلى البريد الصوتي ولم نتمكن من أخذ عرض.",
  ivr: "تعذر تجاوز الرد الآلي للحصول على عرض.",
  no_answer: "لم يرد المحل على الاتصال.",
  busy: "كان خط المحل مشغولاً.",
  hung_up: "انتهت المكالمة قبل استلام العرض.",
  wrong_business: "لم نتمكن من تأكيد أن الرقم للمحل المطلوب.",
  failed: "تعذر الاتصال بالمحل.",
};

const FIELD_STATUS_COPY = {
  not_mentioned: "لم يذكر المحل هذه المعلومة.",
  refused: "المحل رفض إعطاء هذه المعلومة.",
  unclear: "إجابة المحل غير واضحة.",
  unverified: "لم نتمكن من التحقق من هذه المعلومة.",
};

const OFFER_FIELD_DEFINITIONS = [
  { key: "price", label: "السعر", getField: ({ option }) => option.priceSar, formatter: formatCurrency },
  { key: "partType", label: "نوع القطعة", getField: ({ option }) => option.variant ? undefined : option.partType, formatter: formatPartType },
  { key: "variant", label: "المواصفات", getField: ({ option }) => option.variant, formatter: String },
  { key: "condition", label: "حالة المنتج", getField: ({ option }) => option.condition, formatter: formatCondition },
  { key: "warranty", label: "مدة الضمان", getField: ({ option }) => option.warrantyDays, formatter: formatDays },
  { key: "turnaround", label: "وقت الإنجاز", getField: ({ shop, option }) => option.variant ? undefined : shop.quote.turnaroundMinutes, formatter: formatMinutes },
  { key: "availability", label: "التوفر", getField: ({ shop, option }) => option.availability ?? shop.quote.availability, formatter: formatAvailability },
];

function ReferenceSimulationNotice() {
  const journey = useTaskJourney();
  const notice = journey?.transportMode === "api" ? {
    title: "تجربة محاكاة فقط",
    description: "تصل حالة الطلب والنتائج من خادم التجربة. المكالمات والمحلات والبيانات محاكاة، ولا توجد اتصالات حقيقية.",
    source: "محاكاة الخادم",
  } : SIMULATION_NOTICE;
  return <DataProvenanceNotice {...notice} compact className="reference-provenance" />;
}

function getOfferFields(offer) {
  return OFFER_FIELD_DEFINITIONS.map(({ key, label, getField, formatter }) => ({
    key,
    label,
    field: getField(offer),
    formatter,
  })).filter(({ field }) => field !== undefined);
}

function getTaskProgressLabel(taskState, shops) {
  const finished = shops.filter((shop) => shop.status === "ready" || shop.status === "failed").length;

  if (taskState.phase === "needs_input") {
    return "بانتظار التفاصيل المطلوبة قبل الاتصال.";
  }

  if (shops.length === 0 && taskState.phase === "discovering") {
    return "جاري تجهيز المحلات المناسبة للطلب.";
  }

  if (taskState.phase === "failed") {
    return `تعذر إكمال الطلب بعد معالجة ${formatNumber(finished)} من ${formatNumber(shops.length)} محلات.`;
  }

  if (taskState.phase === "done" || taskState.phase === "partial") {
    return `تمت معالجة ${formatNumber(finished)} من ${formatNumber(shops.length)} محلات.`;
  }

  if (shops.length > 0) {
    return `تمت معالجة ${formatNumber(finished)} من ${formatNumber(shops.length)} محلات، والبقية قيد المتابعة.`;
  }

  return "بانتظار تحديثات المهمة.";
}

function ReferenceUnavailablePage({ title = "لا يوجد طلب متاح", description }) {
  const journey = useTaskJourney();
  return (
    <ReferenceScreen className="reference-screen--tracking">
      <ReferencePageHeading
        title={title}
        description={journey?.isRestoring ? "نستعيد طلبك وتحديثاته…" : journey?.error ?? description ?? "ابدأ طلباً جديداً لعرض حالة الاتصالات والنتائج المرتبطة به."}
        icon="ⓘ"
        action={<Link className="reference-primary-button tw-primary-action tw-focus-ring" to="/request">ابدأ طلباً جديداً</Link>}
      />
      <ReferenceSimulationNotice />
      <TaskConnectionNotice flow={journey} />
      <div className="reference-empty-state" role="status">
        <strong>هذه الصفحة لا تعرض بيانات افتراضية.</strong>
        <p>لن نعرض محلات أو عروضاً ما لم توجد مهمة نشطة في هذه الجلسة.</p>
      </div>
    </ReferenceScreen>
  );
}

const PROOF_POINTS = [
  { icon: "⌕", title: "مكالمات مباشرة", detail: "نتحدث مع المحل" },
  { icon: "▣", title: "عروض موثوقة", detail: "من المحادثة كاملة" },
  { icon: "◷", title: "توفير وقتك", detail: "وكل الخيارات أمامك" },
];

export function ReferenceLandingPage() {
  const navigate = useNavigate();
  const [request, setRequest] = useState("");

  function handleSubmit(event) {
    event.preventDefault();
    navigate("/tracking", { state: { request: request.trim() } });
  }

  return (
    <ReferenceScreen className="reference-screen--landing">
      <div className="reference-landing__hero">
        <div className="reference-landing__copy">
          <h1 id="reference-landing-title">قارن عروض<br />صيانة جوالك</h1>
          <p>نحن نتصل بالمحلات في حيك ونحصل لك على العروض الحقيقية مع تفاصيل واضحة.</p>
        </div>
        <ReferenceIllustration />
      </div>

      <ul className="reference-proof-list" aria-label="مزايا الخدمة">
        {PROOF_POINTS.map((point) => (
          <li key={point.title}>
            <ReferenceIcon>{point.icon}</ReferenceIcon>
            <span><strong>{point.title}</strong><small>{point.detail}</small></span>
          </li>
        ))}
      </ul>

      <ol className="reference-process" aria-label="خطوات مقارنة العروض">
        <li><span>١</span><strong>أدخل طلب الصيانة</strong><small>وصف الجهاز والمشكلة</small></li>
        <li><span>٢</span><strong>نتصل بالمحلات</strong><small>ونجمع العروض لك</small></li>
        <li><span>٣</span><strong>نقارن لك</strong><small>أوضح الخيارات</small></li>
      </ol>

      <form className="reference-landing__form" onSubmit={handleSubmit} aria-labelledby="reference-landing-title">
        <div className="reference-fields">
          <ReferenceField id="reference-device" label="نوع الجهاز" icon="▯">
            <select id="reference-device" defaultValue="آيفون">
              <option>آيفون</option>
              <option>سامسونج</option>
              <option>جهاز آخر</option>
            </select>
          </ReferenceField>
          <ReferenceField id="reference-model" label="الموديل" icon="▱">
            <input id="reference-model" placeholder="آيفون ١٣" />
          </ReferenceField>
          <ReferenceField id="reference-repair" label="نوع الصيانة" icon="⌕">
            <select id="reference-repair" defaultValue="تغيير شاشة">
              <option>تغيير شاشة</option>
              <option>تغيير بطارية</option>
              <option>إصلاح منفذ الشحن</option>
            </select>
          </ReferenceField>
          <ReferenceField id="reference-area" label="الحي / المدينة" icon="⌖">
            <input id="reference-area" defaultValue="الرياض" />
          </ReferenceField>
        </div>
        <button className="reference-primary-button tw-primary-action tw-focus-ring" type="submit">
          <span aria-hidden="true">⌕</span>
          ابدأ البحث عن العروض
        </button>
        <p className="reference-landing__trust">سيتم الاتصال بالمحلات في حيك وجمع جميع العروض خلال دقائق</p>
        <label className="reference-landing__fallback-label" htmlFor="reference-request">وش تبي تصلّح؟</label>
        <textarea
          className="reference-landing__fallback"
          id="reference-request"
          aria-label="وش تبي تصلّح؟"
          rows="1"
          value={request}
          onChange={(event) => setRequest(event.target.value)}
          placeholder="مثال: تغيير شاشة آيفون ١٣"
        />
      </form>
    </ReferenceScreen>
  );
}

function ReferenceStatusCard({ shop }) {
  const copy = shop.status === "calling" && shop.attempt === 2
    ? { ...SHOP_STATUS_COPY.calling, label: "نعيد الاتصال", detail: "المحاولة الثانية مع المحل نفسه." }
    : SHOP_STATUS_COPY[shop.status] ?? SHOP_STATUS_COPY.discovered;
  const failureDetail = shop.status === "failed"
    ? SHOP_FAILURE_COPY[shop.outcome] ?? SHOP_FAILURE_COPY.failed
    : copy.detail;
  const address = getShopAddress(shop);
  const phoneHref = shop.simulated === false ? getShopPhoneHref(shop) : null;
  const mapsHref = getShopMapsHref(shop);
  const openNow = getShopOpenNow(shop);

  return (
    <article className={`reference-status-card reference-status-card--${copy.tone}`}>
      <div className="reference-status-card__heading">
        <ReferenceIcon>{copy.icon}</ReferenceIcon>
        <div>
          <h2>{shop.name}</h2>
          {address ? <p className="reference-status-card__address">{address}</p> : null}
        </div>
      </div>
      <p className="reference-status-card__status"><span aria-hidden="true" />{copy.label}</p>
      <p className="reference-status-card__detail">{failureDetail}</p>
      {openNow !== null ? (
        <p className="reference-status-card__address">{openNow ? "مفتوح الآن" : "مغلق الآن"}</p>
      ) : null}
      {phoneHref ? (
        <a
          className="reference-card-action"
          href={phoneHref}
          aria-label={`اتصل بـ ${shop.name}`}
        >
          اتصال بالمحل
        </a>
      ) : null}
      {mapsHref ? (
        <a
          className="reference-card-action"
          href={mapsHref}
          target="_blank"
          rel="noreferrer"
          aria-label={`عرض موقع ${shop.name} على خرائط Google`}
        >
          فتح الموقع على الخريطة
        </a>
      ) : null}
      {shop.status === "ready" ? (
        <Link className="reference-card-action" to="/comparison">عرض العرض الموثق</Link>
      ) : (
        <p className="reference-card-action reference-card-action--static">
          {shop.status === "failed" ? "لا يوجد عرض متاح" : "بانتظار تحديث المهمة"}
        </p>
      )}
    </article>
  );
}

export function ReferenceTrackingPage() {
  const journey = useTaskJourney();
  const taskState = journey?.taskState;

  if (journey?.activeProductMode === "quick" && !(journey.apiEnabled && journey.requestedTaskId)) return <><TaskTabs /><QuickCallView quick={journey.quickCall} /></>;

  if (!taskState?.taskId || (journey.apiEnabled && journey.requestedTaskId && journey.requestedTaskId !== taskState.taskId)) {
    return <ReferenceUnavailablePage />;
  }

  const shops = Object.values(taskState.shops);

  return (
    <ReferenceScreen className="reference-screen--tracking">
      <TaskTabs />
      <JourneyProgress steps={["الطلب", "المكالمات", "النتيجة"]} current={taskState.comparison || taskState.phase === "failed" ? 2 : ["idle", "needs_input"].includes(taskState.phase) ? 0 : 1} />
      <ReferencePageHeading
        title="تتبع طلبك"
        description="تابع الاتصال بكل محل، وتفاصيله أول ما توصل."
        icon="☎"
      />
      <ReferenceSimulationNotice />
      <TaskConnectionNotice flow={journey} />
      <div className="reference-tracking__context" aria-label="تفاصيل الطلب">
        <span role="status" aria-live="polite" aria-atomic="true">{getTaskProgressLabel(taskState, shops)}</span>
        <span><bdi>{taskState.requestText ?? "طلب بدون وصف"}</bdi></span>
        <span>المحلات المكتشفة: {formatNumber(shops.length)}</span>
      </div>
      {journey.error || taskState.error ? <p className="reference-page__error" role="alert">{journey.error ?? taskState.error}</p> : null}
      {taskState.comparison && <div className="completion-notice"><p role="status">اكتمل طلبك. النتيجة جاهزة للمراجعة.</p><Link className="primary-button" to="/comparison">عرض النتيجة</Link></div>}
      {taskState.phase === "needs_input" && (
        <FollowUpQuestions
          key={`${taskState.taskId}:${taskState.missingQuestions.map((question) => question.key).join("|")}`}
          questions={taskState.missingQuestions}
          onSubmit={journey.submitAnswers}
          isSubmitting={journey.isAnswering}
        />
      )}
      {shops.length > 0 ? (
        <div className="reference-status-grid">
          {shops.map((shop) => <ReferenceStatusCard key={shop.placeId} shop={shop} />)}
        </div>
      ) : taskState.phase !== "needs_input" ? (
        <div className="reference-empty-state" role="status">
          <strong>لم تصل بيانات المحلات بعد.</strong>
          <p>{getTaskProgressLabel(taskState, shops)}</p>
        </div>
      ) : null}
    </ReferenceScreen>
  );
}

const COMPARISON_STATUS_COPY = {
  side_by_side: "إجابات موثقة بدون ترتيب",
  ranked: "العروض مرتبة حسب نتيجة المهمة",
  partial: "مقارنة جزئية",
  cannot_compare: "ما نقدر نقارن العروض بشكل عادل",
};

function getComparisonRanking(comparison, readyShopIds) {
  if (!comparison || comparison.status === "cannot_compare") {
    return [];
  }

  return [...(comparison.ranking ?? [])]
    .filter((item) => readyShopIds.has(item.placeId))
    .sort((left, right) => left.rank - right.rank);
}

function getShopName(shopsByPlaceId, placeId) {
  return shopsByPlaceId.get(placeId)?.name ?? "محل غير معروف";
}

function getRankingItem(shop, optionIndex, comparison) {
  if (optionIndex > 0 || comparison?.status === "cannot_compare") {
    return null;
  }

  return comparison?.ranking?.find((item) => item.placeId === shop.placeId) ?? null;
}

function getReadyOffers(shops, comparison) {
  return shops.flatMap((shop, shopIndex) => {
    if (shop.status !== "ready" || !shop.quote?.options?.length) {
      return [];
    }

    return shop.quote.options.map((option, optionIndex) => ({
      key: `${shop.placeId}-${optionIndex}`,
      shop,
      option,
      optionIndex,
      tone: ["blue", "amber", "green"][shopIndex % 3],
      rankingItem: getRankingItem(shop, optionIndex, comparison),
    }));
  });
}

function getReferenceFieldValue(field, formatter, isVerified) {
  if (field?.status !== "found") {
    return FIELD_STATUS_COPY[field?.status] ?? FIELD_STATUS_COPY.not_mentioned;
  }

  return isVerified ? formatEvidenceValue(field, formatter) : FIELD_STATUS_COPY.unverified;
}

function ReferenceOfferField({ label, field, formatter, transcript, context, shop, onInspect }) {
  const isVerified = isEvidenceFieldTraceable(field, transcript);
  const valueClassName = isVerified
    ? "reference-offer-detail__value"
    : "reference-offer-detail__value reference-offer-detail__value--muted";

  return (
    <div className="reference-offer-detail">
      <dt>{label}</dt>
      <dd>
        <span className={valueClassName}>
          <bdi>{getReferenceFieldValue(field, formatter, isVerified)}</bdi>
        </span>
        {isVerified ? (
          <>
            <button
              className="reference-evidence-link"
              type="button"
              onClick={() => onInspect({ field, label, context, shop })}
              aria-label={`عرض دليل ${label} من ${context}`}
            >
              عرض الدليل
            </button>
          </>
        ) : null}
      </dd>
    </div>
  );
}

function ReferenceOfferCard({ offer, onInspect }) {
  const { shop, optionIndex, tone, rankingItem } = offer;
  const transcript = getQuoteTranscript(shop.quote, shop.transcript ?? []);
  const context = optionIndex > 0
    ? `${shop.name}، الخيار ${formatNumber(optionIndex + 1)}`
    : shop.name;
  const fields = getOfferFields(offer);

  return (
    <article className={`reference-offer-card reference-offer-card--${tone}`}>
      <header className="reference-offer-card__heading">
        <div>
          {rankingItem ? (
            <span className="reference-offer-card__badge">المرتبة {formatNumber(rankingItem.rank)}</span>
          ) : null}
          <h2>{shop.name}</h2>
          {optionIndex > 0 ? <p className="reference-offer-card__option">الخيار {formatNumber(optionIndex + 1)}</p> : null}
        </div>
        <ReferenceIcon>▤</ReferenceIcon>
      </header>
      <dl className="reference-offer-card__details">
        {fields.map(({ key, label, field, formatter }) => (
          <ReferenceOfferField
            key={key}
            label={label}
            field={field}
            formatter={formatter}
            transcript={transcript}
            context={context}
            shop={shop}
            onInspect={onInspect}
          />
        ))}
      </dl>
      <p className="reference-offer-card__note">كل قيمة مؤكدة مرتبطة بعبارة من كلام المحل.</p>
    </article>
  );
}

function getFirstEvidence(offer) {
  if (!offer) {
    return null;
  }

  const transcript = getQuoteTranscript(offer.shop.quote, offer.shop.transcript ?? []);

  return getOfferFields(offer).find(({ field }) => isEvidenceFieldTraceable(field, transcript)) ?? null;
}

function ReferenceEvidenceCard({ offer, onInspect }) {
  const evidence = getFirstEvidence(offer);

  if (!offer || !evidence) {
    return null;
  }

  const transcript = getQuoteTranscript(offer.shop.quote, offer.shop.transcript ?? []);
  const matchingTurn = getTranscriptTurnForEvidence(evidence.field, transcript);
  const context = offer.optionIndex > 0
    ? `${offer.shop.name}، الخيار ${formatNumber(offer.optionIndex + 1)}`
    : offer.shop.name;

  return (
    <aside className="reference-evidence-card" aria-labelledby="reference-evidence-title">
      <header>
        <div>
          <p className="reference-card-eyebrow">دليل من المكالمة</p>
          <h2 id="reference-evidence-title">{offer.shop.name}</h2>
        </div>
        <ReferenceIcon>▶</ReferenceIcon>
      </header>
      <blockquote>«<bdi>{matchingTurn.text}</bdi>»</blockquote>
      <span className="reference-evidence-card__price">{evidence.label}</span>
      <p>هذه العبارة مرتبطة بالمعلومة المستخرجة من {context}.</p>
      <button
        className="reference-card-action"
        type="button"
        onClick={() => onInspect({ field: evidence.field, label: evidence.label, context, shop: offer.shop })}
      >
        عرض النص في المكالمة
      </button>
    </aside>
  );
}

function getComparisonEvidenceOffer(offers, comparison) {
  if (comparison?.status === "cannot_compare") {
    return null;
  }

  const firstRanked = comparison?.ranking?.[0];
  return firstRanked ? offers.find((offer) => offer.shop.placeId === firstRanked.placeId) ?? null : null;
}

export function ReferenceComparisonPage() {
  const journey = useTaskJourney();
  const taskState = journey?.taskState;
  const [selectedEvidence, setSelectedEvidence] = useState(null);

  if (journey?.activeProductMode === "quick" && !(journey.apiEnabled && journey.requestedTaskId)) return <><TaskTabs /><QuickCallView quick={journey.quickCall} /></>;

  if (!taskState?.taskId || (journey.apiEnabled && journey.requestedTaskId && journey.requestedTaskId !== taskState.taskId)) {
    return (
      <ReferenceUnavailablePage
        title="لا توجد مقارنة متاحة"
        description="تظهر المقارنة بعد بدء مهمة في هذه الجلسة واستلام بياناتها."
      />
    );
  }

  const shops = Object.values(taskState.shops);
  const comparison = taskState.comparison;
  const offers = getReadyOffers(shops, comparison);
  const evidenceOffer = getComparisonEvidenceOffer(offers, comparison);
  const shopsByPlaceId = new Map(shops.map((shop) => [shop.placeId, shop]));
  const readyShopIds = new Set(offers.map((offer) => offer.shop.placeId));
  const ranking = getComparisonRanking(comparison, readyShopIds);
  const excluded = (comparison?.excluded ?? []).filter((item) => shopsByPlaceId.has(item.placeId));
  const statusLabel = comparison
    ? COMPARISON_STATUS_COPY[comparison.status] ?? "نتيجة مقارنة غير معروفة"
    : taskState.phase === "failed" ? "تعذر إكمال المقارنة" : "بانتظار اكتمال المقارنة";

  return (
    <ReferenceScreen className="reference-screen--comparison">
      <TaskTabs />
      <ReferencePageHeading
        title="مقارنة العروض"
        description="قارن النتائج وافتح دليل أي معلومة تبي تتأكد منها."
        icon="⚖"
        action={<Link className="reference-share-button" to="/tracking">العودة إلى التتبع <span aria-hidden="true">⌯</span></Link>}
      />
      <ReferenceSimulationNotice />
      <TaskConnectionNotice flow={journey} />
      <div className="reference-tracking__context" aria-label="ملخص المقارنة">
        <span>العروض المتاحة: {formatNumber(offers.length)}</span>
        <span><bdi>{taskState.requestText ?? "طلب بدون وصف"}</bdi></span>
      </div>
      {taskState.error ? <p className="reference-page__error" role="alert">{taskState.error}</p> : null}

      {!comparison ? (
        <div className="reference-empty-state" role="status">
          <strong>{taskState.phase === "failed" ? "تعذر إكمال المقارنة." : "بانتظار اكتمال المقارنة."}</strong>
          <p>{taskState.phase === "failed" ? "لم نعرض نتائج غير موجودة في المهمة." : "ستظهر العروض هنا عندما تصل نتيجة المقارنة من النقل التجريبي."}</p>
        </div>
      ) : (
        <>
          <section className="reference-comparison-result" aria-labelledby="reference-comparison-result-title">
            <div className="result-overview">
              <h2 id="reference-comparison-result-title">نتيجة المهمة</h2>
              <p className="result-status" role="status">{statusLabel}</p>
              <p>وصلت نتائج من {formatNumber(shops.filter((shop) => shop.quote).length)} محلات، واستُبعد {formatNumber(excluded.length)}.</p>
              <CopyTaskSummary task={taskState} />
              {comparison.basis && <p><strong>أساس المقارنة:</strong> <bdi>{comparison.basis}</bdi></p>}
            </div>
            <div className="result-explanation">
              {ranking.length > 0 ? (
                <div>
                  <h3>الترتيب الذي وصل من المهمة</h3>
                  <ol className="reference-ranking" aria-label="ترتيب العروض">
                    {ranking.map((item) => (
                      <li key={item.placeId}>
                        <span>{formatNumber(item.rank)}</span>
                        <div>
                          <strong>{getShopName(shopsByPlaceId, item.placeId)}</strong>
                          <p><bdi>{item.reason}</bdi></p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
              {comparison.cannotCompareReasons?.length > 0 ? (
                <div>
                  <h3>لماذا لا توجد مقارنة عادلة؟</h3>
                  <ul className="reference-comparison-reasons">
                    {comparison.cannotCompareReasons.map((reason) => <li key={reason}><bdi>{reason}</bdi></li>)}
                  </ul>
                </div>
              ) : null}
              {excluded.length > 0 ? (
                <div>
                  <h3>عروض خارج المقارنة</h3>
                  <ul className="reference-comparison-reasons">
                    {excluded.map((item) => (
                      <li key={item.placeId}>
                        <bdi>{getShopName(shopsByPlaceId, item.placeId)}: {item.reason}</bdi>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </section>
          {shops.filter((shop) => shop.quote?.answers?.length).map((shop) => <InquiryAnswers key={shop.placeId} shop={shop} />)}
          {offers.length > 0 ? (
            <div className="reference-comparison-grid">
              {offers.map((offer) => (
                <ReferenceOfferCard
                  key={offer.key}
                  offer={offer}
                  onInspect={setSelectedEvidence}
                />
              ))}
            </div>
          ) : !shops.some((shop) => shop.quote?.answers?.length) ? (
            <div className="reference-empty-state" role="status">
              <strong>لا توجد عروض مكتملة لعرضها.</strong>
              <p>لم نستلم عرضاً موثقاً من أي محل في هذه المهمة.</p>
            </div>
          ) : null}
          {evidenceOffer && <details className="result-proof"><summary>دليل من العرض المرتب أولًا</summary><ReferenceEvidenceCard offer={evidenceOffer} onInspect={setSelectedEvidence} /></details>}


        </>
      )}

      {selectedEvidence ? (
        <EvidenceDrawer
          shopName={selectedEvidence.context}
          evidence={selectedEvidence}
          transcript={getQuoteTranscript(selectedEvidence.shop?.quote, selectedEvidence.shop?.transcript ?? [])}
          onClose={() => setSelectedEvidence(null)}
        />
      ) : null}
    </ReferenceScreen>
  );
}

const SHOP_METRICS = [
  ["ورشة الأمان", "١٢٨", "٪٩١", "٢٨ ثانية"],
  ["مركز الخليج", "١٠٤", "٪٩٢", "٣١ ثانية"],
  ["صيانة السريع", "٩٧", "٪٨٨", "٤٤ ثانية"],
  ["مركز المستقبل", "٨١", "٪٧٦", "٥٦ ثانية"],
  ["أعمار للصيانة", "٦٥", "٪٧١", "٤٨ ثانية"],
];

const OUTCOME_METRICS = [
  ["تم استلام العرض", "٪٥٤", "green"],
  ["المكالمة جارية", "٪٢٤", "amber"],
  ["جاري الاتصال", "٪١٤", "blue"],
  ["تعذر الاتصال", "٪٨", "red"],
];

function ReferenceMetricCard({ title, value, tone }) {
  return (
    <article className={`reference-metric-card reference-metric-card--${tone}`}>
      <div><h2>{title}</h2><ReferenceIcon>{tone === "blue" ? "☎" : tone === "amber" ? "◷" : "ⓘ"}</ReferenceIcon></div>
      <strong>{value}</strong>
      <span className="reference-metric-card__bar"><i /></span>
      <p>من إجمالي المكالمات في العينة</p>
    </article>
  );
}

function ReferenceAccuracyTable() {
  return (
    <table className="reference-metrics-table" aria-label="دقة الحقول الحرجة في بيانات المحاكاة">
      <caption>أداء المحلات (أعلى ٥ محلات)</caption>
      <thead><tr><th scope="col">#</th><th scope="col">اسم المحل</th><th scope="col">عدد المكالمات</th><th scope="col">نسبة الرد</th><th scope="col">متوسط وقت الرد</th></tr></thead>
      <tbody>
        {SHOP_METRICS.map(([name, calls, response, seconds], index) => (
          <tr key={name}><th scope="row" data-label="الترتيب">{index + 1}</th><td data-label="اسم المحل">{name}</td><td data-label="عدد المكالمات">{calls}</td><td data-label="نسبة الرد">{response}</td><td data-label="متوسط وقت الرد">{seconds}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

function ReferenceLatencyTable() {
  return (
    <table className="reference-metrics-table reference-metrics-table--appendix" aria-label="زمن كل مكالمة محاكاة">
      <caption>زمن كل مكالمة محاكاة</caption>
      <thead><tr><th scope="col">المكالمة</th><th scope="col">النتيجة</th><th scope="col">الزمن</th></tr></thead>
      <tbody>
        {SHOP_METRICS.map(([name, , , seconds], index) => (
          <tr key={name}><th scope="row">مكالمة {index + 1} · {name}</th><td data-label="النتيجة">مكتملة</td><td data-label="الزمن">{seconds}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

export function ReferenceMetricsPage() {
  return (
    <ReferenceScreen className="reference-screen--metrics">
      <ReferencePageHeading
        title="لوحة المقاييس الداخلية"
        description="نظرة سريعة على أداء الخدمة وجودة المكالمات."
        icon="▥"
        action={<button className="reference-date-button" type="button">آخر ٧ أيام <span aria-hidden="true">▣</span></button>}
      />
      <DataProvenanceNotice
        title="بيانات محاكاة فقط"
        description="هذه الأرقام توضيحية من بيانات محاكاة، وليست قياسات من الإنتاج."
        source="مجموعة مكالمات اصطناعية للعرض الداخلي"
      />
      <div className="reference-metrics-kpis">
        <ReferenceMetricCard title="معدل نجاح المكالمات" value="٪٨٦" tone="blue" />
        <ReferenceMetricCard title="متوسط وقت إتمام الطلب" value="٨ دقائق" tone="amber" />
        <ReferenceMetricCard title="معدل الحصول على عروض" value="٪٧٨" tone="green" />
      </div>
      <div className="reference-metrics-grid">
        <section className="reference-metrics-panel" aria-labelledby="reference-shop-performance-title">
          <header><div><p className="reference-card-eyebrow">أداء المحلات (أعلى ٥ محلات)</p><h2 id="reference-shop-performance-title">أداء المحلات</h2></div><ReferenceIcon>▥</ReferenceIcon></header>
          <ReferenceAccuracyTable />
        </section>
        <section className="reference-metrics-panel reference-metrics-panel--outcomes" aria-labelledby="reference-outcomes-title">
          <header><div><p className="reference-card-eyebrow">توزيع نتائج المكالمات</p><h2 id="reference-outcomes-title">توزيع نتائج المكالمات</h2></div><ReferenceIcon>▥</ReferenceIcon></header>
          <ul className="reference-outcome-list">
            {OUTCOME_METRICS.map(([label, value, tone]) => (
              <li key={label}><div><span>{label}</span><strong>{value}</strong></div><span className={`reference-outcome-bar reference-outcome-bar--${tone}`}><i /></span></li>
            ))}
          </ul>
        </section>
      </div>
      <p className="reference-metrics__notice">بيانات محاكاة فقط — لأغراض العرض والتصميم</p>
      <section className="reference-metrics__appendix" aria-label="تفاصيل القياس">
        <ReferenceLatencyTable />
      </section>
    </ReferenceScreen>
  );
}

const INFO_STEPS = [
  { number: "١", icon: "⌕", title: "أدخل تفاصيل طلبك", detail: "اختر نوع الجهاز والمشكلة والحي أو اكتبها بطريقتك." },
  { number: "٢", icon: "☎", title: "نتصل بالمحلات", detail: "يسأل وكيل الصوت المحلات القريبة عن السعر والتوفر والضمان." },
  { number: "٣", icon: "▣", title: "راجع العروض", detail: "نرتب لك الإجابات مع دليل واضح من المكالمة قبل الاختيار." },
];

export function ReferenceHowItWorksPage() {
  return (
    <ReferenceScreen className="reference-screen--info">
      <ReferencePageHeading
        title="كيف يعمل"
        description="رحلة بسيطة من وصف المشكلة إلى عرض واضح يمكن مقارنته."
        icon="⌁"
      />
      <ol className="reference-info-steps">
        {INFO_STEPS.map((step) => (
          <li key={step.number}>
            <span className="reference-info-steps__number">{step.number}</span>
            <ReferenceIcon>{step.icon}</ReferenceIcon>
            <h2>{step.title}</h2>
            <p>{step.detail}</p>
          </li>
        ))}
      </ol>
      <div className="reference-info-callout">
        <strong>النتيجة التي تهمك</strong>
        <span>تشوف السعر والتفاصيل المؤكدة في مكان واحد، بدون اتصالات متكررة أو تخمين.</span>
        <Link className="reference-primary-button tw-primary-action tw-focus-ring" to="/">ابدأ طلبك الآن</Link>
      </div>
    </ReferenceScreen>
  );
}

const SERVICE_POINTS = [
  { icon: "☎", title: "اتصال مباشر", detail: "نتحدث مع المحل نيابة عنك ونسجل ما قيل في المكالمة." },
  { icon: "▣", title: "دليل واضح", detail: "كل سعر أو ضمان يظهر مع العبارة التي دعمت استخراجه." },
  { icon: "⌖", title: "محلات قريبة", detail: "نبدأ من نطاقك المحلي حتى تكون العروض قابلة للاستخدام." },
];

export function ReferenceServiceOverviewPage() {
  return (
    <ReferenceScreen className="reference-screen--info reference-screen--about">
      <ReferencePageHeading
        title="لمحة عن الخدمة"
        description="Voice Quote Agent يساعدك تقارن عروض الصيانة قبل ما تختار المحل."
        icon="⌂"
      />
      <div className="reference-service-grid">
        {SERVICE_POINTS.map((point) => (
          <article key={point.title}>
            <ReferenceIcon>{point.icon}</ReferenceIcon>
            <h2>{point.title}</h2>
            <p>{point.detail}</p>
          </article>
        ))}
      </div>
      <div className="reference-info-callout reference-info-callout--warm">
        <strong>مصمم ليكون واضحاً</strong>
        <span>نميز بين المعلومة المؤكدة وما لم يذكره المحل، حتى تكون المقارنة مفهومة من أول قراءة.</span>
        <Link className="reference-primary-button tw-primary-action tw-focus-ring" to="/">قارن عروض الصيانة</Link>
      </div>
    </ReferenceScreen>
  );
}
