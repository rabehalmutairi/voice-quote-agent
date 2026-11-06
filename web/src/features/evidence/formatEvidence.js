const PART_TYPE_LABELS = {
  original: "أصلي",
  pulled_original: "أصلي سحب",
  commercial: "تجاري",
  unknown: "غير محدد",
};

const AVAILABILITY_LABELS = {
  available: "متوفرة",
  unavailable: "غير متوفرة",
  unknown: "غير محددة",
};

export function formatNumber(value) {
  return new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 0 }).format(value);
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
