import { foundationScenario } from "./foundationScenario";

const taskId = "fixture_missing_input";

export const missingInputScenario = {
  snapshot: {
    ...foundationScenario.snapshot,
    taskId,
    phase: "needs_input",
    missingQuestions: [
      { key: "device_model", prompt: "وش نوع الجهاز وموديله بالضبط؟" },
      { key: "area", prompt: "وين تبي المحلات تكون؟" },
    ],
  },
  events: foundationScenario.events.map(({ delayMs, event }) => ({
    delayMs,
    event: {
      ...event,
      eventId: event.eventId.replace("evt_foundation", "evt_missing_input"),
      taskId,
    },
  })),
};
