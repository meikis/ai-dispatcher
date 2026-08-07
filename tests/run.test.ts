import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runWorkflow } from "../src/workflows/runtime/run.js";
import type { Executor, ExecResult, RunOptions } from "../src/workflows/types.js";

function makeMockExecutor(name: string): Executor {
  return {
    name,
    async runPrompt(opts) {
      return {
        text: `echo:${opts.prompt}`,
        sessionId: null,
        costUsd: 0.01,
        resultSubtype: "success",
        isError: false,
        usage: { inputTokens: 10, outputTokens: 5 },
        durationMs: 50,
      } as ExecResult;
    },
  };
}

describe("runWorkflow (integration)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "odw-test-"));
  });

  it("应通过内联脚本运行 workflow", async () => {
    const source = `
      export const meta = {
        name: 'test-inline',
        description: 'Integration test with inline script',
      };
      return { message: 'hello' };
    `;

    const result = await runWorkflow({
      script: source,
      baseDir: tmpDir,
      executors: { mock: makeMockExecutor("mock") },
    });

    expect(result.value).toEqual({ message: "hello" });
    expect(result.runId.startsWith("run-")).toBe(true);
    expect(result.runDir).toBe(path.join(tmpDir, result.runId));
  });

  it("应通过脚本路径运行 workflow", async () => {
    const scriptPath = path.join(tmpDir, "test-workflow.js");
    writeFileSync(scriptPath, `
      export const meta = {
        name: 'test-path',
        description: 'Integration test with file path',
      };
      return { source: 'file' };
    `);

    const result = await runWorkflow({
      scriptPath,
      baseDir: tmpDir,
      executors: { mock: makeMockExecutor("mock") },
    });

    expect(result.value).toEqual({ source: "file" });
  });

  it("应记录 agent 调用", async () => {
    const source = `
      export const meta = {
        name: 'agent-test',
        description: 'Test agent calling',
      };
      const greeting = await agent('hello world', { executor: 'mock' });
      return { greeting };
    `;

    const events: any[] = [];
    const result = await runWorkflow({
      script: source,
      baseDir: tmpDir,
      executors: { mock: makeMockExecutor("mock") },
      onEvent: (e) => events.push(e),
    });

    expect(result.value).toEqual({ greeting: "echo:hello world" });

    const agentStartEvents = events.filter((e) => e.type === "agent_start");
    const agentEndEvents = events.filter((e) => e.type === "agent_end");
    expect(agentStartEvents.length).toBeGreaterThan(0);
    expect(agentEndEvents.length).toBeGreaterThan(0);
  });

  it("应将 args 传递给脚本", async () => {
    const source = `
      export const meta = {
        name: 'args-test',
        description: 'Test args passing',
      };
      return { received: args };
    `;

    const result = await runWorkflow({
      script: source,
      baseDir: tmpDir,
      args: { name: "test-project", count: 42 },
      executors: { mock: makeMockExecutor("mock") },
    });

    expect(result.value).toEqual({ received: { name: "test-project", count: 42 } });
  });

  it("应支持多 agent 并行", async () => {
    const source = `
      export const meta = {
        name: 'parallel-test',
        description: 'Test parallel agent execution',
      };
      const results = await parallel([
        () => agent('task-1', { executor: 'mock', label: 't1' }),
        () => agent('task-2', { executor: 'mock', label: 't2' }),
        () => agent('task-3', { executor: 'mock', label: 't3' }),
      ]);
      return { results };
    `;

    const result = await runWorkflow({
      script: source,
      baseDir: tmpDir,
      executors: { mock: makeMockExecutor("mock") },
    });

    expect(result.value).toEqual({
      results: ["echo:task-1", "echo:task-2", "echo:task-3"],
    });
    expect(result.agentCount).toBeGreaterThanOrEqual(3);
  });

  it("应支持 pipeline 操作", async () => {
    const source = `
      export const meta = {
        name: 'pipeline-test',
        description: 'Test pipeline',
      };
      const items = ['alpha', 'beta', 'gamma'];
      const result = await pipeline(
        items,
        async (_prev, item) => item.toUpperCase(),
        async (prev) => prev + '-done',
      );
      return { result };
    `;

    const r = await runWorkflow({
      script: source,
      baseDir: tmpDir,
      executors: { mock: makeMockExecutor("mock") },
    });

    expect(r.value).toEqual({ result: ["ALPHA-done", "BETA-done", "GAMMA-done"] });
  });

  it("应支持 phase 和 log", async () => {
    const source = `
      export const meta = {
        name: 'phase-log-test',
        description: 'Test phase and log',
      };
      phase('Phase 1');
      log('Processing...');
      phase('Phase 2');
      log('Done!');
      return { ok: true };
    `;

    const events: any[] = [];
    await runWorkflow({
      script: source,
      baseDir: tmpDir,
      executors: { mock: makeMockExecutor("mock") },
      onEvent: (e) => events.push(e),
    });

    const phaseStarts = events.filter((e) => e.type === "phase_start");
    const logs = events.filter((e) => e.type === "log");
    expect(phaseStarts.length).toBeGreaterThanOrEqual(2);
    expect(logs.length).toBeGreaterThanOrEqual(2);
  });

  it("应在缺失 meta 时快速失败", async () => {
    const source = `
      return { no: 'meta' };
    `;

    await expect(runWorkflow({
      script: source,
      baseDir: tmpDir,
      executors: { mock: makeMockExecutor("mock") },
    })).rejects.toThrow(/must declare.*const meta/);
  });

  it("应在引用决定论违反时快速失败", async () => {
    const source = `
      export const meta = { name: 'bad', description: 'test' };
      const x = Date.now();
      return { x };
    `;

    await expect(runWorkflow({
      script: source,
      baseDir: tmpDir,
      executors: { mock: makeMockExecutor("mock") },
    })).rejects.toThrow(/not allowed|determinism|Date\.now/);
  });

  it("应拒绝无 executor 的 agent() 调用", async () => {
    const source = `
      export const meta = { name: 'no-exec', description: 'test' };
      await agent('hello');
      return {};
    `;

    await expect(runWorkflow({
      script: source,
      baseDir: tmpDir,
      executors: {},
    })).rejects.toThrow(/requires an explicit.*executor/);
  });

  it("应将结果持久化到磁盘", async () => {
    const source = `
      export const meta = { name: 'persist-test', description: 'test' };
      return { data: 'persisted' };
    `;

    const result = await runWorkflow({
      script: source,
      baseDir: tmpDir,
      executors: { mock: makeMockExecutor("mock") },
    });

    const fs = await import("node:fs");
    const runDirExists = fs.existsSync(result.runDir);
    expect(runDirExists).toBe(true);

    const scriptPath = path.join(result.runDir, "script.js");
    expect(fs.existsSync(scriptPath)).toBe(true);
  });
});
