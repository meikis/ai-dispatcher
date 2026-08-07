import { describe, it, expect } from "vitest";
import { TOTAL_AGENT_CAP } from "../src/workflows/types.js";

describe("types", () => {
  it("TOTAL_AGENT_CAP 应等于 1000", () => {
    expect(TOTAL_AGENT_CAP).toBe(1000);
  });

  it("TOTAL_AGENT_CAP 应为正数", () => {
    expect(TOTAL_AGENT_CAP).toBeGreaterThan(0);
  });
});
