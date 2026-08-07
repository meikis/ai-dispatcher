// codex.ts — the only module that touches `codex`.
// codex.ts —— 唯一直接调用 `codex` 的模块。

import { randomBytes } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecOptions, Executor } from "../../types.js";
import { parseCodexJsonLine, reduceCodexEvents } from "./codex-jsonl.js";
import { type ExecResultCore, makeSubprocessExecutor } from "../subprocess.js";

export function buildCodexArgs(opts: ExecOptions, schemaPath?: string): string[] {
  const args: string[] = [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--color",
    "never",
    "--sandbox",
    "workspace-write",
  ];
  if (opts.model) args.push("-m", opts.model);
  if (schemaPath) args.push("--output-schema", schemaPath);
  if (opts.appendSystemPrompt) {
    args.push("-c", `developer_instructions=${opts.appendSystemPrompt}`);
  }
  args.push("-");
  return args;
}

function reduceCodex(
  events: unknown[],
  ctx: { stderr: string; exitCode: number | null; opts: ExecOptions },
): ExecResultCore {
  const outcome = reduceCodexEvents(events as any[], {
    schema: ctx.opts.schema !== undefined,
    exitCode: ctx.exitCode,
  });
  const core: ExecResultCore = {
    text: outcome.text,
    sessionId: outcome.sessionId,
    costUsd: 0,
    resultSubtype: outcome.resultSubtype,
    isError: outcome.isError,
    usage: {
      inputTokens: outcome.usage.inputTokens,
      outputTokens: outcome.usage.outputTokens,
    },
  };
  if (outcome.structuredOutput !== undefined) {
    core.structuredOutput = outcome.structuredOutput;
  }
  if (core.isError && ctx.stderr.trim().length > 0 && core.text.length === 0) {
    core.text = ctx.stderr.trim();
  }
  return core;
}

export const codexExecutor: Executor = makeSubprocessExecutor({
  command: "codex",
  prepare: async (opts) => {
    if (opts.schema === undefined) {
      return { args: buildCodexArgs(opts), stdin: opts.prompt };
    }
    const schemaPath = join(
      tmpdir(),
      `codex-schema-${randomBytes(8).toString("hex")}.json`,
    );
    await writeFile(schemaPath, JSON.stringify(opts.schema));
    return {
      args: buildCodexArgs(opts, schemaPath),
      stdin: opts.prompt,
      cleanup: () => unlink(schemaPath).catch(() => {}),
    };
  },
  parseLine: parseCodexJsonLine,
  reduce: (events, { stderr, exitCode, opts }) =>
    reduceCodex(events, { stderr, exitCode, opts }),
});
