import { describe, it, expect } from "vitest";
import { parseStreamJsonLine, reduceStreamJsonEvents } from "../src/workflows/executor/claude/stream-json.js";

describe("stream-json (claude)", () => {
  describe("parseStreamJsonLine", () => {
    it("应解析有效的 JSON 行", () => {
      const result = parseStreamJsonLine('{"type":"assistant"}');
      expect(result).toEqual({ type: "assistant" });
    });

    it("应跳过空行", () => {
      expect(parseStreamJsonLine("")).toBeNull();
      expect(parseStreamJsonLine("   ")).toBeNull();
    });

    it("应跳过无效 JSON", () => {
      expect(parseStreamJsonLine("not json")).toBeNull();
      expect(parseStreamJsonLine("{invalid}")).toBeNull();
    });

    it("应解析带前后空白的 JSON", () => {
      const result = parseStreamJsonLine('  {"type":"result"}  ');
      expect(result).toEqual({ type: "result" });
    });
  });

  describe("reduceStreamJsonEvents", () => {
    it("应在没有 result 事件时返回错误", () => {
      const outcome = reduceStreamJsonEvents([]);
      expect(outcome.isError).toBe(true);
      expect(outcome.resultSubtype).toBe("error_during_execution");
    });

    it("应累积 assistant 文本", () => {
      const events = [
        { type: "assistant", message: { content: [{ type: "text", text: "Hello " }] } },
        { type: "assistant", message: { content: [{ type: "text", text: "World" }] } },
        { type: "result", subtype: "success", is_error: false },
      ];
      const outcome = reduceStreamJsonEvents(events);
      expect(outcome.text).toBe("Hello World");
      expect(outcome.isError).toBe(false);
    });

    it("应提取 session_id", () => {
      const events = [
        { type: "result", session_id: "sess-123", subtype: "success" },
      ];
      const outcome = reduceStreamJsonEvents(events);
      expect(outcome.sessionId).toBe("sess-123");
    });

    it("应提取 cost 和 usage", () => {
      const events = [
        {
          type: "result",
          subtype: "success",
          is_error: false,
          total_cost_usd: 0.05,
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      ];
      const outcome = reduceStreamJsonEvents(events);
      expect(outcome.costUsd).toBe(0.05);
      expect(outcome.usage.inputTokens).toBe(100);
      expect(outcome.usage.outputTokens).toBe(50);
    });

    it("应提取 structured_output", () => {
      const structured = { answer: 42 };
      const events = [
        { type: "result", subtype: "success", is_error: false, structured_output: structured },
      ];
      const outcome = reduceStreamJsonEvents(events);
      expect(outcome.structuredOutput).toEqual(structured);
    });

    it("应将 is_error:true 视为错误", () => {
      const events = [
        { type: "result", subtype: "success", is_error: true },
      ];
      const outcome = reduceStreamJsonEvents(events);
      expect(outcome.isError).toBe(true);
    });

    it("非对象事件应被跳过", () => {
      const events = [null, undefined, "string", 42, { type: "result", subtype: "success", is_error: false }];
      const outcome = reduceStreamJsonEvents(events);
      expect(outcome.isError).toBe(false);
    });

    it("应跳过缺少 message 的 assistant 事件", () => {
      const events = [
        { type: "assistant" },
        { type: "result", subtype: "success", is_error: false },
      ];
      const outcome = reduceStreamJsonEvents(events);
      expect(outcome.text).toBe("");
    });

    it("应跳过非数组 content", () => {
      const events = [
        { type: "assistant", message: { content: "not-array" } },
        { type: "result", subtype: "success", is_error: false },
      ];
      const outcome = reduceStreamJsonEvents(events);
      expect(outcome.text).toBe("");
    });

    it("应跳过非文本类型的 content block", () => {
      const events = [
        { type: "assistant", message: { content: [{ type: "image", text: "ignored" }] } },
        { type: "result", subtype: "success", is_error: false },
      ];
      const outcome = reduceStreamJsonEvents(events);
      expect(outcome.text).toBe("");
    });

    it("应处理缺失 subtype 时默认为 success", () => {
      const events = [{ type: "result", is_error: false }];
      const outcome = reduceStreamJsonEvents(events);
      expect(outcome.resultSubtype).toBe("success");
    });

    it("数字型 cost 和 usage 应做安全转换", () => {
      const events = [
        {
          type: "result",
          subtype: "success",
          is_error: false,
          total_cost_usd: "not-a-number",
          usage: { input_tokens: null, output_tokens: undefined },
        },
      ];
      const outcome = reduceStreamJsonEvents(events);
      expect(outcome.costUsd).toBe(0);
      expect(outcome.usage.inputTokens).toBe(0);
      expect(outcome.usage.outputTokens).toBe(0);
    });
  });
});