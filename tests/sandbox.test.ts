import { describe, it, expect } from "vitest";
import { hasDeterminismBreakers, extractMeta, runScript } from "../src/workflows/runtime/sandbox.js";
import type { ScriptHooks } from "../src/workflows/types.js";

describe("sandbox", () => {
  describe("hasDeterminismBreakers", () => {
    it("应检测 Date.now()", () => {
      expect(hasDeterminismBreakers("const x = Date.now();")).toBe(true);
    });

    it("应检测 Math.random()", () => {
      expect(hasDeterminismBreakers("const x = Math.random();")).toBe(true);
    });

    it("应检测无参 new Date()", () => {
      expect(hasDeterminismBreakers("const x = new Date();")).toBe(true);
    });

    it("应允许带参 new Date('2024-01-01')", () => {
      expect(hasDeterminismBreakers("const x = new Date('2024-01-01');")).toBe(false);
    });

    it("应允许普通计算", () => {
      expect(hasDeterminismBreakers("const x = 1 + 2;")).toBe(false);
    });
  });

  describe("extractMeta", () => {
    it("应提取有效的 meta 块", () => {
      const source = `
        export const meta = {
          name: 'test-workflow',
          description: 'A test workflow',
        };
        return { ok: true };
      `;
      const meta = extractMeta(source);
      expect(meta.name).toBe("test-workflow");
      expect(meta.description).toBe("A test workflow");
    });

    it("应拒绝缺失 meta 块", () => {
      const source = "return { ok: true };";
      expect(() => extractMeta(source)).toThrow(/must declare.*const meta/);
    });

    it("应拒绝非字面量 meta", () => {
      const source = `
        const x = 'test';
        export const meta = { name: x, description: 'bad' };
        return null;
      `;
      expect(() => extractMeta(source)).toThrow("must be a pure literal");
    });

    it("应拒绝缺失 name", () => {
      const source = `
        export const meta = { description: 'no name' };
        return null;
      `;
      expect(() => extractMeta(source)).toThrow("meta.name is required");
    });

    it("应拒绝缺失 description", () => {
      const source = `
        export const meta = { name: 'no-desc' };
        return null;
      `;
      expect(() => extractMeta(source)).toThrow("meta.description is required");
    });

    it("应支持可选的 phases", () => {
      const source = `
        export const meta = {
          name: 'phased',
          description: 'Has phases',
          phases: [{ title: 'Scan', detail: 'Scan files' }],
        };
        return null;
      `;
      const meta = extractMeta(source);
      expect(meta.phases).toHaveLength(1);
      expect(meta.phases![0].title).toBe("Scan");
    });

    it("应支持 whenToUse 可选字段", () => {
      const source = `
        export const meta = {
          name: 'with-when',
          description: 'Has when',
          whenToUse: 'When to use this workflow',
        };
        return null;
      `;
      const meta = extractMeta(source);
      expect(meta.whenToUse).toBe("When to use this workflow");
    });
  });

  describe("runScript", () => {
    const makeHooks = (overrides: Partial<ScriptHooks> = {}): ScriptHooks => ({
      agent: async () => "mock",
      pipeline: async (items: any[], ..._stages: any[]) => items,
      parallel: async (thunks: any[]) => Promise.all(thunks.map((t) => t())),
      phase: () => {},
      log: () => {},
      workflow: async () => null,
      args: {},
      ...overrides,
    });

    it("应运行简单脚本并返回结果", async () => {
      const source = `
        export const meta = { name: 'simple', description: 'simple test' };
        return { value: 42 };
      `;
      const result = await runScript(source, makeHooks(), {});
      expect(result).toEqual({ value: 42 });
    });

    it("应支持在脚本中调用 phase()", async () => {
      let phaseCalled = "";
      const hooks = makeHooks({
        phase: (title: string) => { phaseCalled = title; },
      });
      const source = `
        export const meta = { name: 'phase-test', description: 'test' };
        phase('My Phase');
        return { done: true };
      `;
      const result = await runScript(source, hooks, {});
      expect(result).toEqual({ done: true });
      expect(phaseCalled).toBe("My Phase");
    });

    it("应支持在脚本中调用 log()", async () => {
      const logs: string[] = [];
      const hooks = makeHooks({
        log: (msg: string) => { logs.push(msg); },
      });
      const source = `
        export const meta = { name: 'log-test', description: 'test' };
        log('hello from script');
        return { ok: true };
      `;
      await runScript(source, hooks, {});
      expect(logs).toContain("hello from script");
    });

    it("应支持在脚本中调用 agent()", async () => {
      const hooks = makeHooks({
        agent: async (prompt: string) => `agent-says:${prompt}`,
      });
      const source = `
        export const meta = { name: 'agent-test', description: 'test' };
        const result = await agent('hello');
        return { agentResult: result };
      `;
      const result = await runScript(source, hooks, {});
      expect(result).toEqual({ agentResult: "agent-says:hello" });
    });

    it("应传递 args 给脚本", async () => {
      const source = `
        export const meta = { name: 'args-test', description: 'test' };
        return { input: args };
      `;
      const result = await runScript(source, makeHooks({ args: { key: "value" } }), { key: "value" });
      expect(result).toEqual({ input: { key: "value" } });
    });

    it("应拒绝 Date.now()", async () => {
      const source = `
        export const meta = { name: 'bad', description: 'test' };
        return Date.now();
      `;
      await expect(runScript(source, makeHooks(), {})).rejects.toThrow("Determinism violation");
    });

    it("应拒绝 Math.random()", async () => {
      const source = `
        export const meta = { name: 'bad', description: 'test' };
        return Math.random();
      `;
      await expect(runScript(source, makeHooks(), {})).rejects.toThrow("Determinism violation");
    });

    it("应拒绝无参 new Date()", async () => {
      const source = `
        export const meta = { name: 'bad', description: 'test' };
        return new Date().toISOString();
      `;
      await expect(runScript(source, makeHooks(), {})).rejects.toThrow("Determinism violation");
    });

    it("应允许带参 new Date()", async () => {
      const source = `
        export const meta = { name: 'good', description: 'test' };
        return new Date('2024-01-15').getFullYear();
      `;
      const result = await runScript(source, makeHooks(), {});
      expect(result).toBe(2024);
    });

    it("应捕获脚本运行时错误", async () => {
      const source = `
        export const meta = { name: 'error', description: 'test' };
        throw new Error('intentional error');
      `;
      await expect(runScript(source, makeHooks(), {})).rejects.toThrow("intentional error");
    });
  });
});
