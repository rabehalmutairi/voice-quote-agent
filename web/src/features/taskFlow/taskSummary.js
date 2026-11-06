import { formatCurrency, formatNumber, formatPartType } from "../evidence/formatEvidence";
import { getQuoteTranscript, getTranscriptTurnForEvidence } from "../../utils/evidence";

const STATUS = { ranked: "عروض مرتبة", partial: "مقارنة جزئية", side_by_side: "إجابات بدون ترتيب", cannot_compare: "تعذرت المقارنة" };
const ANSWER_STATUS = { found: "إجابة موثقة", unclear: "إجابة غير واضحة", refused: "المحل امتنع عن الإجابة", not_mentioned: "لم يذكر المحل الإجابة" };

/** Copy only returned results; do not infer ranking or unsupported extracted values. */
export function buildTaskSummary(task) {
  const shops = Object.values(task.shops ?? {});
  const lines = ["Voice Quote Agent — بيانات محاكاة فقط", task.requestText ?? "", STATUS[task.comparison?.status] ?? (task.phase === "failed" ? "تعذر إكمال الطلب" : "نتيجة المهمة")];
  for (const item of task.comparison?.ranking ?? []) {
    const shop = shops.find((candidate) => candidate.placeId === item.placeId);
    if (shop?.quote) lines.push(`${item.rank}. ${shop.name}: ${item.reason}`);
  }
  for (const shop of shops) {
    const transcript = getQuoteTranscript(shop.quote, shop.transcript ?? []);
    for (const [index, option] of (shop.quote?.options ?? []).entries()) {
      const price = option.priceSar;
      const part = getTranscriptTurnForEvidence(option.partType, transcript) ? option.partType : null;
      if (getTranscriptTurnForEvidence(price, transcript)) {
        const label = `الخيار ${formatNumber(index + 1)}${part ? ` (${formatPartType(part.value)})` : ""}`;
        lines.push(`${shop.name} — ${label}: ${formatCurrency(price.value)} — «${price.evidenceQuote}»${part ? `، نوع القطعة: «${part.evidenceQuote}»` : ""}`);
      }
    }
    for (const answer of shop.quote?.answers ?? []) {
      const verified = answer.evidence.length > 0 && answer.evidence.every((item) => getTranscriptTurnForEvidence({ status: "found", evidenceQuote: item.quote, evidenceTurn: item.turn }, transcript));
      const status = answer.status === "found" && !verified ? "إجابة غير موثقة" : ANSWER_STATUS[answer.status] ?? "حالة غير معروفة";
      lines.push(`${shop.name} — ${answer.question} (${status}): ${verified ? answer.summary_ar : "لا توجد إجابة موثقة"}`);
      if (verified) lines.push(...answer.evidence.map((item) => `«${item.quote}»`));
    }
  }
  lines.push(...(task.comparison?.cannotCompareReasons ?? []));
  for (const item of task.comparison?.excluded ?? []) {
    const shop = shops.find((candidate) => candidate.placeId === item.placeId);
    if (shop) lines.push(`${shop.name}: ${item.reason}`);
  }
  if (task.error) lines.push(task.error);
  return lines.filter(Boolean).join("\n");
}
