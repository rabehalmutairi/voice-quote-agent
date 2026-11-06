import { assertTaskTransport } from "./transportContract";
import { describe, expect, it } from "vitest";

describe("assertTaskTransport", () => {
  it("accepts a transport implementing the shared frontend interface", () => {
    const transport = {
      createTask() {},
      submitAnswers() {},
      startTask() {},
      getTask() {},
      subscribe() {},
    };

    expect(assertTaskTransport(transport)).toBe(transport);
  });

  it("rejects incomplete transports", () => {
    expect(() => assertTaskTransport({})).toThrow("createTask");
  });
});
