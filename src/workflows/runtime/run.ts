// run.ts — runWorkflow(): the INTEGRATOR.
// run.ts —— runWorkflow()：集成器（INTEGRATOR）。

import os from "node:os";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  RunOptions,
  WorkflowResult,
  RunContext,
  ProgressEvent,
  WorkflowMeta,
  EventSink,
  WorkflowRef,
} from "../types.js";
import { TOTAL_AGENT_CAP } from "../types.js";
import { extractMeta, runScript, hasDeterminismBreakers } from "./sandbox.js";
import { createHooks } from "./hooks.js";
import { createSemaphore, createCounter } from "./semaphore.js";
import { openJournal } from "../journal/journal.js";
import { claudeExecutor } from "../executor/claude/claude.js";
import { codexExecutor } from "../executor/codex/codex.js";

const now = (): string => new Date().toISOString();

async function readRegistryScript(
  registryDir: string,
  name: string,
): Promise<{ source: string; ext: string }> {
  for (const ext of ["js", "mjs"] as const) {
    try {
      const source = await readFile(path.join(registryDir, name, `script.${ext}`), "utf8");
      return { source, ext };
    } catch {
      // try next extension
    }
  }
  throw new Error(`workflow '${name}' not found in ${registryDir}`);
}

export async function runWorkflow(options: RunOptions): Promise<WorkflowResult> {
  const {
    scriptPath,
    script: inlineScript,
    baseDir,
    registryDir,
    model,
    concurrency,
    signal,
    args: inputArgs,
    onEvent,
    executors: customExecutors,
    resumeFromRunId,
  } = options;

  const eventSink: EventSink = onEvent ?? ((e: ProgressEvent) => {});

  // Determine source
  let source: string;
  let ext = "js";
  if (inlineScript) {
    source = inlineScript;
  } else if (scriptPath) {
    source = await readFile(scriptPath, "utf8");
  } else if (registryDir) {
    const name = path.basename(path.dirname(scriptPath ?? registryDir));
    const result = await readRegistryScript(registryDir, name);
    source = result.source;
    ext = result.ext;
  } else {
    throw new Error("runWorkflow requires either scriptPath, script, or registryDir");
  }

  // Determinism pre-flight check
  if (hasDeterminismBreakers(source)) {
    throw new Error(
      "workflow script references Date.now, Math.random, or new Date() — these are not allowed (would break resume). Pass timestamps via args; vary by index instead of random.",
    );
  }

  // Extract meta
  const meta: WorkflowMeta = extractMeta(source);

  // Open journal
  const effectiveBaseDir = baseDir ?? path.join(process.cwd(), ".odw", "runs");
  const journal = await openJournal({
    baseDir: effectiveBaseDir,
    resumeFromRunId,
  });

  // Persist script
  await journal.persistScript(source, ext);

  // Build executors registry
  const builtinExecutors = { claude: claudeExecutor, codex: codexExecutor };
  const mergedExecutors = customExecutors
    ? { ...builtinExecutors, ...customExecutors }
    : builtinExecutors;

  // Build context
  const limit = concurrency ?? Math.min(16, os.cpus().length - 2);
  const semaphore = createSemaphore(limit);
  const agentCounter = createCounter(TOTAL_AGENT_CAP);

  const ctx: RunContext = {
    runId: journal.runId,
    runDir: journal.runDir,
    baseDir: effectiveBaseDir,
    cwd: process.cwd(),
    model: model ?? meta.model ?? "default",
    args: inputArgs ?? meta.name,
    concurrency: limit,
    abortSignal: signal ?? new AbortController().signal,
    semaphore,
    agentCounter,
    nestedDepth: 0,
    journal: journal as any,
    emit: eventSink,
  };

  // Build nested runner
  const runNested = async (ref: WorkflowRef, nestedArgs: unknown): Promise<unknown> => {
    ctx.nestedDepth++;
    try {
      if (ref.nameOrPath.includes("/") || ref.nameOrPath.includes("\\")) {
        const source = await readFile(ref.nameOrPath, "utf8");
        const nestedMeta = extractMeta(source);
        if (hasDeterminismBreakers(source)) {
          throw new Error(`nested workflow '${nestedMeta.name}' has determinism violations`);
        }
        const hooks = createHooks(
          { ...ctx, nestedDepth: ctx.nestedDepth },
          { semaphore, runNested, args: nestedArgs },
          mergedExecutors,
        );
        return await runScript(source, hooks, nestedArgs);
      } else {
        if (!registryDir) {
          throw new Error("registryDir is required for named nested workflows");
        }
        const result = await readRegistryScript(registryDir, ref.nameOrPath);
        const nestedMeta = extractMeta(result.source);
        if (hasDeterminismBreakers(result.source)) {
          throw new Error(`nested workflow '${nestedMeta.name}' has determinism violations`);
        }
        const hooks = createHooks(
          { ...ctx, nestedDepth: ctx.nestedDepth },
          { semaphore, runNested, args: nestedArgs },
          mergedExecutors,
        );
        return await runScript(result.source, hooks, nestedArgs);
      }
    } finally {
      ctx.nestedDepth--;
    }
  };

  // Build hooks
  const hooks = createHooks(
    ctx,
    { semaphore, runNested, args: inputArgs },
    mergedExecutors,
  );

  // Emit phase events from meta
  if (meta.phases) {
    for (const phase of meta.phases) {
      eventSink({ type: "phase_start", phaseTitle: phase.title });
    }
  }

  const startTime = Date.now();
  let value: unknown;
  let tokensSpent = 0;
  let agentCount = 0;

  try {
    value = await runScript(source, hooks, inputArgs);

    const durationMs = Date.now() - startTime;
    eventSink({
      type: "run_end",
    });

    await journal.close();

    const result: WorkflowResult = {
      runId: journal.runId,
      runDir: journal.runDir,
      value,
      tokensSpent,
      agentCount: agentCounter.count,
      durationMs,
      events: [],
    };

    return result;
  } catch (err) {
    const durationMs = Date.now() - startTime;
    eventSink({
      type: "run_end",
    });

    await journal.close();

    throw err;
  }
}
