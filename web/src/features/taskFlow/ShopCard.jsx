import { useCallback, useState } from "react";
import { EvidenceDrawer } from "../evidence/EvidenceDrawer";
import { EvidenceField } from "../evidence/EvidenceField";
import { InquiryAnswers } from "../quickCall/InquiryAnswers";
import {
  formatAvailability,
  formatCurrency,
  formatDays,
  formatMinutes,
  formatNumber,
  formatPartType,
} from "../evidence/formatEvidence";
import { getQuoteTranscript } from "../../utils/evidence";
import {
  getShopAddress,
  getShopMapsHref,
  getShopNumberType,
  getShopOpenNow,
  getShopPhoneHref,
  getShopRating,
} from "./shopActions";

const SHOP_STATUS = {
  discovered: { label: "تم العثور على المحل", detail: "وجدنا محلاً مناسباً في منطقتك.", tone: "info" },
  calling: { label: "جاري الاتصال", detail: "ننتظر الرد من المحل الآن.", tone: "info" },
  talking: { label: "المكالمة جارية", detail: "نتحدث مع المحل للحصول على التفاصيل.", tone: "info" },
  extracting: { label: "نستخرج العرض", detail: "نراجع السعر والضمان ومدة الإصلاح.", tone: "info" },
  ready: { label: "تم استلام العرض", detail: "وصلنا عرض موثق من كلام المحل.", tone: "success" },
  failed: { label: "تعذر الاتصال", detail: "لم يصلنا رد، ويمكن المحاولة لاحقاً.", tone: "danger" },
};

const SHOP_FAILURE_MESSAGES = {
  voicemail: "وصلنا إلى البريد الصوتي ولم نتمكن من أخذ عرض.",
  ivr: "تعذر تجاوز الرد الآلي للحصول على عرض.",
  no_answer: "لم يرد المحل على الاتصال.",
  busy: "كان خط المحل مشغولاً.",
  hung_up: "انتهت المكالمة قبل استلام العرض.",
  wrong_business: "لم نتمكن من تأكيد أن الرقم للمحل المطلوب.",
  failed: "تعذر الاتصال بالمحل.",
};

function formatRating(rating) {
  return new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 1 }).format(rating);
}

function getFailureMessage(outcome) {
  return SHOP_FAILURE_MESSAGES[outcome] ?? SHOP_FAILURE_MESSAGES.failed;
}

function notMentionedField() {
  return { status: "not_mentioned" };
}

function QuoteDetails({ shop, onInspect }) {
  const quote = shop.quote;
  const transcript = getQuoteTranscript(quote, shop.transcript ?? []);

  return (
    <section className="shop-card__quote" aria-labelledby={`quote-${shop.placeId}`}>
      <div className="shop-card__quote-heading">
        <div>
          <p className="eyebrow">دليل من المكالمة</p>
          <h4 id={`quote-${shop.placeId}`}>العرض المستخرج</h4>
        </div>
        <span className="quote-signal" aria-hidden="true">▶</span>
      </div>
      <div className="quote-options">
        {quote.options.map((option, index) => (
          <section className="quote-option" key={`${shop.placeId}-option-${index}`}>
            <h5>الخيار {formatNumber(index + 1)}</h5>
            <dl className="evidence-field-list">
              <EvidenceField
                label="نوع القطعة"
                field={option.partType}
                formatter={formatPartType}
                transcript={transcript}
                context={`${shop.name}، الخيار ${formatNumber(index + 1)}`}
                onInspect={onInspect}
              />
              <EvidenceField
                label="السعر"
                field={option.priceSar}
                formatter={formatCurrency}
                transcript={transcript}
                context={`${shop.name}، الخيار ${formatNumber(index + 1)}`}
                onInspect={onInspect}
              />
              <EvidenceField
                label="الضمان"
                field={option.warrantyDays ?? notMentionedField()}
                formatter={formatDays}
                transcript={transcript}
                context={`${shop.name}، الخيار ${formatNumber(index + 1)}`}
                onInspect={onInspect}
              />
            </dl>
          </section>
        ))}
      </div>
      <dl className="evidence-field-list evidence-field-list--summary">
        <EvidenceField
          label="مدة الإصلاح"
          field={quote.turnaroundMinutes}
          formatter={formatMinutes}
          transcript={transcript}
          context={shop.name}
          onInspect={onInspect}
        />
        <EvidenceField
          label="التوفر"
          field={quote.availability ?? notMentionedField()}
          formatter={formatAvailability}
          transcript={transcript}
          context={shop.name}
          onInspect={onInspect}
        />
      </dl>
      {quote.evidenceIssues?.length > 0 ? (
        <p className="shop-card__evidence-warning" role="note">
          تعذر التحقق من بعض المعلومات، لذلك لم نعرضها كقيم مؤكدة.
        </p>
      ) : null}
    </section>
  );
}

