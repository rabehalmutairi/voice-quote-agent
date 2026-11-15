export function createCompareDraft() {
  return { inputMode: "text", category: "electronics_repair", request: "", note: "", deviceType: "", deviceModel: "", repairType: "", item: "", area: "" };
}

export function createQuickDraft() {
  return { query: "", area: "", questions: [""], previewOutcome: "answered" };
}

/** Describe only the values the user supplied; this is not language inference. */
export function describeRequest(draft) {
  const value = (key) => draft[key]?.trim() ?? "";
  const subject = draft.category === "stock_check"
    ? `فحص توفر ${value("item")}`
    : [value("repairType"), value("deviceType"), value("deviceModel")].filter(Boolean).join(" ");
  return [subject.trim(), value("area") && `في ${value("area")}`, value("note")].filter(Boolean).join("، ");
}

export function requiredDraftFields(category) {
  return category === "stock_check" ? ["item", "area"] : ["deviceModel", "repairType", "area"];
}
