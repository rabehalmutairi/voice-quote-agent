import { describe, expect, it } from "vitest";
import {
  assertMockScenario,
  parseTaskEvent,
  parseTaskSnapshot,
} from "./provisionalSchemas";
import { foundationScenario } from "../mocks/scenarios/foundationScenario";
import { createQuickCallScenario, quickCallCandidates } from "../mocks/scenarios/quickCallScenario";
import { createInquiryDraft } from "../features/quickCall/inquiryModel";

describe("provisional frontend schemas", () => {
  it("accepts answer-only results and rejects evidence in an agent turn", () => {
    const draft = createInquiryDraft({ query: "محل طباعة", area: "الملقا", questions: ["تطبعون A2؟"] });
    const scenario = createQuickCallScenario(draft, quickCallCandidates[0]);
    expect(() => assertMockScenario(scenario)).not.toThrow();
    const quoteEvent = scenario.events.find(({ event }) => event.type === "quote.ready").event;
    quoteEvent.data.transcript[1].speaker = "agent";
    expect(parseTaskEvent(quoteEvent).success).toBe(false);
  });
  it("accepts the complete foundation scenario", () => {
    expect(() => assertMockScenario(foundationScenario)).not.toThrow();
  });

  it("requires evidence for found values", () => {
    const invalid = foundationScenario.events.find(({ event }) => event.type === "quote.ready");
    const malformed = structuredClone(invalid.event);
    malformed.data.quote.options[0].priceSar = { status: "found", value: 450 };

    expect(parseTaskEvent(malformed).success).toBe(false);
  });

  it("accepts synthetic transcript turns with quote-ready fixture evidence", () => {
    const quoteEvent = foundationScenario.events.find(
      ({ event }) => event.type === "quote.ready" && event.data.quote.options[0].priceSar.value === 450,
    );
    const enriched = structuredClone(quoteEvent.event);
    enriched.data.transcript[2].text = "  اَلتجاري   بأربعمية وخمسين! ";

    expect(parseTaskEvent(enriched).success).toBe(true);
  });

  it.each([
    ["missing transcript turn", (event) => {
      delete event.data.quote.options[0].priceSar.evidenceTurn;
    }],
    ["mismatched evidence quote", (event) => {
      event.data.quote.options[0].priceSar.evidenceQuote = "سعر غير موجود";
    }],
    ["agent-speaker evidence", (event) => {
      event.data.transcript[2].speaker = "agent";
    }],
  ])("rejects %s", (_description, mutate) => {
    const quoteEvent = foundationScenario.events.find(({ event }) => event.type === "quote.ready");
    const malformed = structuredClone(quoteEvent.event);
    mutate(malformed);

    expect(parseTaskEvent(malformed).success).toBe(false);
  });

  it("rejects evidence values with the wrong field type", () => {
    const quoteEvent = foundationScenario.events.find(({ event }) => event.type === "quote.ready");
    const malformed = structuredClone(quoteEvent.event);
    malformed.data.quote.options[0].priceSar.value = "450";

    expect(parseTaskEvent(malformed).success).toBe(false);
  });

  it("accepts a semantically valid ranked comparison", () => {
    const comparisonEvent = foundationScenario.events.find(({ event }) => event.type === "comparison.ready");
    const ranked = structuredClone(comparisonEvent.event);
    ranked.data.comparison = {
      status: "ranked",
      basis: "commercial price",
      ranking: [
        { placeId: "place_1", rank: 1, reason: "lowest price" },
        { placeId: "place_2", rank: 2, reason: "higher price" },
      ],
      excluded: [],
      cannotCompareReasons: [],
    };

    expect(parseTaskEvent(ranked).success).toBe(true);
  });

  it.each([
    ["a ranked comparison without a ranking", (comparison) => {
      comparison.status = "ranked";
      comparison.ranking = [];
    }],
    ["duplicate ranking positions", (comparison) => {
      comparison.ranking.push({ placeId: "place_2", rank: 1, reason: "same rank" });
    }],
    ["cannot-compare without a reason", (comparison) => {
      comparison.status = "cannot_compare";
      comparison.ranking = [];
      comparison.cannotCompareReasons = [];
    }],
  ])("rejects %s", (_description, mutate) => {
    const comparisonEvent = foundationScenario.events.find(({ event }) => event.type === "comparison.ready");
    const malformed = structuredClone(comparisonEvent.event);
    mutate(malformed.data.comparison);

    expect(parseTaskEvent(malformed).success).toBe(false);
  });

  it("requires nested business fields for discovery events", () => {
    const invalid = foundationScenario.events.find(({ event }) => event.type === "business.found");
    const malformed = structuredClone(invalid.event);
    delete malformed.data.business.name;

    expect(parseTaskEvent(malformed).success).toBe(false);
  });

  it("accepts additional shops from discovery for future backup candidates", () => {
    const snapshot = structuredClone(foundationScenario.snapshot);
    snapshot.shops = Array.from({ length: 4 }, (_, index) => ({
      placeId: `place_${index}`,
      name: `Shop ${index}`,
      status: "discovered",
    }));

    expect(parseTaskSnapshot(snapshot).success).toBe(true);
  });

  it("rejects a fixture event whose task identity differs from the snapshot", () => {
    const invalid = structuredClone(foundationScenario);
    invalid.events[0].event.taskId = "other_task";

    expect(() => assertMockScenario(invalid)).toThrow("taskId");
  });
});
