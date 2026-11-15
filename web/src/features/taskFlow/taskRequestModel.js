/**
 * Local frontend request draft. target follows ADR 002's proposed contract;
 * this draft must be mapped by a future API adapter after R1's contract PR.
 *
 * Electronics repair and stock checks use their template's required slots.
 * Missing fields are preserved for follow-up questions, never filled with guesses.
 */

export const TASK_SPEC_CATEGORY = "electronics_repair";
export const TASK_SPEC_MAX_BUSINESSES = 3;
export const TASK_SPEC_DEFAULT_RADIUS_M = 5000;

export const REQUIRED_TASK_SLOTS = Object.freeze([
  "device_model",
  "repair_type",
  "area",
]);

const TEXT_TASK_SLOTS = Object.freeze(["device_model", "repair_type", "item"]);

const TASK_SLOT_PROMPTS = Object.freeze({
  item: "وش المنتج أو القطعة اللي تبي تتأكد من توفرها؟",
  device_model: "وش نوع الجهاز وموديله بالضبط؟",
  repair_type: "وش تبي تصلّح؟ الشاشة، البطارية، ولا منفذ الشحن؟",
  area: "وين تبي المحلات تكون؟",
});

export const SUPPORTED_SERVICE_MODES = Object.freeze([
  Object.freeze({
    value: TASK_SPEC_CATEGORY,
    label: "إصلاح الأجهزة الإلكترونية",
  }),
  Object.freeze({ value: "stock_check", label: "فحص توفر منتج أو قطعة" }),
]);

export const SUPPORTED_DEVICE_TYPES = Object.freeze([
  "آيفون",
  "سامسونج",
  "جوال آخر",
]);

export const SUPPORTED_REPAIR_TYPES = Object.freeze([
  "تغيير شاشة",
  "تغيير بطارية",
  "إصلاح منفذ الشحن",
]);

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isPositiveFiniteNumber(value) {
  return Number.isFinite(value) && value > 0;
}

function normalizeDeviceModel(deviceType, deviceModel) {
  const type = normalizeText(deviceType);
  const model = normalizeText(deviceModel);

  if (!model) {
    return "";
  }

  if (!type || model.startsWith(type)) {
    return model;
  }

  return `${type} ${model}`;
}

function normalizeArea(area) {
  if (typeof area === "string") {
    const label = normalizeText(area);
    return label ? { label, radius_m: TASK_SPEC_DEFAULT_RADIUS_M } : null;
  }

  if (!area || typeof area !== "object") {
    return null;
  }

  const label = normalizeText(area.label);
  if (!label) {
    return null;
  }

  const normalizedArea = {
    label,
    radius_m: isPositiveFiniteNumber(area.radius_m)
      ? area.radius_m
      : TASK_SPEC_DEFAULT_RADIUS_M,
  };

  if (Number.isFinite(area.lat)) {
    normalizedArea.lat = area.lat;
  }

  if (Number.isFinite(area.lng)) {
    normalizedArea.lng = area.lng;
  }

  return normalizedArea;
}

function normalizeMaxBusinesses(value) {
  const maxBusinesses = value === undefined ? TASK_SPEC_MAX_BUSINESSES : value;

  if (
    !Number.isInteger(maxBusinesses)
    || maxBusinesses < 1
    || maxBusinesses > TASK_SPEC_MAX_BUSINESSES
  ) {
    throw new TypeError(
      `max_businesses must be an integer between 1 and ${TASK_SPEC_MAX_BUSINESSES}.`,
    );
  }

  return maxBusinesses;
}

function findMissingSlots(slots, area, category = TASK_SPEC_CATEGORY) {
  const required = category === "stock_check" ? ["item", "area"] : REQUIRED_TASK_SLOTS;
  return required.filter((slot) => (
    slot === "area" ? !area : !slots[slot]
  ));
}

function assertSlotValues(slots) {
  for (const slot of TEXT_TASK_SLOTS) {
    if (slot in slots && (typeof slots[slot] !== "string" || !slots[slot].trim())) {
      throw new TypeError(`TaskSpec ${slot} must be a non-empty string when provided.`);
    }
  }
}

function assertArea(area) {
  if (area === null) {
    return;
  }

  if (!area || typeof area !== "object" || Array.isArray(area)) {
    throw new TypeError("TaskSpec area must be an object or null.");
  }

  if (typeof area.label !== "string" || !area.label.trim()) {
    throw new TypeError("TaskSpec area.label must be non-empty.");
  }

  if (!isPositiveFiniteNumber(area.radius_m)) {
    throw new TypeError("TaskSpec area.radius_m must be positive.");
  }

  for (const coordinate of ["lat", "lng"]) {
    if (coordinate in area && !Number.isFinite(area[coordinate])) {
      throw new TypeError(`TaskSpec area.${coordinate} must be finite when provided.`);
    }
  }
}

