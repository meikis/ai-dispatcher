import { describe, it, expect, beforeEach } from "vitest";
import { createHooks } from "../src/workflows/runtime/hooks.js";
import type { Executor, ExecResult, RunContext, AgentOptions } from "../src/workflows/types.js";
import { createSemaphore, createCounter } from "../src/workflows/runtime/semaphore.js";

function makeMockExecutor(name: string): { executor: Executor; calledWith: any[] } {
  const calledWith: any[] = [];
  const executor: Executor = {
    name,
    async runPrompt(opts) {
      calledWith.push(opts);
      return {
        text: `result-for:${opts.prompt}`,
        sessionId: null,
        costUsd: 0.01,
        resultSubtype: "success",
        isError: false,
        usage: { inputTokens: 10, outputTokens: 5 },
        durationMs: 100,
      } as ExecResult;
    },
  };
  return { executor, calledWith };
}

function makeContext(): RunContext {
  return {
    runId: "test-run-1",
    runDir: "/tmp/test-run-1",
    baseDir: "/tmp",
    cwd: "/tmp",
    model: "test-model",
    args: {},
    concurrency: 4,
    abortSignal: new AbortController().signal,
    semaphore: createSemaphore(4),
    agentCounter: createCounter(100),
    nestedDepth: 0,
    journal: {
      runId: "test-run-1",
      runDir: "/tmp/test-run-1",
      persistScript: async () => "",
      append: () => {},
      appendEvent: () => {},
      takeCached: () => undefined,
      close: async () => {},
    },
    emit: () => {},
  };
}

