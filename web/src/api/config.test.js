import { describe, expect, it } from "vitest";
import { assertSupportedTransport, frontendConfig, resolveApiUrl } from "./config";

describe("frontend configuration", () => {
  it("uses the fixture test transport and the same-origin API proxy", () => {
    expect(frontendConfig.transportMode).toBe("mock");
    expect(frontendConfig.apiBaseUrl).toBe("/api");
    expect(assertSupportedTransport()).toBe("mock");
  });

  it("resolves public API paths without contacting the backend", () => {
    expect(resolveApiUrl("/tasks")).toBe("/api/tasks");
    expect(() => resolveApiUrl("//other.example/tasks")).toThrow();
    expect(() => resolveApiUrl("tasks")).toThrow("start with '/'");
  });
});