/**
 * @typedef {Object} TaskSpec
 * @property {string} category
 * @property {string} request_text
 * @property {{device_model?: string, repair_type?: string, item?: string}} slots
 * @property {null} target Proposed ADR 002 field for Compare Shops drafts.
 * @property {{label: string, radius_m: number, lat?: number, lng?: number} | null} area
 * @property {number} max_businesses
 * @property {string[]} missing_slots
 */

/**
 * Builds a local TaskSpec draft from the request form without merging detail fields
 * into request_text. Empty planner slots remain empty and are exposed in
 * missing_slots for the follow-up flow.
 *
 * @param {{ requestText: string, category?: string, serviceMode?: string, deviceType?: string, deviceModel?: string, repairType?: string, item?: string, area?: string | Object, maxBusinesses?: number }} input
 * @returns {TaskSpec}
 */
export function createTaskSpec(input = {}) {
  const requestText = normalizeText(input.requestText);
  if (!requestText) {
    throw new TypeError("request_text must be a non-empty string.");
  }

  const category = normalizeText(input.category ?? input.serviceMode) || TASK_SPEC_CATEGORY;
  if (![TASK_SPEC_CATEGORY, "stock_check"].includes(category)) {
    throw new TypeError("Supported categories are electronics_repair and stock_check.");
  }

  const deviceModel = normalizeDeviceModel(input.deviceType, input.deviceModel);
  const repairType = normalizeText(input.repairType);
  const area = normalizeArea(input.area);
  const slots = {};

  if (category === "stock_check" && normalizeText(input.item)) slots.item = normalizeText(input.item);
  if (category === TASK_SPEC_CATEGORY && deviceModel) {
    slots.device_model = deviceModel;
  }

  if (category === TASK_SPEC_CATEGORY && repairType) {
    slots.repair_type = repairType;
  }

  return {
    category,
    target: null,
    request_text: requestText,
    slots,
    area,
    max_businesses: normalizeMaxBusinesses(input.maxBusinesses),
    missing_slots: findMissingSlots(slots, area, category),
  };
}

/**
 * Maps canonical missing slots to the Arabic planner prompts used by the fixture
 * compatibility boundary. The slot keys remain canonical; only the prompt copy is
 * frontend presentation data.
 *
 * @param {string[]} missingSlots
 * @returns {Array<{key: string, prompt: string}>}
 */
export function createMissingSlotQuestions(missingSlots = []) {
  if (!Array.isArray(missingSlots)) {
    throw new TypeError("missing_slots must be an array.");
  }

  return [...new Set(missingSlots)].map((key) => {
    if (!TASK_SLOT_PROMPTS[key]) {
      throw new TypeError(`Unsupported missing slot: ${key}`);
    }

    return { key, prompt: TASK_SLOT_PROMPTS[key] };
  });
}

/**
 * Validates the small canonical surface consumed by the fixture compatibility
 * boundary. This is intentionally not a replacement for backend contract
 * validation.
 *
 * @param {TaskSpec} taskSpec
 * @returns {TaskSpec}
 */
export function assertTaskSpec(taskSpec) {
  if (!taskSpec || typeof taskSpec !== "object") {
    throw new TypeError("A TaskSpec object is required.");
  }

  if (![TASK_SPEC_CATEGORY, "stock_check"].includes(taskSpec.category)) {
    throw new TypeError("Supported categories are electronics_repair and stock_check.");
  }

  if (typeof taskSpec.request_text !== "string" || taskSpec.request_text.trim().length === 0) {
    throw new TypeError("TaskSpec request_text must be non-empty.");
  }

  if (!taskSpec.slots || typeof taskSpec.slots !== "object" || Array.isArray(taskSpec.slots)) {
    throw new TypeError("TaskSpec slots must be an object.");
  }

  assertSlotValues(taskSpec.slots);
  assertArea(taskSpec.area);
  normalizeMaxBusinesses(taskSpec.max_businesses);

  if (!Array.isArray(taskSpec.missing_slots)) {
    throw new TypeError("TaskSpec missing_slots must be an array.");
  }

  createMissingSlotQuestions(taskSpec.missing_slots);

  const expectedMissingSlots = findMissingSlots(taskSpec.slots, taskSpec.area, taskSpec.category);
  if (
    taskSpec.missing_slots.length !== expectedMissingSlots.length
    || taskSpec.missing_slots.some((slot, index) => slot !== expectedMissingSlots[index])
  ) {
    throw new TypeError("TaskSpec missing_slots does not match the supplied slots and area.");
  }

  return taskSpec;
}

/**
 * Compatibility adapter for the current mock transport, which still accepts the
 * legacy request string. The structured TaskSpec remains the integration payload
 * for a future transport.
 *
 * @param {TaskSpec} taskSpec
 * @returns {string}
 */
export function toFixtureTransportRequest(taskSpec) {
  return assertTaskSpec(taskSpec).request_text;
}
