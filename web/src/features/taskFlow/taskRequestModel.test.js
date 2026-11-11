import { describe, expect, it } from "vitest";
import {
  assertTaskSpec,
  createMissingSlotQuestions,
  createTaskSpec,
  TASK_SPEC_CATEGORY,
  toFixtureTransportRequest,
} from "./taskRequestModel";

describe("task request model", () => {
  it("builds a stock-check draft without repair slots", () => {
    const draft = createTaskSpec({ category: "stock_check", requestText: "هل آيفون 16 متوفر؟", item: "آيفون 16", area: "الملقا" });
    expect(draft).toMatchObject({ category: "stock_check", target: null, slots: { item: "آيفون 16" }, missing_slots: [] });
    expect(assertTaskSpec(draft)).toBe(draft);
    expect(createTaskSpec({ category: "stock_check", requestText: "هل متوفر؟" }).missing_slots).toEqual(["item", "area"]);
  });
  it("creates the canonical electronics-repair TaskSpec without flattening typed fields", () => {
    const taskSpec = createTaskSpec({
      requestText: "  أبي أغير شاشة جوالي  ",
      deviceType: "آيفون",
      deviceModel: "15 برو",
      repairType: "تغيير شاشة",
      area: "حي الملقا",
    });

    expect(taskSpec).toEqual({
      category: TASK_SPEC_CATEGORY,
      target: null,
      request_text: "أبي أغير شاشة جوالي",
      slots: {
        device_model: "آيفون 15 برو",
        repair_type: "تغيير شاشة",
      },
      area: {
        label: "حي الملقا",
        radius_m: 5000,
      },
      max_businesses: 3,
      missing_slots: [],
    });
  });

  it("does not inject iPhone, screen, or Riyadh data into an unrelated request", () => {
    const taskSpec = createTaskSpec({ requestText: "أبي أصلح المكيف" });

    expect(taskSpec.request_text).toBe("أبي أصلح المكيف");
    expect(taskSpec.slots).toEqual({});
    expect(taskSpec.area).toBeNull();
    expect(taskSpec.missing_slots).toEqual(["device_model", "repair_type", "area"]);
  });

  it("rejects categories outside repair and stock checks", () => {
    expect(createTaskSpec({
      requestText: "أبي أغير بطارية جوالي",
      category: "electronics_repair",
    }).category).toBe(TASK_SPEC_CATEGORY);

    expect(() => createTaskSpec({
      requestText: "أبي أغير زيت السيارة",
      category: "car_maintenance",
    })).toThrow("Supported categories");
  });

  it("reports invalid and empty request data instead of fabricating a request", () => {
    expect(() => createTaskSpec({ requestText: "   " })).toThrow("request_text");
    expect(() => createTaskSpec({ requestText: "طلب صالح", maxBusinesses: 4 })).toThrow("max_businesses");
  });

  it("maps canonical missing slots to the approved Arabic follow-up prompts", () => {
    expect(createMissingSlotQuestions(["device_model", "repair_type", "area"])).toEqual([
      { key: "device_model", prompt: "وش نوع الجهاز وموديله بالضبط؟" },
      { key: "repair_type", prompt: "وش تبي تصلّح؟ الشاشة، البطارية، ولا منفذ الشحن؟" },
      { key: "area", prompt: "وين تبي المحلات تكون؟" },
    ]);
  });

  it("rejects a TaskSpec whose missing slots disagree with its supplied details", () => {
    const incomplete = createTaskSpec({ requestText: "أبي أغير شاشة جوالي" });

    expect(() => assertTaskSpec({ ...incomplete, missing_slots: [] })).toThrow(
      "missing_slots does not match",
    );
  });

  it("rejects malformed supplied slot and area values instead of starting an invalid task", () => {
    const complete = createTaskSpec({
      requestText: "أبي أغير شاشة آيفون 15 برو في حي الملقا",
      deviceType: "آيفون",
      deviceModel: "15 برو",
      repairType: "تغيير شاشة",
      area: "حي الملقا",
    });

    expect(() => assertTaskSpec({ ...complete, slots: { ...complete.slots, repair_type: 42 } }))
      .toThrow("repair_type must be a non-empty string");
    expect(() => assertTaskSpec({ ...complete, area: { ...complete.area, radius_m: 0 } }))
      .toThrow("area.radius_m must be positive");
  });

  it("keeps the current fixture boundary compatible without appending defaults", () => {
    const taskSpec = createTaskSpec({
      requestText: "أبي أغير بطارية سامسونج",
      deviceType: "سامسونج",
      deviceModel: "S24",
      repairType: "تغيير بطارية",
      area: "الرياض",
    });

    expect(toFixtureTransportRequest(taskSpec)).toBe("أبي أغير بطارية سامسونج");
  });
});
