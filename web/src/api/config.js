const DEFAULT_API_BASE_URL = "http://localhost:8000";
const SUPPORTED_TRANSPORTS = new Set(["mock", "real"]);

const rawTransport = import.meta.env.VITE_TRANSPORT ?? "mock";
const transportMode = SUPPORTED_TRANSPORTS.has(rawTransport) ? rawTransport : "mock";

export const frontendConfig = Object.freeze({
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL,
  transportMode,
});

/**
 * Resolves a future backend path without performing network I/O in PR 1.
 */
export function resolveApiUrl(path) {
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new TypeError("API paths must start with '/'.");
  }

  return new URL(path, frontendConfig.apiBaseUrl).toString();
}

/**
 * PR 1 deliberately supports only the fixture transport. This boundary makes the
 * configuration explicit without pretending real API/SSE connectivity exists yet.
 */
export function assertSupportedTransport() {
  if (frontendConfig.transportMode !== "mock") {
    throw new Error("The real transport is reserved for a later integration phase.");
  }

  return frontendConfig.transportMode;
}
