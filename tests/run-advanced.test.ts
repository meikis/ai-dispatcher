import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runWorkflow } from "../src/workflows/runtime/run.js";
import type { Executor, ExecResult } from "../src/workflows/types.js";

function makeMockExecutor(name: string, delay = 0): Executor {
  return {
    name,
    async runPrompt(opts) {
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      return {
        text: `echo:${opts.prompt}`,
        sessionId: null,
        costUsd: 0.01,
        resultSubtype: "success",
        isError: false,
        usage: { inputTokens: 10, outputTokens: 5 },
        durationMs: delay,
      } as ExecResult;
    },
  };
}

describe("runWorkflow (advanced)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "odw-advanced-test-"));
  });

  it("应支持通过 scriptPath 读取脚本", async () => {
    const scriptPath = path.join(tmpDir, "workflow.js");
    writeFileSync(scriptPath, `
      export const meta = {
        name: 'path-test',
        description: 'Test script path',
      };
      return { from: 'script-path' };
    `);

    const result = await runWorkflow({
      scriptPath,
      baseDir: tmpDir,
      executors: { mock: makeMockExecutor("mock") },
    });

    expect(result.value).toEqual({ from: "script-path" });
  });

  it("应支持自定义 baseDir", async () => {
    const result = await runWorkflow({
      script: `
        export const meta = { name: 'custom-dir', description: 'test' };
        return { ok: true };
      `,
      baseDir: tmpDir,
      executors: { mock: makeMockExecutor("mock") },
    });

    expect(result.runDir.startsWith(tmpDir)).toBe(true);
  });

  it("应发出 phase_start 事件", async () => {
    const source = `
      export const meta = {
        name: 'phase-events',
        description: 'Test phase events',
        phases: [{ title: 'Phase One' }, { title: 'Phase Two' }],
      };
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
    expect(phaseStarts.length).toBe(2);
    expect(phaseStarts[0].phaseTitle).toBe("Phase One");
    expect(phaseStarts[1].phaseTitle).toBe("Phase Two");
  });

  it("应在执行结束时发出 run_end 事件", async () => {
    const events: any[] = [];
    await runWorkflow({
      script: `
        export const meta = { name: 'run-end-test', description: 'test' };
        return { ok: true };
      `,
      baseDir: tmpDir,
      executors: { mock: makeMockExecutor("mock") },
      onEvent: (e) => events.push(e),
    });

    const runEnds = events.filter((e) => e.type === "run_end");
    expect(runEnds.length).toBeGreaterThanOrEqual(1);
  });

  it("应正确计算 agentCount", async () => {
    const source = `
      export const meta = { name: 'agent-count', description: 'test' };
      await agent('task-1', { executor: 'mock' });
      await agent('task-2', { executor: 'mock' });
      await agent('task-3', { executor: 'mock' });
      return { count: 3 };
    `;

    const result = await runWorkflow({
      script: source,
      baseDir: tmpDir,
      executors: { mock: makeMockExecutor("mock") },
    });

    expect(result.agentCount).toBeGreaterThanOrEqual(3);
  });

  it("应在脚本抛错时传播错误", async () => {
    const source = `
      export const meta = { name: 'error-test', description: 'test' };
      throw new Error('intentional test error');
    `;

    await expect(runWorkflow({
      script: source,
      baseDir: tmpDir,
      executors: { mock: makeMockExecutor("mock") },
    })).rejects.toThrow("intentional test error");
  });

  it("应在无 scriptPath/script/registryDir 时抛错", async () => {
    await expect(runWorkflow({
      baseDir: tmpDir,
      executors: { mock: makeMockExecutor("mock") },
    })).rejects.toThrow(/requires either scriptPath, script, or registryDir/);
  });

  it("应支持带 schema 的 agent 调用", async () => {
    const source = `
      export const meta = { name: 'schema-test', description: 'test' };
      const result = await agent('Return name and age', {
        executor: 'mock',
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            age: { type: 'number' },
          },
          required: ['name'],
        },
      });
      return result;
    `;

    const result = await runWorkflow({
      script: source,
      baseDir: tmpDir,
      executors: { mock: makeMockExecutor("mock") },
    });

    expect(result.value).toBeDefined();
  });

  it("应支持 agentType 预设", async () => {
    let systemPrompt = "";
    const executor: Executor = {
      name: "preset-test",
      async runPrompt(opts) {
        systemPrompt = opts.appendSystemPrompt || "";
        return {
          text: "result",
          sessionId: null,
          costUsd: 0,
          resultSubtype: "success",
          isError: false,
          usage: { inputTokens: 0, outputTokens: 0 },
          durationMs: 0,
        } as ExecResult;
      },
    };

    const source = `
      export const meta = { name: 'preset-test', description: 'test' };
      await agent('explore this', { executor: 'preset-test', agentType: 'Explore' });
      return { ok: true };
    `;

    await runWorkflow({
      script: source,
      baseDir: tmpDir,
      executors: { "preset-test": executor },
    });

    expect(systemPrompt).toContain("read-only exploration");
  });

  it("应在 registryDir 中查找命名 workflow", async () => {
    const registryDir = path.join(tmpDir, "registry");
    const wfDir = path.join(registryDir, "my-workflow");
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(path.join(wfDir, "script.js"), `
      export const meta = { name: 'my-workflow', description: 'Registry test' };
      return { from: 'registry' };
    `);

    const result = await runWorkflow({
      scriptPath: path.join(registryDir, "my-workflow", "script.js"),
      registryDir,
      baseDir: tmpDir,
      executors: { mock: makeMockExecutor("mock") },
    });

    expect(result.value).toEqual({ from: "registry" });
  });

  it("应支持自定义并发数", async () => {
    const source = `
      export const meta = { name: 'concurrency-test', description: 'test' };
      const results = await parallel([
        () => agent('t1', { executor: 'mock' }),
        () => agent('t2', { executor: 'mock' }),
        () => agent('t3', { executor: 'mock' }),
        () => agent('t4', { executor: 'mock' }),
      ]);
      return { results };
    `;

    const result = await runWorkflow({
      script: source,
      baseDir: tmpDir,
      concurrency: 2,
      executors: { mock: makeMockExecutor("mock", 50) },
    });

    expect(result.value).toBeDefined();
  });

  it("durationMs 应大于等于 0", async () => {
    const result = await runWorkflow({
      script: `
        export const meta = { name: 'duration-test', description: 'test' };
        return { ok: true };
      `,
      baseDir: tmpDir,
      executors: { mock: makeMockExecutor("mock") },
    });

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});