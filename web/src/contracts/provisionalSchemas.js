import { z } from "zod";
import { getTranscriptTurnForEvidence } from "../utils/evidence";

// These schemas are deliberately frontend-provisional. They validate fixture payloads and
// the adapter boundary only; they must be replaced or mapped when R1 publishes /contracts.
const nonEmptyString = z.string().trim().min(1);
const optionalNonEmptyString = nonEmptyString.optional();

export const taskPhaseSchema = z.enum([
  "idle",
  "needs_input",
  "discovering",
  "calling",
  "extracting",
  "comparing",
  "done",
  "partial",
  "failed",
]);

export const shopStatusSchema = z.enum([
  "discovered",
  "calling",
  "talking",
  "extracting",
  "ready",
  "failed",
]);

export const callOutcomeSchema = z.enum([
  "human_completed",
  "human_partial",
  "voicemail",
  "ivr",
  "no_answer",
  "busy",
  "hung_up",
  "wrong_business",
  "failed",
]);

const evidenceStatusSchema = z.enum(["found", "not_mentioned", "refused", "unclear"]);

// Transcript turns are a fixture-only enrichment used to let the evidence UI point back
// to the shop's words. The canonical Quote contract remains owned by R6/R1.
export const transcriptTurnSchema = z.object({
  i: z.number().int().nonnegative(),
  speaker: z.enum(["agent", "shop"]),
  t: z.number().nonnegative(),
  text: nonEmptyString,
});

export const transcriptSchema = z.array(transcriptTurnSchema).max(200).superRefine((turns, context) => {
  const seenIndexes = new Set();

  turns.forEach((turn, index) => {
    if (seenIndexes.has(turn.i)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, "i"],
        message: "Transcript turn indexes must be unique.",
      });
    }

    seenIndexes.add(turn.i);
  });
});

function createEvidenceFieldSchema(valueSchema) {
  return z
    .object({
      value: valueSchema.optional(),
      status: evidenceStatusSchema,
      confidence: z.number().min(0).max(1).optional(),
      evidenceQuote: optionalNonEmptyString,
      evidenceTurn: z.number().int().nonnegative().optional(),
    })
    .superRefine((field, context) => {
      const hasValue = field.value !== undefined && field.value !== null;
      const hasEvidenceQuote = field.evidenceQuote !== undefined;
      const hasEvidenceTurn = field.evidenceTurn !== undefined;

      if (field.status === "found" && (!hasValue || !hasEvidenceQuote || !hasEvidenceTurn)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Found evidence fields require a typed value, evidenceQuote, and evidenceTurn.",
        });
      }

      if (field.status !== "found" && (hasValue || hasEvidenceQuote || hasEvidenceTurn)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Only verified found evidence fields may contain evidence data.",
        });
      }
    });
}

export const evidenceFieldSchema = createEvidenceFieldSchema(z.unknown());

const partTypeEvidenceFieldSchema = createEvidenceFieldSchema(
  z.enum(["original", "pulled_original", "commercial", "unknown"]),
);
const priceEvidenceFieldSchema = createEvidenceFieldSchema(
  z.number().finite().nonnegative(),
);
const durationEvidenceFieldSchema = createEvidenceFieldSchema(
  z.number().finite().nonnegative(),
);
const availabilityEvidenceFieldSchema = createEvidenceFieldSchema(
  z.enum(["available", "unavailable", "unknown"]),
);

export const businessSchema = z.object({
  placeId: nonEmptyString,
  name: nonEmptyString,
  phoneE164: z.string().regex(/^\+[1-9]\d{7,14}$/).optional(),
  numberType: z.enum(["mobile", "landline", "unified_920", "toll_free_800"]).optional(),
  address: optionalNonEmptyString,
  mapsUrl: z.string().url().optional(),
  openNow: z.boolean().optional(),
  rating: z.number().min(0).max(5).optional(),
});

const quoteOptionSchema = z.object({
  partType: partTypeEvidenceFieldSchema,
  priceSar: priceEvidenceFieldSchema,
  warrantyDays: durationEvidenceFieldSchema.optional(),
});

export const inquiryAnswerSchema = z.object({
  question_index: z.number().int().nonnegative(),
  question: nonEmptyString,
  status: evidenceStatusSchema,
  summary_ar: nonEmptyString.nullable(),
  evidence: z.array(z.object({ quote: nonEmptyString, turn: z.number().int().nonnegative() })),
}).superRefine((answer, context) => {
  const absent = answer.status === "not_mentioned";
  if (absent ? answer.summary_ar !== null || answer.evidence.length > 0 : !answer.summary_ar || answer.evidence.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Answers require evidence unless not mentioned." });
  }
});

