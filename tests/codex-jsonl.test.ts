import { describe, it, expect } from "vitest";
import { parseCodexJsonLine, reduceCodexEvents } from "../src/workflows/executor/codex/codex-jsonl.js";

describe("codex-jsonl", () => {
  describe("parseCodexJsonLine", () => {
    it("应解析有效的 JSON 行", () => {
      const result = parseCodexJsonLine('{"type":"thread.started"}');
      expect(result).toEqual({ type: "thread.started" });
    });

    it("应跳过空行", () => {
      expect(parseCodexJsonLine("")).toBeNull();
      expect(parseCodexJsonLine("   ")).toBeNull();
    });

    it("应跳过无效 JSON", () => {
      expect(parseCodexJsonLine("not json")).toBeNull();
    });
  });

  describe("reduceCodexEvents", () => {
    it("无事件时应返回错误", () => {
      const outcome = reduceCodexEvents([]);
      expect(outcome.isError).toBe(true);
      expect(outcome.resultSubtype).toBe("error_during_execution");
    });

    it("应从 thread.started 提取 sessionId", () => {
      const events = [{ type: "thread.started", thread_id: "thread-123" }];
      const outcome = reduceCodexEvents(events);
      expect(outcome.sessionId).toBe("thread-123");
    });

    it("应从 item.completed 提取 agent 文本", () => {
      const events = [
        {
          type: "item.completed",
          item: { type: "agent_message", text: "Agent says hello" },
        },
        { type: "turn.completed" },
      ];
      const outcome = reduceCodexEvents(events);
      expect(outcome.text).toBe("Agent says hello");
      expect(outcome.isError).toBe(false);
    });

    it("应从 turn.completed 提取 usage", () => {
      const events = [
        {
          type: "turn.completed",
          usage: { input_tokens: 200, output_tokens: 100 },
        },
      ];
      const outcome = reduceCodexEvents(events);
      expect(outcome.usage.inputTokens).toBe(200);
      expect(outcome.usage.outputTokens).toBe(100);
    });

    it("turn.failed 应标记为错误", () => {
      const events = [
        { type: "turn.failed", error: { message: "Something broke" } },
        { type: "turn.completed" },
      ];
      const outcome = reduceCodexEvents(events);
      expect(outcome.isError).toBe(true);
    });

    it("error 事件在失败时应提取错误消息", () => {
      const events = [
        { type: "error", message: "Critical error occurred" },
        { type: "turn.failed" },
      ];
      const outcome = reduceCodexEvents(events);
      expect(outcome.isError).toBe(true);
      expect(outcome.text).toBe("Critical error occurred");
    });

    it("无 turn.completed 应视为错误", () => {
      const events = [{ type: "thread.started", thread_id: "t1" }];
      const outcome = reduceCodexEvents(events);
      expect(outcome.isError).toBe(true);
    });

    it("exitCode 不为 0 应视为错误", () => {
      const events = [{ type: "turn.completed" }];
      const outcome = reduceCodexEvents(events, { exitCode: 1 });
      expect(outcome.isError).toBe(true);
    });

    it("exitCode 为 0 不应视为错误", () => {
      const events = [{ type: "turn.completed" }];
      const outcome = reduceCodexEvents(events, { exitCode: 0 });
      expect(outcome.isError).toBe(false);
    });

    it("schema 模式下应解析 structuredOutput", () => {
      const structured = { name: "test", value: 42 };
      const events = [
        {
          type: "item.completed",
          item: { type: "agent_message", text: JSON.stringify(structured) },
        },
        { type: "turn.completed" },
      ];
      const outcome = reduceCodexEvents(events, { schema: true });
      expect(outcome.structuredOutput).toEqual(structured);
      expect(outcome.isError).toBe(false);
    });

    it("schema 模式下 JSON 解析失败应视为错误", () => {
      const events = [
        {
          type: "item.completed",
          item: { type: "agent_message", text: "not-valid-json" },
        },
        { type: "turn.completed" },
      ];
      const outcome = reduceCodexEvents(events, { schema: true });
      expect(outcome.isError).toBe(true);
    });

    it("非对象事件应被安全跳过", () => {
      const events = [null, undefined, "str", 42, { type: "turn.completed" }];
      const outcome = reduceCodexEvents(events);
      expect(outcome.isError).toBe(false);
    });

    it("缺少 item 或非 agent_message 类型应被跳过", () => {
      const events = [
        { type: "item.completed" },
        { type: "item.completed", item: { type: "tool_call", text: "ignored" } },
        { type: "turn.completed" },
      ];
      const outcome = reduceCodexEvents(events);
      expect(outcome.text).toBe("");
      expect(outcome.isError).toBe(false);
    });

    it("错误文本优先从 error message 获取", () => {
      const events = [
        { type: "turn.failed", error: { message: "fail reason" } },
        { type: "turn.completed" },
      ];
      const outcome = reduceCodexEvents(events);
      expect(outcome.text).toBe("fail reason");
    });
  });
});