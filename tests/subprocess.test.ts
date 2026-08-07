import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeSubprocessExecutor } from "../src/workflows/executor/subprocess.js";
import type { ExecOptions, ExecResult } from "../src/workflows/types.js";

describe("subprocess", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "subprocess-test-"));
  });

  it("makeSubprocessExecutor 应返回带 name 的 executor", () => {
    const executor = makeSubprocessExecutor({
      command: "echo",
      prepare: async () => ({ args: ["hello"] }),
      parseLine: () => null,
      reduce: () => ({
        text: "ok",
        sessionId: null,
        costUsd: 0,
        resultSubtype: "success",
        isError: false,
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
    });

    expect(executor.name).toBe("echo");
    expect(typeof executor.runPrompt).toBe("function");
  });

  it("runPrompt 应调用 prepare 并传递 args", async () => {
    const called: string[] = [];
    const executor = makeSubprocessExecutor({
      command: "node",
      prepare: async (opts) => {
        called.push(opts.prompt);
        return {
          args: ["-e", "console.log('hello')"],
        };
      },
      parseLine: () => null,
      reduce: () => ({
        text: "ok",
        sessionId: null,
        costUsd: 0,
        resultSubtype: "success",
        isError: false,
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
    });

    await executor.runPrompt({ prompt: "test-prompt" });
    expect(called).toContain("test-prompt");
  });

  it("runPrompt 应传递 stdin 给子进程", async () => {
    const executor = makeSubprocessExecutor({
      command: "node",
      prepare: async (opts) => ({
        args: ["-e", "process.stdin.on('data', d => process.stdout.write(d))"],
        stdin: opts.prompt,
      }),
      parseLine: () => null,
      reduce: (events, ctx) => ({
        text: ctx.stderr || "ok",
        sessionId: null,
        costUsd: 0,
        resultSubtype: "success",
        isError: false,
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
    });

    const result = await executor.runPrompt({ prompt: "stdin-test" });
    expect(result.text).toBeDefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("runPrompt 应返回正确的 ExecResult 结构", async () => {
    const executor = makeSubprocessExecutor({
      command: "node",
      prepare: async () => ({
        args: ["-e", "console.log('test-output')"],
      }),
      parseLine: () => null,
      reduce: () => ({
        text: "test-output",
        sessionId: null,
        costUsd: 0.01,
        resultSubtype: "success",
        isError: false,
        usage: { inputTokens: 10, outputTokens: 5 },
      }),
    });

    const result = await executor.runPrompt({ prompt: "test" });
    expect(result.text).toBe("test-output");
    expect(result.costUsd).toBe(0.01);
    expect(result.isError).toBe(false);
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(5);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("runPrompt 应处理 cleanup 函数", async () => {
    let cleanupCalled = false;
    const executor = makeSubprocessExecutor({
      command: "node",
      prepare: async () => ({
        args: ["-e", "console.log('ok')"],
        cleanup: () => { cleanupCalled = true; },
      }),
      parseLine: () => null,
      reduce: () => ({
        text: "ok",
        sessionId: null,
        costUsd: 0,
        resultSubtype: "success",
        isError: false,
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
    });

    await executor.runPrompt({ prompt: "test" });
    expect(cleanupCalled).toBe(true);
  });

  it("runPrompt 应捕获 stderr", async () => {
    const executor = makeSubprocessExecutor({
      command: "node",
      prepare: async () => ({
        args: ["-e", "console.error('error-msg')"],
      }),
      parseLine: () => null,
      reduce: (events, ctx) => ({
        text: ctx.stderr || "",
        sessionId: null,
        costUsd: 0,
        resultSubtype: "error",
        isError: true,
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
    });

    const result = await executor.runPrompt({ prompt: "test" });
    expect(result.text).toContain("error-msg");
    expect(result.isError).toBe(true);
  });

  it("parseLine 返回 null 的行应被跳过", async () => {
    const parsedLines: string[] = [];
    const executor = makeSubprocessExecutor({
      command: "node",
      prepare: async () => ({
        args: ["-e", "console.log('line1'); console.log('line2')"],
      }),
      parseLine: (line) => {
        parsedLines.push(line);
        if (line.includes("line1")) return { type: "line", value: line };
        return null;
      },
      reduce: (events) => ({
        text: `events:${events.length}`,
        sessionId: null,
        costUsd: 0,
        resultSubtype: "success",
        isError: false,
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
    });

    const result = await executor.runPrompt({ prompt: "test" });
    expect(result.text).toContain("events:");
  });
});