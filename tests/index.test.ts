import { describe, it, expect } from "vitest";
import * as workflows from "../src/workflows/index.js";

describe("index (public API)", () => {
  it("应导出 runWorkflow", () => {
    expect(typeof workflows.runWorkflow).toBe("function");
  });

  it("应导出 builtinExecutors", () => {
    expect(workflows.builtinExecutors).toBeDefined();
    expect(workflows.builtinExecutors.claude).toBeDefined();
    expect(workflows.builtinExecutors.codex).toBeDefined();
  });

  it("应导出 claudeExecutor", () => {
    expect(workflows.claudeExecutor).toBeDefined();
    expect(workflows.claudeExecutor.name).toBe("claude");
  });

  it("应导出 codexExecutor", () => {
    expect(workflows.codexExecutor).toBeDefined();
    expect(workflows.codexExecutor.name).toBe("codex");
  });

  it("应导出 buildClaudeArgs", () => {
    expect(typeof workflows.buildClaudeArgs).toBe("function");
    const args = workflows.buildClaudeArgs({ prompt: "test" });
    expect(args).toContain("--print");
    expect(args).toContain("--verbose");
  });

  it("应导出 buildCodexArgs", () => {
    expect(typeof workflows.buildCodexArgs).toBe("function");
  });

  it("应导出 makeSubprocessExecutor", () => {
    expect(typeof workflows.makeSubprocessExecutor).toBe("function");
  });

  it("应导出所有类型", () => {
    expect(workflows.TOTAL_AGENT_CAP).toBe(1000);
  });

  it("应导出 reduceStreamJsonEvents", () => {
    expect(typeof workflows.reduceStreamJsonEvents).toBe("function");
  });

  it("应导出 reduceCodexEvents", () => {
    expect(typeof workflows.reduceCodexEvents).toBe("function");
  });

  it("应导出 parseStreamJsonLine", () => {
    expect(typeof workflows.parseStreamJsonLine).toBe("function");
  });

  it("应导出 parseCodexJsonLine", () => {
    expect(typeof workflows.parseCodexJsonLine).toBe("function");
  });
});
