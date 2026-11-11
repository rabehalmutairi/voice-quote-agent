import { describe, expect, it } from "vitest";
import { createQuickCallMockTransport } from "./quickCallMockTransport";
import { createInquiryDraft } from "../features/quickCall/inquiryModel";

import { createQuickCallScenario, quickCallCandidates } from "../mocks/scenarios/quickCallScenario";

const request = () => createInquiryDraft({ query: "محل طباعة", area: "الملقا", questions: ["تطبعون A2 اليوم؟"] });

describe("Quick Call mock boundary", () => {
  it("requires a discovered callable business and explicit start", async () => {
    const transport = createQuickCallMockTransport();
    const task = await transport.createTask(request());
    await expect(transport.startTask(task.taskId)).rejects.toThrow();
    const candidates = await transport.findCandidates(task.taskId);
    await expect(transport.selectBusiness(task.taskId, "arbitrary-number")).rejects.toThrow();
    await expect(transport.selectBusiness(task.taskId, candidates.find((item) => !item.callable).placeId)).rejects.toThrow();
    const selected = await transport.selectBusiness(task.taskId, candidates.find((item) => item.callable).placeId);
    expect(selected.phase).toBe("idle");
    expect(selected.shops).toEqual([]);
    expect((await transport.startTask(task.taskId)).phase).toBe("discovering");
    await expect(transport.startTask(task.taskId)).rejects.toThrow();
  });

  it("keeps the proposed target local and does not accept actions or personal data", () => {
    expect(request()).toMatchObject({ target: { business: null }, max_businesses: 1, missing_slots: ["business"] });
    expect(() => createInquiryDraft({ query: "محل طباعة", area: "الملقا", questions: ["احجز لي موعد"] })).toThrow();
    expect(() => createInquiryDraft({ query: "0501234567", area: "الملقا", questions: ["وش السعر؟"] })).toThrow();
  });
});

it("does not substitute A2 answers for unsupported printing questions", () => {
  const scenario = createQuickCallScenario({ request_text: "استفسار طباعة", custom_questions: ["تطبعون A3؟", "تطبعون على القماش؟", "تطبعون A2 اليوم؟"] }, quickCallCandidates[0]);
  const answers = scenario.events.find(({ event }) => event.type === "quote.ready").event.data.quote.answers;
  expect(answers.map((answer) => answer.status)).toEqual(["unclear", "unclear", "found"]);
  expect(answers[0].summary_ar).not.toContain("A2");
});
