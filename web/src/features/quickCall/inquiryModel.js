import { z } from "zod";

// ADR 002 draft for local mock work only. R1's contract-change PR is still pending.
const text = z.string().trim().min(1).max(300);
const inputSchema = z.object({ query: text, area: text, questions: z.array(text).min(1).max(2) });

export function createInquiryDraft(input) {
  const { query, area, questions } = inputSchema.parse(input);
  // UX guard only; the planner/orchestrator own the authoritative outbound policy.
  const content = [query, area, ...questions].join(" ").normalize("NFKC").replace(/[أإآ]/g, "ا").replace(/[\u064b-\u065f]/g, "");
  if (/[\d٠-٩۰-۹]{7,}|@|احجز|حجز لي|ادفع|اطلب لي|رقم هوي|حسابي|book for me|pay for me/i.test(content)) {
    throw new TypeError("الطلب للاستفسار فقط. احذف طلب الحجز أو الدفع أو البيانات الشخصية.");
  }
  return {
    category: "general_inquiry", request_text: questions.join("\n"), slots: {},
    custom_questions: questions, area: { label: area, radius_m: 5000 },
    target: { query, business: null }, max_businesses: 1, missing_slots: ["business"],
  };
}

export function isCallableBusiness(business) {
  return ["mobile", "landline"].includes(business.numberType);
}
