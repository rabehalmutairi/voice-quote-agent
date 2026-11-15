import { foundationScenario } from "./foundationScenario";

const taskId = "fixture_cannot_compare";
const scenario = structuredClone(foundationScenario);

scenario.snapshot.taskId = taskId;
scenario.events = scenario.events.map(({ delayMs, event }) => ({
  delayMs,
  event: {
    ...event,
    eventId: event.eventId.replace("evt_foundation", "evt_cannot_compare"),
    taskId,
  },
}));

const comparisonEvent = scenario.events.find(({ event }) => event.type === "comparison.ready");
comparisonEvent.event.data.comparison = {
  status: "cannot_compare",
  basis: "نوع القطعة والسعر والضمان",
  ranking: [],
  excluded: [],
  cannotCompareReasons: [
    "المحل الأول أعطى سعراً لقطعة تجارية، والمحل الثاني أعطى سعراً لقطعة أصلية.",
    "ما نقدر نرتب الأسعار بدون مقارنة النوع نفسه.",
  ],
};

export const cannotCompareScenario = scenario;
