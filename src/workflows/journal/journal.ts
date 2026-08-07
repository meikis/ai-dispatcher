// journal.ts — runId allocation, persisted script, per-agent journal records
// journal.ts —— runId 分配、持久化脚本、每个 agent 的 journal 记录

import { createHash, randomBytes } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentRecord } from "../types.js";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${parts.join(",")}}`;
}

export function keyFor(prompt: string, opts: unknown): string {
  return createHash("sha256").update(prompt).update(stableStringify(opts)).digest("hex");
}

export interface Journal {
  runId: string;
  runDir: string;
  persistScript(source: string, ext: string): Promise<string>;
  append(rec: AgentRecord): void;
  appendEvent(event: unknown): void;
  takeCached(key: string): AgentRecord | undefined;
  close(): Promise<void>;
}

function makeRunId(): string {
  const millis36 = Date.now().toString(36);
  const suffix = randomBytes(3).toString("hex");
  return `run-${millis36}-${suffix}`;
}

async function loadResumeCache(journalPath: string): Promise<Map<string, AgentRecord[]>> {
  const cache = new Map<string, AgentRecord[]>();
  let raw: string;
  try {
    raw = await readFile(journalPath, "utf8");
  } catch (err) {
    console.warn(`[journal] resume: cannot read ${journalPath}: ${String(err)} — running fully live`);
    return cache;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let rec: AgentRecord;
    try {
      rec = JSON.parse(trimmed) as AgentRecord;
    } catch {
      console.warn(`[journal] resume: skipping unparseable journal line`);
      continue;
    }
    const queue = cache.get(rec.key);
    if (queue) queue.push(rec);
    else cache.set(rec.key, [rec]);
  }
  return cache;
}

export async function openJournal(params: {
  baseDir: string;
  runId?: string;
  resumeFromRunId?: string;
}): Promise<Journal> {
  const runId = params.runId ?? makeRunId();
  const runDir = path.join(params.baseDir, runId);
  const agentsDir = path.join(runDir, "agents");
  const journalPath = path.join(runDir, "journal.jsonl");
  const eventsPath = path.join(runDir, "events.jsonl");
  await mkdir(agentsDir, { recursive: true });

  let resumeCache: Map<string, AgentRecord[]> | undefined;
  if (params.resumeFromRunId !== undefined) {
    const priorJournal = path.join(params.baseDir, params.resumeFromRunId, "journal.jsonl");
    resumeCache = await loadResumeCache(priorJournal);
  }

  const records: AgentRecord[] = [];
  let appendChain: Promise<void> = Promise.resolve();
  let eventChain: Promise<void> = Promise.resolve();

  const journal: Journal = {
    runId,
    runDir,
    async persistScript(source: string, ext: string): Promise<string> {
      const scriptPath = path.join(runDir, `script.${ext}`);
      try {
        await writeFile(scriptPath, source, "utf8");
      } catch (err) {
        console.warn(`[journal] persistScript failed: ${String(err)}`);
      }
      return scriptPath;
    },
    append(rec: AgentRecord): void {
      records.push(rec);
      const line = `${JSON.stringify(rec)}\n`;
      appendChain = appendChain.then(async () => {
        try {
          await appendFile(journalPath, line, "utf8");
        } catch (err) {
          console.warn(`[journal] append failed: ${String(err)}`);
        }
      });
    },
    appendEvent(event: unknown): void {
      const line = `${JSON.stringify(event)}\n`;
      eventChain = eventChain.then(async () => {
        try {
          await appendFile(eventsPath, line, "utf8");
        } catch (err) {
          console.warn(`[journal] event append failed: ${String(err)}`);
        }
      });
    },
    takeCached(key: string): AgentRecord | undefined {
      const queue = resumeCache?.get(key);
      if (queue === undefined || queue.length === 0) return undefined;
      return queue.shift();
    },
    async close(): Promise<void> {
      await appendChain;
      await eventChain;
    },
  };
  return journal;
}