export const quoteSchema = z.object({
  options: z.array(quoteOptionSchema).max(5).default([]),
  answers: z.array(inquiryAnswerSchema).max(2).default([]),
  turnaroundMinutes: durationEvidenceFieldSchema.default({ status: "not_mentioned" }),
  availability: availabilityEvidenceFieldSchema.optional(),
  evidenceIssues: z.array(nonEmptyString).default([]),
  // Some early fixtures place transcript data inside the quote. Accept it while the
  // adapter settles on the event-level enrichment used by the current fixtures.
  transcript: transcriptSchema.optional(),
}).superRefine((quote, context) => {
  if (!quote.options.length && !quote.answers.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "A quote needs offers or answers." });
  }
});

function getQuoteEvidenceIssue(field, transcript) {
  if (getTranscriptTurnForEvidence(field, transcript)) {
    return null;
  }

  if (field.evidenceTurn === undefined) {
    return "Found evidence must reference a transcript turn.";
  }

  const referencedTurn = transcript.find((turn) => turn.i === field.evidenceTurn);
  if (!referencedTurn) {
    return "Evidence must reference an existing transcript turn.";
  }

  if (referencedTurn.speaker !== "shop") {
    return "Evidence must reference a transcript turn spoken by the shop.";
  }

  return "Evidence quote must match the referenced shop transcript turn.";
}

function addQuoteEvidenceIssues(quote, transcript, context, pathPrefix = []) {
  if (!quote) {
    return;
  }

  for (const [index, answer] of quote.answers.entries()) {
    for (const evidence of answer.evidence) {
      if (!getTranscriptTurnForEvidence({ status: "found", evidenceQuote: evidence.quote, evidenceTurn: evidence.turn }, transcript)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: [...pathPrefix, "answers", index], message: "Answer evidence must occur in a shop turn." });
      }
    }
  }

  const fields = [
    ...quote.options.flatMap((option, index) => [
      { field: option.partType, path: ["options", index, "partType"] },
      { field: option.priceSar, path: ["options", index, "priceSar"] },
      option.warrantyDays
        ? { field: option.warrantyDays, path: ["options", index, "warrantyDays"] }
        : null,
    ]),
    { field: quote.turnaroundMinutes, path: ["turnaroundMinutes"] },
    quote.availability ? { field: quote.availability, path: ["availability"] } : null,
  ].filter(Boolean);

  for (const { field, path } of fields) {
    if (field.status !== "found") {
      continue;
    }

    const message = getQuoteEvidenceIssue(field, transcript);
    if (!message) {
      continue;
    }

    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...pathPrefix, ...path],
      message,
    });
  }
}

export const shopStateSchema = businessSchema.extend({
  status: shopStatusSchema,
  attempt: z.number().int().min(1).max(2).optional(),
  callId: optionalNonEmptyString,
  outcome: callOutcomeSchema.optional(),
  quote: quoteSchema.nullable().optional(),
  transcript: transcriptSchema.default([]),
  error: optionalNonEmptyString,
}).superRefine((shop, context) => {
  const transcript = shop.transcript.length > 0
    ? shop.transcript
    : shop.quote?.transcript ?? [];

  addQuoteEvidenceIssues(shop.quote, transcript, context, ["quote"]);
});

const missingQuestionSchema = z.object({
  key: nonEmptyString,
  prompt: nonEmptyString,
});

const comparisonRankingEntrySchema = z.object({
  placeId: nonEmptyString,
  rank: z.number().int().positive(),
  reason: nonEmptyString,
});

const comparisonExcludedEntrySchema = z.object({
  placeId: nonEmptyString,
  reason: nonEmptyString,
});

export const comparisonSchema = z.object({
  status: z.enum(["ranked", "partial", "side_by_side", "cannot_compare"]),
  basis: nonEmptyString.nullable(),
  ranking: z.array(comparisonRankingEntrySchema),
  excluded: z.array(comparisonExcludedEntrySchema),
  cannotCompareReasons: z.array(nonEmptyString).default([]),
}).superRefine((comparison, context) => {
  const rankingPlaceIds = comparison.ranking.map((item) => item.placeId);
  const excludedPlaceIds = comparison.excluded.map((item) => item.placeId);
  const ranks = comparison.ranking.map((item) => item.rank).sort((left, right) => left - right);

  if (comparison.status === "side_by_side" && (comparison.basis !== null || comparison.ranking.length || comparison.cannotCompareReasons.length)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Side-by-side results have no ranking or comparison basis." });
  }

  if (comparison.status === "ranked" && comparison.ranking.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ranking"],
      message: "Ranked comparisons require at least one ranked offer.",
    });
  }

  if (comparison.status === "cannot_compare") {
    if (comparison.ranking.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ranking"],
        message: "Cannot-compare results must not include a ranking.",
      });
    }

    if (comparison.cannotCompareReasons.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cannotCompareReasons"],
        message: "Cannot-compare results require at least one reason.",
      });
    }
  }

  if (new Set(rankingPlaceIds).size !== rankingPlaceIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ranking"],
      message: "A comparison ranking cannot contain the same shop more than once.",
    });
  }

  if (new Set(excludedPlaceIds).size !== excludedPlaceIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["excluded"],
      message: "Excluded shops cannot be repeated.",
    });
  }

  if (rankingPlaceIds.some((placeId) => excludedPlaceIds.includes(placeId))) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["excluded"],
      message: "A shop cannot be both ranked and excluded.",
    });
  }

  if (ranks.some((rank, index) => rank !== index + 1)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ranking"],
      message: "Ranking positions must be unique and contiguous from one.",
    });
  }
});

