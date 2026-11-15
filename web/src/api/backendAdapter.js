import { assertTaskEvent, assertTaskSnapshot } from "../contracts/provisionalSchemas";
import { BackendProtocolError } from "../contracts/backendContracts";

const absent = () => ({ status: "not_mentioned" });

/** Map only the body R5 accepts; the planner owns task identity and category inference. */
export function toCreateBody(request) {
  const text = typeof request === "string" ? request.trim() : request?.request_text?.trim();
  if (!text) throw new TypeError("A request is required.");
  const area = request?.area;
  return {
    text,
    area: area && typeof area === "object"
      ? Number.isFinite(area.lat) && Number.isFinite(area.lng) ? area : area.label
      : area ?? null,
    custom_questions: request?.custom_questions ?? [],
    max_businesses: request?.max_businesses ?? 3,
  };
}

export function mapEvidence(field) {
  if (!field) return absent();
  return {
    status: field.status,
    ...(field.value !== null ? { value: field.value } : {}),
    ...(field.value_min !== null ? { valueMin: field.value_min, valueMax: field.value_max } : {}),
    ...(field.confidence !== null ? { confidence: field.confidence } : {}),
    ...(field.evidence_quote !== null ? { evidenceQuote: field.evidence_quote, evidenceTurn: field.evidence_turn } : {}),
  };
}

function mapBusiness(business) {
  return { placeId: business.place_id, name: business.name, phoneE164: business.phone_e164,
    numberType: business.number_type, address: business.address, mapsUrl: business.maps_url,
    openNow: business.open_now ?? undefined, rating: business.rating ?? undefined, simulated: true };
}

function mapQuestions(questions) { return questions.map(({ key, ask_ar }) => ({ key, prompt: ask_ar })); }

function mapComparison(value) {
  if (!value) return null;
  return { status: value.status, basis: value.basis,
    ranking: value.ranking.map(({ place_id, ...row }) => ({ ...row, placeId: place_id })),
    excluded: value.excluded.map(({ place_id, reason }) => ({ placeId: place_id, reason })),
    cannotCompareReasons: value.cannot_compare_reasons };
}

function mapQuote(quote) {
  return {
    options: quote.offers.map((offer) => ({
      partType: mapEvidence(offer.part_type), priceSar: mapEvidence(offer.price_sar),
      warrantyDays: mapEvidence(offer.warranty_days ?? quote.fields.warranty_days),
      ...(offer.variant ? { variant: mapEvidence(offer.variant) } : {}),
      ...(offer.condition ? { condition: mapEvidence(offer.condition) } : {}),
      ...(offer.availability ? { availability: mapEvidence(offer.availability) } : {}),
    })),
    turnaroundMinutes: mapEvidence(quote.fields.turnaround_minutes),
    availability: mapEvidence(quote.fields.availability), answers: quote.answers,
    evidenceIssues: quote.evidence_issues.map((issue) => `${issue.field}:${issue.option_index ?? "call"}:${issue.reason}`),
  };
}

function requireTranscript(quote, transcripts) {
  const transcript = transcripts.get(quote.call_id);
  if (!transcript) throw new BackendProtocolError();
  return transcript;
}

export function mapBackendSnapshot(raw, transcripts) {
  const shops = raw.businesses.map((business) => {
    const quote = raw.quotes.find((q) => q.place_id === business.place_id);
    const call = raw.calls.find((c) => c.place_id === business.place_id);
    const excluded = raw.excluded.find((x) => x.place_id === business.place_id);
    const status = quote ? "ready" : excluded || call?.status === "failed" ? "failed"
      : call?.status === "ended" ? "extracting" : call?.status === "calling" ? "calling" : "discovered";
    return { ...mapBusiness(business), status,
      ...(call ? { callId: call.call_id, outcome: call.outcome ?? undefined, attempt: call.attempts || undefined } : {}),
      quote: quote ? mapQuote(quote) : null,
      transcript: quote ? requireTranscript(quote, transcripts) : transcripts.get(call?.call_id) ?? [],
      error: excluded?.reason ?? call?.reason ?? undefined };
  });
  return assertTaskSnapshot({
    taskId: raw.task_id, requestText: raw.task_spec.request_text,
    phase: raw.state === "created" ? "idle" : raw.state === "done" && raw.comparison?.status === "partial" ? "partial" : raw.state,
    missingQuestions: mapQuestions(raw.follow_up_questions), shops,
    answers: { ...raw.task_spec.slots, ...(raw.task_spec.area ? { area: raw.task_spec.area.label } : {}) },
    comparison: mapComparison(raw.comparison), lastSequence: raw.last_seq,
    error: raw.failure_reason ?? undefined,
  });
}

export function mapBackendEvent(raw, transcripts, attempts = new Map()) {
  const data = raw.data;
  let mapped;
  switch (raw.type) {
    case "task.created": mapped = { requestText: data.request_text }; break;
    case "task.needs_input": mapped = { questions: mapQuestions(data.questions) }; break;
    case "business.found": mapped = { business: mapBusiness(data) }; break;
    case "call.started": mapped = { callId: data.call_id, placeId: data.place_id, attempt: attempts.get(data.call_id) ?? 1 }; break;
    case "call.ended": mapped = { callId: data.call_id, placeId: data.place_id, outcome: data.outcome, durationSeconds: data.duration_s, transcript: data.transcript }; break;
    case "call.failed": mapped = { callId: data.call_id, placeId: data.place_id, outcome: data.outcome, reason: data.reason }; break;
    case "quote.ready": mapped = { callId: data.call_id, placeId: data.place_id, quote: mapQuote(data), transcript: requireTranscript(data, transcripts) }; break;
    case "comparison.ready": mapped = { comparison: mapComparison(data) }; break;
    case "task.failed": mapped = { reason: data.reason }; break;
    default: throw new BackendProtocolError();
  }
  return assertTaskEvent({ type: raw.type, taskId: raw.task_id, sequence: raw.seq, eventId: `${raw.task_id}:${raw.seq}`, at: raw.at, data: mapped });
}
