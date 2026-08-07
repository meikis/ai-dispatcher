// stream-json.ts — pure reducer over `claude --print --output-format=stream-json`
// stream-json.ts —— 对 `claude --print --output-format=stream-json` 的纯 reducer

export interface StreamJsonOutcome {
  text: string;
  structuredOutput?: unknown;
  sessionId: string | null;
  costUsd: number;
  resultSubtype: string;
  isError: boolean;
  usage: { inputTokens: number; outputTokens: number };
}

export function parseStreamJsonLine(line: string): any | null {
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

function extractAssistantText(event: Record<string, unknown>): string {
  const message = event["message"];
  if (!isObject(message)) return "";
  const content = message["content"];
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const block of content) {
    if (!isObject(block)) continue;
    if (block["type"] === "text" && typeof block["text"] === "string") {
      out += block["text"];
    }
  }
  return out;
}

export function reduceStreamJsonEvents(events: any[]): StreamJsonOutcome {
  let text = "";
  let sessionId: string | null = null;
  let sawResult = false;
  const outcome: StreamJsonOutcome = {
    text: "",
    sessionId: null,
    costUsd: 0,
    resultSubtype: "error_during_execution",
    isError: true,
    usage: { inputTokens: 0, outputTokens: 0 },
  };
  for (const event of events) {
    if (!isObject(event)) continue;
    const type = event["type"];
    if (type === "assistant") {
      text += extractAssistantText(event);
      continue;
    }
    if (type === "result") {
      sawResult = true;
      const subtype = event["subtype"];
      outcome.resultSubtype =
        typeof subtype === "string" && subtype.length > 0
          ? subtype
          : "success";
      outcome.isError =
        typeof event["is_error"] === "boolean"
          ? (event["is_error"] as boolean)
          : outcome.resultSubtype !== "success";
      outcome.costUsd = toFiniteNumber(event["total_cost_usd"]);
      const sid = event["session_id"];
      if (typeof sid === "string") sessionId = sid;
      const usage = event["usage"];
      if (isObject(usage)) {
        outcome.usage.inputTokens = toFiniteNumber(usage["input_tokens"]);
        outcome.usage.outputTokens = toFiniteNumber(usage["output_tokens"]);
      }
      if ("structured_output" in event) {
        outcome.structuredOutput = event["structured_output"];
      }
      continue;
    }
  }
  outcome.text = text;
  outcome.sessionId = sessionId;
  if (!sawResult) {
    outcome.resultSubtype = "error_during_execution";
    outcome.isError = true;
    outcome.costUsd = 0;
    outcome.usage.inputTokens = 0;
    outcome.usage.outputTokens = 0;
  }
  return outcome;
}
