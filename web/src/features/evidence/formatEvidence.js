const PART_TYPE_LABELS = {
  original: "أصلي",
  pulled_original: "أصلي سحب",
  commercial: "تجاري",
  unknown: "غير محدد",
};

const AVAILABILITY_LABELS = {
  in_stock: "متوفر الآن",
  needs_order: "يحتاج طلبًا",
  out_of_stock: "غير متوفر",
  available: "متوفرة",
  unavailable: "غير متوفرة",
  unknown: "غير محددة",
};

export function formatNumber(value) {
  return new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 2 }).format(value);
}

export function formatPartType(value) {
  return PART_TYPE_LABELS[value] ?? "غير محدد";
}

export function formatCurrency(value) {
  return `${formatNumber(value)} ريال`;
}

export function formatDays(value) {
  return `${formatNumber(value)} يوم`;
}

export function formatMinutes(value) {
  return `${formatNumber(value)} دقيقة`;
}

export function formatAvailability(value) {
  return AVAILABILITY_LABELS[value] ?? "غير محددة";
}

export function formatCondition(value) {
  return ({ new: "جديد", used: "مستعمل", refurbished: "مجدد", unknown: "غير محدد" })[value] ?? "غير محدد";
}

export function formatEvidenceValue(field, formatter = String) {
  if (field?.valueMin !== undefined && field?.valueMax !== undefined) return `${formatter(field.valueMin)} – ${formatter(field.valueMax)}`;
  return formatter(field?.value);
}
