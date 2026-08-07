import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openJournal, keyFor } from "../src/workflows/journal/journal.js";
import type { AgentRecord } from "../src/workflows/types.js";

describe("journal (integration)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "journal-test-"));
  });

  it("openJournal 应创建带 runId 的目录结构", async () => {
    const journal = await openJournal({ baseDir: tmpDir });
    expect(journal.runId.startsWith("run-")).toBe(true);
    expect(journal.runDir).toBe(path.join(tmpDir, journal.runId));

    const agentsDir = path.join(journal.runDir, "agents");
    expect(existsSync(agentsDir)).toBe(true);
  });

  it("openJournal 应支持自定义 runId", async () => {
    const journal = await openJournal({ baseDir: tmpDir, runId: "custom-run-1" });
    expect(journal.runId).toBe("custom-run-1");
    expect(journal.runDir).toBe(path.join(tmpDir, "custom-run-1"));
  });

  it("persistScript 应将脚本写入磁盘", async () => {
    const journal = await openJournal({ baseDir: tmpDir });
    const scriptPath = await journal.persistScript("const x = 1;", "js");
    expect(scriptPath).toBe(path.join(journal.runDir, "script.js"));
    expect(existsSync(scriptPath)).toBe(true);
    expect(readFileSync(scriptPath, "utf8")).toBe("const x = 1;");
  });

  it("append 应记录 agent 记录", async () => {
    const journal = await openJournal({ baseDir: tmpDir });
    const record: AgentRecord = {
      key: "test-key",
      agentId: 1,
      prompt: "test prompt",
      opts: { executor: "mock" } as any,
      result: "test result",
      cached: false,
      timestamp: new Date().toISOString(),
    };

    journal.append(record);
    await journal.close();

    const journalPath = path.join(journal.runDir, "journal.jsonl");
    expect(existsSync(journalPath)).toBe(true);

    const content = readFileSync(journalPath, "utf8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.agentId).toBe(1);
    expect(parsed.prompt).toBe("test prompt");
  });

  it("appendEvent 应记录事件", async () => {
    const journal = await openJournal({ baseDir: tmpDir });
    journal.appendEvent({ type: "log", text: "test log" });
    await journal.close();

    const eventsPath = path.join(journal.runDir, "events.jsonl");
    expect(existsSync(eventsPath)).toBe(true);

    const content = readFileSync(eventsPath, "utf8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.type).toBe("log");
    expect(parsed.text).toBe("test log");
  });

  it("takeCached 在无 resume 时应返回 undefined", async () => {
    const journal = await openJournal({ baseDir: tmpDir });
    const cached = journal.takeCached("nonexistent-key");
    expect(cached).toBeUndefined();
  });

  it("close 应等待所有写入完成", async () => {
    const journal = await openJournal({ baseDir: tmpDir });
    journal.appendEvent({ type: "log", text: "msg1" });
    journal.appendEvent({ type: "log", text: "msg2" });
    await journal.close();

    const eventsPath = path.join(journal.runDir, "events.jsonl");
    const content = readFileSync(eventsPath, "utf8");
    const lines = content.trim().split("\n").filter((l) => l.trim());
    expect(lines.length).toBe(2);
  });

  it("resumeFromRunId 应加载之前的 journal 缓存", async () => {
    const runId = "resume-test-run";
    const priorDir = path.join(tmpDir, runId);
    const agentsDir = path.join(priorDir, "agents");
    await require("node:fs").promises.mkdir(agentsDir, { recursive: true });

    const record: AgentRecord = {
      key: "resume-key",
      agentId: 1,
      prompt: "cached prompt",
      opts: { executor: "mock" } as any,
      result: "cached result",
      cached: true,
      timestamp: new Date().toISOString(),
    };

    const journalPath = path.join(priorDir, "journal.jsonl");
    await require("node:fs").promises.writeFile(journalPath, JSON.stringify(record) + "\n");

    const journal = await openJournal({ baseDir: tmpDir, resumeFromRunId: runId });
    const cached = journal.takeCached("resume-key");
    expect(cached).toBeDefined();
    expect(cached!.result).toBe("cached result");
    expect(cached!.agentId).toBe(1);
  });

  it("keyFor 相同输入应产生相同哈希", () => {
    const k1 = keyFor("prompt", { foo: "bar" });
    const k2 = keyFor("prompt", { foo: "bar" });
    expect(k1).toBe(k2);
  });

  it("keyFor 不同输入应产生不同哈希", () => {
    const k1 = keyFor("prompt-a", {});
    const k2 = keyFor("prompt-b", {});
    expect(k1).not.toBe(k2);
  });
});