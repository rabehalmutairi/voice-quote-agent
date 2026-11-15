const GOOGLE_MAPS_HOSTS = new Set([
  "google.com",
  "www.google.com",
  "maps.google.com",
  "maps.app.goo.gl",
  "goo.gl",
]);

function readFirstString(shop, fieldNames) {
  for (const fieldName of fieldNames) {
    const value = shop?.[fieldName];

    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

/**
 * Reads the frontend's normalized business fields and the canonical snake_case
 * aliases without inventing fallback values for missing optional metadata.
 */
export function getShopAddress(shop) {
  return readFirstString(shop, ["address", "address_label"]);
}

export function getShopPhone(shop) {
  const phone = readFirstString(shop, ["phoneE164", "phone_e164"]);

  return phone && /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

export function getShopNumberType(shop) {
  return readFirstString(shop, ["numberType", "number_type"]);
}

export function getShopRating(shop) {
  const value = shop?.rating;

  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 5
    ? value
    : null;
}

export function getShopOpenNow(shop) {
  const value = shop?.openNow ?? shop?.open_now;

  return typeof value === "boolean" ? value : null;
}

export function getShopPhoneHref(shop) {
  const phone = getShopPhone(shop);

  return phone ? `tel:${phone}` : null;
}

function isGoogleMapsUrl(url) {
  const hostname = url.hostname.toLowerCase();

  if (hostname === "maps.google.com" || hostname === "maps.app.goo.gl") {
    return true;
  }

  if (!GOOGLE_MAPS_HOSTS.has(hostname)) {
    return false;
  }

  return url.pathname === "/maps" || url.pathname.startsWith("/maps/");
}

export function getShopMapsHref(shop) {
  const mapsUrl = readFirstString(shop, ["mapsUrl", "maps_url"]);

  if (!mapsUrl) {
    return null;
  }

  try {
    const url = new URL(mapsUrl);

    if (!["http:", "https:"].includes(url.protocol) || !isGoogleMapsUrl(url)) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}