export const taskSnapshotSchema = z.object({
  taskId: nonEmptyString,
  phase: taskPhaseSchema,
  requestText: optionalNonEmptyString,
  answers: z.record(z.string(), nonEmptyString).default({}),
  missingQuestions: z.array(missingQuestionSchema).max(10).default([]),
  shops: z.array(shopStateSchema).default([]),
  comparison: comparisonSchema.nullable().optional(),
  error: optionalNonEmptyString,
});

const eventEnvelope = z.object({
  // Both fields are optional on purpose. They are adapter-level replay metadata until the
  // canonical backend event contract defines stable identity and ordering semantics.
  eventId: optionalNonEmptyString,
  sequence: z.number().int().nonnegative().optional(),
  taskId: nonEmptyString,
  at: z.string().datetime(),
});

const quoteReadyDataSchema = z.object({
  callId: nonEmptyString,
  placeId: nonEmptyString,
  quote: quoteSchema,
  transcript: transcriptSchema.optional(),
}).superRefine((data, context) => {
  const transcript = data.transcript ?? data.quote.transcript ?? [];
  addQuoteEvidenceIssues(data.quote, transcript, context, ["quote"]);
});

const knownEventSchema = z.discriminatedUnion("type", [
  eventEnvelope.extend({
    type: z.literal("task.created"),
    data: z.object({ requestText: optionalNonEmptyString }).default({}),
  }),
  eventEnvelope.extend({
    type: z.literal("task.needs_input"),
    data: z.object({ questions: z.array(missingQuestionSchema).max(10) }),
  }),
  eventEnvelope.extend({
    type: z.literal("business.found"),
    data: z.object({ business: businessSchema }),
  }),
  eventEnvelope.extend({
    type: z.literal("call.started"),
    data: z.object({ callId: nonEmptyString, placeId: nonEmptyString }),
  }),
  eventEnvelope.extend({
    type: z.literal("call.talking"),
    data: z.object({ callId: nonEmptyString, placeId: nonEmptyString }),
  }),
  eventEnvelope.extend({
    type: z.literal("call.ended"),
    data: z.object({
      callId: nonEmptyString,
      placeId: nonEmptyString,
      outcome: callOutcomeSchema,
      durationSeconds: z.number().nonnegative().optional(),
    }),
  }),
  eventEnvelope.extend({
    type: z.literal("call.failed"),
    data: z.object({
      callId: nonEmptyString,
      placeId: nonEmptyString,
      reason: nonEmptyString,
      outcome: callOutcomeSchema.optional(),
    }),
  }),
  eventEnvelope.extend({
    type: z.literal("quote.ready"),
    data: quoteReadyDataSchema,
  }),
  eventEnvelope.extend({
    type: z.literal("comparison.ready"),
    data: z.object({ comparison: comparisonSchema }),
  }),
  eventEnvelope.extend({
    type: z.literal("task.failed"),
    data: z.object({ reason: nonEmptyString }),
  }),
]);

export const knownTaskEventTypes = new Set([
  "task.created",
  "task.needs_input",
  "business.found",
  "call.started",
  "call.talking",
  "call.ended",
  "call.failed",
  "quote.ready",
  "comparison.ready",
  "task.failed",
]);

export function parseTaskSnapshot(value) {
  return taskSnapshotSchema.safeParse(value);
}

export function assertTaskSnapshot(value) {
  return taskSnapshotSchema.parse(value);
}

export function parseTaskEvent(value) {
  return knownEventSchema.safeParse(value);
}

export function assertTaskEvent(value) {
  return knownEventSchema.parse(value);
}

export const mockScenarioSchema = z.object({
  snapshot: taskSnapshotSchema,
  events: z.array(
    z.object({
      delayMs: z.number().finite().nonnegative(),
      event: knownEventSchema,
    }),
  ).max(50),
}).superRefine((scenario, context) => {
  for (const [index, item] of scenario.events.entries()) {
    if (item.event.taskId !== scenario.snapshot.taskId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["events", index, "event", "taskId"],
        message: "Fixture event taskId must match the snapshot taskId.",
      });
    }
  }
});

export function assertMockScenario(value) {
  return mockScenarioSchema.parse(value);
}
