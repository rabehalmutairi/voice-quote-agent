import { assertBackendEvent, assertBackendPlan, assertBackendSnapshot, backendEventTypes, BackendProtocolError } from "../contracts/backendContracts";
import { mapBackendEvent, mapBackendSnapshot, toCreateBody } from "./backendAdapter";
import { resolveApiUrl } from "./config";

const FINAL = new Set(["comparison.ready", "task.failed"]);
const ERROR_MESSAGES = {
  unknown_task: "لم نجد هذا الطلب. قد يكون الخادم أُعيد تشغيله دون حفظ البيانات. يمكنك بدء طلب جديد.",
  missing_input: "أكمل التفاصيل المطلوبة قبل بدء الطلب.",
  task_already_started: "هذا الطلب بدأ بالفعل. أعد الاتصال لعرض حالته الحالية.",
  invalid_task_state: "تغيّرت حالة الطلب. أعد الاتصال لتحديثها.",
  unsafe_custom_question: "عدّل السؤال ليكون للاستفسار فقط، دون حجز أو دفع أو مشاركة بيانات شخصية.",
  unsafe_answer: "عدّل الإجابة لتكون للاستفسار فقط، دون تنفيذ إجراءات أو مشاركة بيانات شخصية.",
};

export class ApiError extends Error {
  constructor(message, { code = "connection_error", field, status } = {}) {
    super(message);
    this.userMessage = message;
    this.code = code;
    this.field = field;
    this.status = status;
  }
}

