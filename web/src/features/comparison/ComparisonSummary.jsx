import {
  formatAvailability,
  formatCurrency,
  formatDays,
  formatMinutes,
  formatPartType,
} from "../evidence/formatEvidence";
import { getQuoteTranscript, getTranscriptTurnForEvidence } from "../../utils/evidence";

const STATUS_COPY = {
  ranked: {
    label: "العروض مرتبة",
    tone: "success",
  },
  partial: {
    label: "مقارنة جزئية",
    tone: "warning",
  },
  side_by_side: { label: "إجابات بدون ترتيب", tone: "success" },
  cannot_compare: {
    label: "ما نقدر نقارن العروض بشكل عادل",
    tone: "warning",
  },
};

const COMPARISON_ROWS = [
  { label: "نوع القطعة", getValue: (option) => getFormattedFieldValue(option.partType, formatPartType) },
  { label: "السعر", getValue: (option) => getFormattedFieldValue(option.priceSar, formatCurrency) },
  { label: "الضمان", getValue: (option) => getFormattedFieldValue(option.warrantyDays, formatDays) },
  { label: "مدة الإصلاح", getValue: (_option, shop) => getFormattedFieldValue(shop.quote.turnaroundMinutes, formatMinutes) },
  { label: "التوفر", getValue: (_option, shop) => getFormattedFieldValue(shop.quote.availability, formatAvailability) },
];

function getShopName(shops, placeId) {
  return shops[placeId]?.name ?? "محل غير معروف";
}

function formatRank(rank) {
  return new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 0 }).format(rank);
}

function getReadyShops(shops) {
  return Object.values(shops).filter((shop) => shop.status === "ready" && shop.quote?.options?.[0]);
}

function getFormattedFieldValue(field, formatter) {
  return field?.status === "found" ? formatter(field.value) : "غير مؤكّد";
}

function getComparisonRanking(comparison, readyShopIds) {
  if (comparison.status === "cannot_compare") {
    return [];
  }

  return [...(comparison.ranking ?? [])]
    .filter((item) => readyShopIds.has(item.placeId))
    .sort((left, right) => left.rank - right.rank);
}

function ComparisonTable({ shops }) {
  return (
    <div className="comparison-table-wrap">
      <table className="comparison-table" aria-label="مقارنة العروض المستلمة">
        <caption>مقارنة العروض المستلمة من المحلات</caption>
        <thead>
          <tr>
            <th scope="col">الحقل</th>
            {shops.map((shop) => <th scope="col" key={shop.placeId}>{shop.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {COMPARISON_ROWS.map(({ label, getValue }) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              {shops.map((shop) => (
                <td key={`${shop.placeId}-${label}`} data-label={shop.name}>
                  <bdi>{getValue(shop.quote.options[0], shop)}</bdi>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ComparisonEvidence({ shops, ranking }) {
  const rankedShop = ranking[0] ? shops.find((shop) => shop.placeId === ranking[0].placeId) : null;
  const option = rankedShop?.quote?.options?.[0];
  const priceField = option?.priceSar;
  const transcript = getQuoteTranscript(rankedShop?.quote, rankedShop?.transcript ?? []);
  const matchingTurn = priceField ? getTranscriptTurnForEvidence(priceField, transcript) : null;

  if (!rankedShop || !matchingTurn) {
    return null;
  }

  return (
    <aside className="comparison-evidence" aria-labelledby="comparison-evidence-title">
      <div className="comparison-evidence__heading">
        <div>
          <p className="eyebrow">دليل من المكالمة</p>
          <h3 id="comparison-evidence-title">{rankedShop.name}</h3>
        </div>
        <span className="comparison-evidence__icon" aria-hidden="true">▶</span>
      </div>
      <blockquote>
        <span aria-hidden="true">«</span>
        <bdi>{matchingTurn.text}</bdi>
        <span aria-hidden="true">»</span>
      </blockquote>
      <p>معلومة مؤكدة مرتبطة بكلام المحل في الدور {formatRank(matchingTurn.i)} من المكالمة.</p>
    </aside>
  );
}

/**
 * Explains the backend comparison result without recalculating its ranking.
 * @param {{ comparison: Object, shops: Record<string, Object> }} props
 */
export function ComparisonSummary({ comparison, shops = {} }) {
  if (!comparison) {
    return null;
  }

  const copy = STATUS_COPY[comparison.status] ?? STATUS_COPY.cannot_compare;
  const quotedShops = getReadyShops(shops);
  const quotedShopIds = new Set(quotedShops.map((shop) => shop.placeId));
  const ranking = getComparisonRanking(comparison, quotedShopIds);
  const cannotCompareReasons = comparison.cannotCompareReasons ?? [];
  const excluded = (comparison.excluded ?? []).filter((item) => Object.hasOwn(shops, item.placeId));

  return (
    <section
      className={`comparison-summary comparison-summary--${copy.tone}`}
      aria-labelledby="comparison-title"
    >
      <div className="comparison-summary__heading">
        <div>
          <p className="eyebrow">الخلاصة</p>
          <h2 id="comparison-title">{comparison.status === "side_by_side" ? "إجابات المحلات" : "مقارنة العروض"}</h2>
        </div>
        <span className="comparison-summary__status">{copy.label}</span>
      </div>
      {comparison.basis && <p className="comparison-summary__basis">
        <strong>أساس المقارنة:</strong> <bdi>{comparison.basis}</bdi>
      </p>}

      {quotedShops.length > 0 ? (
        <div className="comparison-compare-layout">
          <ComparisonTable shops={quotedShops} />
          <ComparisonEvidence shops={quotedShops} ranking={ranking} />
        </div>
      ) : null}

      {ranking.length > 0 ? (
        <div className="comparison-summary__group">
          <h3>ترتيب العروض</h3>
          <ol className="comparison-ranking" aria-label="ترتيب العروض">
            {ranking.map((item) => (
              <li key={item.placeId} className="comparison-ranking__item">
                <span className="comparison-ranking__rank" aria-label={`المرتبة ${formatRank(item.rank)}`}>
                  {formatRank(item.rank)}
                </span>
                <div>
                  <strong>{getShopName(shops, item.placeId)}</strong>
                  <p><bdi>{item.reason}</bdi></p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {cannotCompareReasons.length > 0 ? (
        <div className="comparison-summary__group">
          <h3>ليش ما نقدر نعطي ترتيباً كاملاً؟</h3>
          <ul className="comparison-reasons">
            {cannotCompareReasons.map((reason) => (
              <li key={reason}><bdi>{reason}</bdi></li>
            ))}
          </ul>
        </div>
      ) : null}

      {excluded.length > 0 ? (
        <div className="comparison-summary__group">
          <h3>عروض خارج المقارنة</h3>
          <ul className="comparison-excluded">
            {excluded.map((item) => (
              <li key={item.placeId}>
                <bdi>{getShopName(shops, item.placeId)}: {item.reason}</bdi>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
