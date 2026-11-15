import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { z } from "zod";

// Byte-for-byte copies of /contracts at main b0dac57. No schema is fetched at runtime.
const schemas = import.meta.glob("./backend/*.schema.json", { eager: true, import: "default" });
const validator = new Ajv2020({ strict: false, allErrors: false });
addFormats(validator);
Object.values(schemas).forEach((schema) => validator.addSchema(schema));
const contractRoot = "https://github.com/rabehalmutairi/voice-quote-agent/contracts/";

export class BackendProtocolError extends Error {
  constructor() {
    super("The backend returned data outside the agreed contract.");
    this.userMessage = "وصلت بيانات غير متوقعة من الخادم. أعد الاتصال لاستعادة الطلب.";
  }
}

export function assertCanonical(name, value) {
  if (!validator.getSchema(`${contractRoot}${name}.schema.json`)(value)) throw new BackendProtocolError();
  return value;
}

const question = z.object({ key: z.string().min(1), ask_ar: z.string().min(1) });
const plan = z.object({
  status: z.enum(["ready", "needs_input", "invalid", "rejected", "error"]),
  task_spec: z.unknown().nullable(), questions: z.array(question),
  error: z.object({ code: z.string(), message: z.string(), message_ar: z.string().nullable().optional(), field: z.string().nullable().optional() }).nullable(),
  notes: z.array(z.string()),
});
const snapshot = z.object({
  task_id: z.string().regex(/^tsk_[A-Za-z0-9]+$/),
  state: z.enum(["created", "needs_input", "discovering", "calling", "extracting", "done", "failed"]),
  task_spec: z.unknown(), follow_up_questions: z.array(question),
  businesses: z.array(z.unknown()), quotes: z.array(z.unknown()),
  calls: z.array(z.object({ call_id: z.string().min(1), place_id: z.string().min(1), status: z.enum(["pending", "calling", "ended", "failed"]), attempts: z.number().int().min(0).max(2), outcome: z.string().nullable(), reason: z.string().nullable(), quote_ready: z.boolean() })),
  excluded: z.array(z.object({ place_id: z.string().min(1), reason: z.string().min(1) })),
  comparison: z.unknown().nullable(), failure_reason: z.string().nullable(),
  cost_usd: z.number().nonnegative(), last_seq: z.number().int().nonnegative(),
});

export function assertBackendPlan(value) {
  const parsed = plan.safeParse(value);
  if (!parsed.success) throw new BackendProtocolError();
  if (["ready", "needs_input"].includes(value.status)) {
    assertCanonical("task_spec", value.task_spec);
    if (value.status === "ready" && value.task_spec.missing_slots.length) throw new BackendProtocolError();
  }
  return parsed.data;
}

export function assertBackendSnapshot(value) {
  const parsed = snapshot.safeParse(value);
  if (!parsed.success) throw new BackendProtocolError();
  const data = parsed.data;
  assertCanonical("task_spec", data.task_spec);
  if (data.task_id !== data.task_spec.task_id) throw new BackendProtocolError();
  data.businesses.forEach((item) => assertCanonical("business", item));
  if (new Set(data.businesses.map((item) => item.place_id)).size !== data.businesses.length) throw new BackendProtocolError();
  data.quotes.forEach((item) => {
    assertCanonical("quote", item);
    if (item.task_id !== data.task_id) throw new BackendProtocolError();
    if (!data.businesses.some((business) => business.place_id === item.place_id)
      || !data.calls.some((call) => call.call_id === item.call_id && call.place_id === item.place_id)) throw new BackendProtocolError();
  });
  if (data.comparison) {
    assertCanonical("comparison", data.comparison);
    if (data.comparison.task_id !== data.task_id) throw new BackendProtocolError();
  }
  return data;
}

export function assertBackendEvent(value) {
  assertCanonical("event", value);
  if (["task.created", "call.ended", "quote.ready", "comparison.ready"].includes(value.type)
    && value.data.task_id !== value.task_id) throw new BackendProtocolError();
  return value;
}
export const backendEventTypes = Object.freeze(["task.created", "task.needs_input", "business.found", "call.started", "call.ended", "call.failed", "quote.ready", "comparison.ready", "task.failed"]);
