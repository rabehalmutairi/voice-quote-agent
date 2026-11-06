import { describe, expect, it } from "vitest";
import { assertSupportedTransport, frontendConfig, resolveApiUrl } from "./config";

describe("frontend configuration", () => {
  it("defaults to the mock transport and a local API base", () => {
    expect(frontendConfig.transportMode).toBe("mock");
    expect(frontendConfig.apiBaseUrl).toBe("http://localhost:8000");
    expect(assertSupportedTransport()).toBe("mock");
  });

  it("resolves public API paths without contacting the backend", () => {
    expect(resolveApiUrl("/tasks")).toBe("http://localhost:8000/tasks");
    expect(() => resolveApiUrl("tasks")).toThrow("start with '/'");
  });
});
