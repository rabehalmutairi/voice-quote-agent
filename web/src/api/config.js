const DEFAULT_API_BASE_URL = "/api";
const SUPPORTED_TRANSPORTS = new Set(["mock", "api"]);

const transportMode = import.meta.env.VITE_TRANSPORT ?? (import.meta.env.MODE === "mock" ? "mock" : "api");

export const frontendConfig = Object.freeze({
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL,
  transportMode,
});

/**
 * Resolves a backend path while preserving the same-origin proxy prefix.
 */
export function resolveApiUrl(path) {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) {
    throw new TypeError("API paths must start with '/'.");
  }

  return `${frontendConfig.apiBaseUrl.replace(/\/+$/, "")}${path}`;
}

/**
 * API mode talks to R5's mock server; mock mode keeps the standalone fixtures.
 */
export function assertSupportedTransport() {
  if (!SUPPORTED_TRANSPORTS.has(frontendConfig.transportMode)) {
    throw new Error("VITE_TRANSPORT must be 'api' or 'mock'.");
  }

  return frontendConfig.transportMode;
}
