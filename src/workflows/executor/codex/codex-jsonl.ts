// codex-jsonl.ts — pure reducer over `codex exec --json` stdout
// codex-jsonl.ts —— 对 `codex exec --json` stdout 的纯 reducer

export interface CodexOutcome {
  text: string;
  structuredOutput?: unknown;
  sessionId: string | null;
  resultSubtype: string;
  isError: boolean;
  usage: { inputTokens: number; outputTokens: number };
}

export function parseCodexJsonLine(line: string): any | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function toFiniteNumber(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function reduceCodexEvents(
  events: any[],
  opts?: { schema?: boolean; exitCode?: number | null },
): CodexOutcome {
  let lastAgentText: string | null = null;
  let sessionId: string | null = null;
  let sawCompleted = false;
  let sawTurnFailed = false;
  let errorMessage = "";
  const outcome: CodexOutcome = {
    text: "",
    sessionId: null,
    resultSubtype: "error_during_execution",
    isError: true,
    usage: { inputTokens: 0, outputTokens: 0 },
  };
  for (const event of events) {
    if (!isObject(event)) continue;
    const type = event["type"];
    if (type === "thread.started") {
      const tid = event["thread_id"];
      if (typeof tid === "string") sessionId = tid;
      continue;
    }
    if (type === "item.completed") {
      const item = event["item"];
      if (isObject(item) && item["type"] === "agent_message") {
        const text = item["text"];
        if (typeof text === "string") lastAgentText = text;
      }
      continue;
    }
    if (type === "turn.completed") {
      sawCompleted = true;
      const usage = event["usage"];
      if (isObject(usage)) {
        outcome.usage.inputTokens = toFiniteNumber(usage["input_tokens"]);
        outcome.usage.outputTokens = toFiniteNumber(usage["output_tokens"]);
      }
      continue;
    }
    if (type === "turn.failed") {
      sawTurnFailed = true;
      const error = event["error"];
      if (isObject(error) && typeof error["message"] === "string") {
        errorMessage = error["message"];
      }
      continue;
    }
    if (type === "error") {
      const message = event["message"];
      if (typeof message === "string") errorMessage = message;
      continue;
    }
  }
  outcome.sessionId = sessionId;
  outcome.text = lastAgentText ?? "";
  const exitCode = opts?.exitCode;
  let isError =
    !sawCompleted ||
    sawTurnFailed ||
    (exitCode != null && exitCode !== 0);
  if (opts?.schema) {
    try {
      outcome.structuredOutput = JSON.parse(outcome.text);
    } catch {
      isError = true;
    }
  }
  outcome.isError = isError;
  outcome.resultSubtype = isError ? "error_during_execution" : "success";
  if (isError && outcome.text.length === 0 && errorMessage.length > 0) {
    outcome.text = errorMessage;
  }
  return outcome;
}