/** HTTP/SSE transport for R5's mock API. It never switches to fixtures on failure. */
export function createApiTransport({ fetchImpl = globalThis.fetch, EventSourceImpl = globalThis.EventSource, timeoutMs = 15000 } = {}) {
  const caches = new Map();
  function cacheFor(taskId) {
    if (!caches.has(taskId)) {
      caches.set(taskId, { transcripts: new Map(), attempts: new Map(), recordedSequence: 0, hydratedSequence: 0 });
    }
    return caches.get(taskId);
  }
  function taskPath(taskId) {
    if (!/^tsk_[A-Za-z0-9]+$/.test(taskId)) throw new ApiError("معرّف الطلب غير صالح.");
    return `/tasks/${encodeURIComponent(taskId)}`;
  }
  async function request(path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(resolveApiUrl(path), {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal,
      });
      let data;
      try { data = await response.json(); } catch { throw new BackendProtocolError(); }
      if (!response.ok) {
        const error = data?.error;
        throw new ApiError(error?.message_ar || ERROR_MESSAGES[error?.code] || (response.status === 503
          ? "الخدمة غير متاحة مؤقتًا. حاول لاحقًا." : response.status === 422
            ? "تحقق من البيانات المطلوبة ثم حاول مرة أخرى." : "تعذر إكمال الطلب. أعد الاتصال للتحقق من حالته."),
        { code: error?.code, field: error?.field, status: response.status });
      }
      return data;
    } catch (error) {
      if (error.userMessage) throw error;
      throw new ApiError("تعذر الاتصال بالخادم. تحقق من تشغيل الـBackend ثم أعد المحاولة.");
    } finally { clearTimeout(timer); }
  }
  function decode(message, taskId, type) {
    let event;
    try { event = JSON.parse(message.data); } catch { throw new BackendProtocolError(); }
    assertBackendEvent(event);
    if (event.task_id !== taskId || event.type !== type || String(event.seq) !== message.lastEventId) throw new BackendProtocolError();
    return event;
  }
  function remember(cache, event) {
    if (event.seq <= cache.recordedSequence) return;
    if (event.type === "call.ended") cache.transcripts.set(event.data.call_id, event.data.transcript);
    if (event.type === "call.started") cache.attempts.set(event.data.call_id, (cache.attempts.get(event.data.call_id) ?? 0) + 1);
    cache.recordedSequence = event.seq;
  }
  // GET's snapshot intentionally omits transcripts. Replay to its watermark before
  // hydrating verified quotes; the next stream replays anything arriving in the gap.
  async function loadHistory(taskId, watermark, cache) {
    if (!watermark || cache.recordedSequence >= watermark) return;
    await new Promise((resolve, reject) => {
      const source = new EventSourceImpl(resolveApiUrl(`${taskPath(taskId)}/events`));
      let cursor = 0;
      let settled = false;
      const finish = (error) => { if (settled) return; settled = true; clearTimeout(timer); source.close(); if (error) reject(error); else resolve(); };
      const timer = setTimeout(() => finish(new ApiError("تعذر استعادة تحديثات الطلب. أعد الاتصال وحاول مرة أخرى.")), timeoutMs);
      backendEventTypes.forEach((type) => source.addEventListener(type, (message) => {
        if (settled) return;
        try {
          const event = decode(message, taskId, type);
          if (event.seq <= cursor) return;
          if (event.seq !== cursor + 1) throw new BackendProtocolError();
          cursor = event.seq;
          remember(cache, event);
          if (cursor >= watermark) finish();
        } catch (error) { finish(error); }
      }));
      source.addEventListener("error", () => {
        if (source.readyState === 2) finish(new ApiError("انقطع الاتصال أثناء استعادة الطلب. أعد الاتصال للمحاولة مرة أخرى."));
      });
    });
  }
  async function getTask(taskId) {
    const raw = assertBackendSnapshot(await request(taskPath(taskId)));
    if (raw.task_id !== taskId) throw new BackendProtocolError();
    const cache = cacheFor(taskId);
    await loadHistory(taskId, raw.last_seq, cache);
    const result = mapBackendSnapshot(raw, cache.transcripts);
    cache.hydratedSequence = raw.last_seq;
    return result;
  }
  return {
    mode: "api",
    async createTask(input) {
      let plan = assertBackendPlan(await request("/tasks", toCreateBody(input)));
      const taskId = plan.task_spec?.task_id;
      if (!taskId) throw new BackendProtocolError();
      const knownAnswers = Object.fromEntries(plan.questions.flatMap(({ key }) => input?.slots?.[key] ? [[key, input.slots[key]]] : []));
      if (plan.status === "needs_input" && Object.keys(knownAnswers).length) {
        plan = assertBackendPlan(await request(`${taskPath(taskId)}/answers`, knownAnswers));
        if (plan.task_spec?.task_id !== taskId) throw new BackendProtocolError();
      }
      return getTask(taskId);
    },
    async submitAnswers(taskId, answers) {
      const plan = assertBackendPlan(await request(`${taskPath(taskId)}/answers`, answers));
      if (plan.task_spec?.task_id !== taskId) throw new BackendProtocolError();
      return getTask(taskId);
    },
    async startTask(taskId) {
      const started = await request(`${taskPath(taskId)}/start`, {});
      if (started?.task_id !== taskId) throw new BackendProtocolError();
      return getTask(taskId);
    },
    getTask,
    subscribe(taskId, onEvent, onConnection = () => {}) {
      const cache = cacheFor(taskId);
      let cursor = cache.hydratedSequence;
      let active = true;
      const source = new EventSourceImpl(resolveApiUrl(`${taskPath(taskId)}/events`));
      const close = () => { active = false; source.close(); };
      onConnection({ state: "connecting" });
      source.addEventListener("open", () => { if (active) onConnection({ state: "connected" }); });
      source.addEventListener("error", () => {
        if (active) onConnection({ state: source.readyState === 2 ? "disconnected" : "reconnecting" });
      });
      backendEventTypes.forEach((type) => source.addEventListener(type, (message) => {
        if (!active) return;
        try {
          const event = decode(message, taskId, type);
          if (event.seq > cursor) {
            if (event.seq !== cursor + 1) throw new BackendProtocolError();
            remember(cache, event);
            const mapped = mapBackendEvent(event, cache.transcripts, cache.attempts);
            onEvent(mapped);
            cursor = event.seq;
          }
          if (FINAL.has(event.type)) { close(); onConnection({ state: "complete" }); }
        } catch (error) {
          close();
          onConnection({ state: "disconnected", message: error.userMessage ?? "تعذر قراءة تحديثات الطلب. أعد الاتصال لاستعادته." });
        }
      }));
      return close;
    },
  };
}