function hasQuoteOptions(shop) {
  return Array.isArray(shop.quote?.options) && shop.quote.options.length > 0;
}

/**
 * Presents one shop's current call state and, when ready, its evidence-backed fixture quote.
 * @param {{ shop: Object }} props
 */
export function ShopCard({ shop, showQuote = true }) {
  const status = shop.status === "calling" && shop.attempt === 2
    ? { ...SHOP_STATUS.calling, label: "نعيد الاتصال", detail: "المحاولة الثانية مع المحل نفسه." }
    : SHOP_STATUS[shop.status] ?? SHOP_STATUS.discovered;
  const [selectedEvidence, setSelectedEvidence] = useState(null);
  const closeEvidence = useCallback(() => setSelectedEvidence(null), []);
  const inspectEvidence = useCallback((evidence) => setSelectedEvidence(evidence), []);
  const transcript = getQuoteTranscript(shop.quote, shop.transcript ?? []);
  const address = getShopAddress(shop);
  const mapsHref = getShopMapsHref(shop);
  const numberType = getShopNumberType(shop);
  const openNow = getShopOpenNow(shop);
  const phoneHref = shop.simulated === false ? getShopPhoneHref(shop) : null;
  const rating = getShopRating(shop);
  const hasShopDetails = rating !== null || numberType || openNow !== null;
  const hasShopActions = phoneHref || mapsHref;

  return (
    <>
      <article className={`shop-card shop-card--${status.tone}`} aria-labelledby={`shop-${shop.placeId}`}>
        <div className="shop-card__heading">
          <div className="shop-card__identity">
            <span className="shop-card__icon" aria-hidden="true">⌂</span>
            <div>
              <h3 id={`shop-${shop.placeId}`}>{shop.name}</h3>
              {address ? <p className="shop-card__address">{address}</p> : null}
            </div>
          </div>
          <div className="shop-card__state">
            <span className="shop-status"><span aria-hidden="true" />{status.label}</span>
            <p className="shop-card__state-note">{status.detail}</p>
          </div>
        </div>
        {hasShopDetails ? (
          <dl className="shop-card__details">
            {rating !== null ? (
              <div>
                <dt>التقييم</dt>
                <dd>{formatRating(rating)} / ٥</dd>
              </div>
            ) : null}
            {numberType ? (
              <div>
                <dt>نوع الرقم</dt>
                <dd dir="ltr"><bdi>{numberType}</bdi></dd>
              </div>
            ) : null}
            {openNow !== null ? (
              <div>
                <dt>الحالة</dt>
                <dd>{openNow ? "مفتوح الآن" : "مغلق الآن"}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        {hasShopActions ? (
          <nav className="shop-card__actions" aria-label={`إجراءات ${shop.name}`}>
            {phoneHref ? (
              <a
                className="button-link shop-card__action"
                href={phoneHref}
                aria-label={`اتصل بـ ${shop.name}`}
              >
                اتصال بالمحل
              </a>
            ) : null}
            {mapsHref ? (
              <a
                className="button-link shop-card__action"
                href={mapsHref}
                target="_blank"
                rel="noreferrer"
                aria-label={`عرض موقع ${shop.name} على خرائط Google`}
              >
                فتح الموقع على الخريطة
              </a>
            ) : null}
          </nav>
        ) : null}
        {showQuote && shop.status === "ready" && hasQuoteOptions(shop) ? (
          <QuoteDetails shop={shop} onInspect={inspectEvidence} />
        ) : null}
        {showQuote && shop.quote?.answers?.length > 0 ? <InquiryAnswers shop={shop} /> : null}
        {shop.status === "ready" && !hasQuoteOptions(shop) && !shop.quote?.answers?.length ? (
          <p className="shop-card__evidence-warning" role="status">
            وصل تحديث المحل، لكن بيانات العرض غير مكتملة لذلك لم نعرض تفاصيل غير مؤكدة.
          </p>
        ) : null}
        {shop.status === "failed" ? (
          <p className="shop-card__error">{getFailureMessage(shop.outcome)}</p>
        ) : null}
      </article>
      {selectedEvidence ? (
        <EvidenceDrawer
          shopName={shop.name}
          evidence={selectedEvidence}
          transcript={transcript}
          onClose={closeEvidence}
        />
      ) : null}
    </>
  );
}