describe("hooks", () => {
  describe("agent", () => {
    it("应调用 executor 并返回结果", async () => {
      const { executor, calledWith } = makeMockExecutor("test-exec");
      const ctx = makeContext();
      const hooks = createHooks(ctx, {
        semaphore: ctx.semaphore,
        runNested: async () => null,
        args: {},
      }, { "test-exec": executor });

      const result = await hooks.agent("hello", { executor: "test-exec" });
      expect(result).toBe("result-for:hello");
      expect(calledWith).toHaveLength(1);
      expect(calledWith[0].prompt).toBe("hello");
    });

    it("应在 journal 中记录 agent 结果", async () => {
      const { executor } = makeMockExecutor("test-exec");
      const ctx = makeContext();
      const records: any[] = [];
      ctx.journal.append = (rec: any) => records.push(rec);

      const hooks = createHooks(ctx, {
        semaphore: ctx.semaphore,
        runNested: async () => null,
        args: {},
      }, { "test-exec": executor });

      await hooks.agent("task-1", { executor: "test-exec" });
      expect(records.length).toBe(1);
      expect(records[0].prompt).toBe("task-1");
    });

    it("无 schema 时返回纯文本结果", async () => {
      const executor: Executor = {
        name: "plain",
        async runPrompt() {
          return {
            text: "plain text response",
            sessionId: null,
            costUsd: 0,
            resultSubtype: "success",
            isError: false,
            usage: { inputTokens: 0, outputTokens: 0 },
            durationMs: 0,
          } as ExecResult;
        },
      };
      const ctx = makeContext();
      const hooks = createHooks(ctx, {
        semaphore: ctx.semaphore,
        runNested: async () => null,
        args: {},
      }, { plain: executor });

      const result = await hooks.agent("test", { executor: "plain" });
      expect(result).toBe("plain text response");
    });

    it("未知名 executor 应抛错", async () => {
      const ctx = makeContext();
      const hooks = createHooks(ctx, {
        semaphore: ctx.semaphore,
        runNested: async () => null,
        args: {},
      }, {});

      await expect(hooks.agent("test", { executor: "nonexistent" })).rejects.toThrow(
        "executor 'nonexistent' not found",
      );
    });

    it("无 executor 选项应抛错", async () => {
      const ctx = makeContext();
      const hooks = createHooks(ctx, {
        semaphore: ctx.semaphore,
        runNested: async () => null,
        args: {},
      }, {});

      await expect(hooks.agent("test", {} as AgentOptions)).rejects.toThrow(
        "requires an explicit {executor} name",
      );
    });

    it("命中缓存时应跳过并返回缓存结果", async () => {
      const { executor } = makeMockExecutor("test-exec");
      const ctx = makeContext();
      ctx.journal.takeCached = () => ({
        key: "cached-key",
        agentId: 1,
        prompt: "cached-prompt",
        opts: { executor: "test-exec" },
        result: "cached-result",
        cached: true,
        timestamp: new Date().toISOString(),
      });

      const hooks = createHooks(ctx, {
        semaphore: ctx.semaphore,
        runNested: async () => null,
        args: {},
      }, { "test-exec": executor });

      const result = await hooks.agent("cached-prompt", { executor: "test-exec" });
      expect(result).toBe("cached-result");
    });
  });

  describe("pipeline", () => {
    it("应将每个 item 流过所有阶段", async () => {
      const ctx = makeContext();
      const hooks = createHooks(ctx, {
        semaphore: ctx.semaphore,
        runNested: async () => null,
        args: {},
      }, {});

      const items = ["a", "b", "c"];
      const result = await hooks.pipeline(
        items,
        async (_prev, item) => item.toUpperCase(),
        async (prev) => `${prev}!`,
      );
      expect(result).toEqual(["A!", "B!", "C!"]);
    });

    it("某 item 失败不应影响其他 item", async () => {
      const ctx = makeContext();
      const hooks = createHooks(ctx, {
        semaphore: ctx.semaphore,
        runNested: async () => null,
        args: {},
      }, {});

      const items = ["good", "bad", "also-good"];
      const result = await hooks.pipeline(
        items,
        async (_prev, item) => {
          if (item === "bad") throw new Error("fail");
          return item.toUpperCase();
        },
        async (prev) => `${prev}!`,
      );
      const filtered = result.filter((r) => r !== null && r !== undefined);
      expect(filtered.length).toBe(2);
    });
  });

  describe("parallel", () => {
    it("应并行执行所有 thunk", async () => {
      const ctx = makeContext();
      const hooks = createHooks(ctx, {
        semaphore: ctx.semaphore,
        runNested: async () => null,
        args: {},
      }, {});

      const results = await hooks.parallel([
        async () => 1,
        async () => 2,
        async () => 3,
      ]);
      expect(results).toEqual([1, 2, 3]);
    });

    it("单个 thunk 失败不应抛错", async () => {
      const ctx = makeContext();
      const hooks = createHooks(ctx, {
        semaphore: ctx.semaphore,
        runNested: async () => null,
        args: {},
      }, {});

      const results = await hooks.parallel([
        async () => "ok",
        async () => { throw new Error("fail"); },
        async () => "also-ok",
      ]);
      expect(results[0]).toBe("ok");
      expect(results[2]).toBe("also-ok");
    });
  });

  describe("phase", () => {
    it("应发出 phase_start 事件", () => {
      const events: any[] = [];
      const ctx = makeContext();
      ctx.emit = (e: any) => events.push(e);
      const hooks = createHooks(ctx, {
        semaphore: ctx.semaphore,
        runNested: async () => null,
        args: {},
      }, {});

      hooks.phase("My Phase");
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].phaseTitle).toBe("My Phase");
    });
  });

  describe("log", () => {
    it("应发出 log 事件", () => {
      const events: any[] = [];
      const ctx = makeContext();
      ctx.emit = (e: any) => events.push(e);
      const hooks = createHooks(ctx, {
        semaphore: ctx.semaphore,
        runNested: async () => null,
        args: {},
      }, {});

      hooks.log("test message");
      const logEvent = events.find((e) => e.type === "log");
      expect(logEvent).toBeDefined();
      expect(logEvent.text).toBe("test message");
    });
  });
});
