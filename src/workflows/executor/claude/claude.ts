// claude.ts — the only module that touches `claude`.
// claude.ts —— 唯一直接调用 `claude` 的模块。

import type { ExecOptions, Executor } from "../../types.js";
import { parseStreamJsonLine, reduceStreamJsonEvents } from "./stream-json.js";
import { type ExecResultCore, makeSubprocessExecutor } from "../subprocess.js";

export function buildClaudeArgs(opts: ExecOptions): string[] {
  const args: string[] = [
    "--print",
    "--output-format=stream-json",
    "--verbose",
    "--permission-mode",
    "acceptEdits",
  ];
  if (opts.model) args.push("--model", opts.model);
  if (opts.schema) args.push("--json-schema", JSON.stringify(opts.schema));
  if (opts.appendSystemPrompt) args.push("--append-system-prompt", opts.appendSystemPrompt);
  if (opts.resumeSessionId) args.push("--resume", opts.resumeSessionId);
  return args;
}

function reduceClaude(events: unknown[], ctx: { stderr: string }): ExecResultCore {
  const outcome = reduceStreamJsonEvents(events as any[]);
  const core: ExecResultCore = {
    text: outcome.text,
    sessionId: outcome.sessionId,
    costUsd: outcome.costUsd,
    resultSubtype: outcome.resultSubtype,
    isError: outcome.isError,
    usage: outcome.usage,
  };
  if (outcome.structuredOutput !== undefined) {
    core.structuredOutput = outcome.structuredOutput;
  }
  if (core.isError && ctx.stderr.trim().length > 0 && core.text.length === 0) {
    core.text = ctx.stderr.trim();
  }
  return core;
}

export const claudeExecutor: Executor = makeSubprocessExecutor({
  command: "claude",
  prepare: async (opts) => ({ args: buildClaudeArgs(opts), stdin: opts.prompt }),
  parseLine: parseStreamJsonLine,
  reduce: (events, { stderr }) => reduceClaude(events, { stderr }),
});
