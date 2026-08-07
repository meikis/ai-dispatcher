import { describe, it, expect } from "vitest";
import { createTreeRenderer } from "../src/workflows/progress/tree.js";
import type { ProgressEvent } from "../src/workflows/types.js";

describe("progress/tree", () => {
  it("应将事件转发到外层 sink", () => {
    const events: ProgressEvent[] = [];
    const tree = createTreeRenderer((e) => events.push(e));
    tree({ type: "log", text: "hello" });
    expect(events.length).toBeGreaterThan(0);
  });

  it("应在 phase_start 时创建阶段", () => {
    const events: ProgressEvent[] = [];
    const tree = createTreeRenderer((e) => events.push(e));
    tree({ type: "phase_start", phaseTitle: "Scan" });
    tree({ type: "agent_start", agentId: 1, label: "finder-1" });
    tree({ type: "agent_end", agentId: 1 });
    tree({ type: "phase_start", phaseTitle: "Verify" });
    tree({ type: "agent_start", agentId: 2, label: "verifier-1" });
    tree({ type: "agent_end", agentId: 2 });
    const logEvents = events.filter((e) => e.type === "log");
    expect(logEvents.length).toBeGreaterThan(0);
  });

  it("应正确标记 agent 完成状态", () => {
    const events: ProgressEvent[] = [];
    const tree = createTreeRenderer((e) => events.push(e));
    tree({ type: "agent_start", agentId: 1, label: "task-1" });
    tree({ type: "agent_end", agentId: 1, costUsd: 0.5, durationMs: 1000 });
    const logText = events.filter((e) => e.type === "log").map((e) => e.text).join("\n");
    expect(logText).toContain("task-1");
    expect(logText).toContain("$0.50");
  });

  it("应标记缓存命中为 skipped", () => {
    const events: ProgressEvent[] = [];
    const tree = createTreeRenderer((e) => events.push(e));
    tree({ type: "agent_start", agentId: 1, label: "cached-task" });
    tree({ type: "agent_end", agentId: 1, cached: true });
    const logText = events.filter((e) => e.type === "log").map((e) => e.text).join("\n");
    expect(logText).toContain("cached");
  });

  it("应标记错误为 failed", () => {
    const events: ProgressEvent[] = [];
    const tree = createTreeRenderer((e) => events.push(e));
    tree({ type: "agent_start", agentId: 1, label: "failing-task" });
    tree({ type: "agent_end", agentId: 1, error: "something went wrong" });
    const logText = events.filter((e) => e.type === "log").map((e) => e.text).join("\n");
    expect(logText).toContain("failing-task");
  });
});
