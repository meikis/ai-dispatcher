// hooks.ts — the orchestration hooks (agent/parallel/pipeline/phase/log/args/workflow)
// hooks.ts —— 编排钩子（agent/parallel/pipeline/phase/log/args/workflow）

import { execFileSync } from "node:child_process";
import path from "node:path";
import type {
  AgentOptions,
  AgentRecord,
  ExecOptions,
  RunContext,
  ScriptHooks,
  Thunk,
  WorkflowRef,
} from "../types.js";
import { keyFor } from "../journal/journal.js";
import { assertObjectRootSchema, validateAgainstSchema } from "../schema/validate.js";
import type { Semaphore } from "./semaphore.js";

export interface HookDeps {
  semaphore: Semaphore;
  runNested: (ref: WorkflowRef, args: unknown) => Promise<unknown>;
  args: unknown;
}

const AGENT_TYPE_PRESETS: Readonly<Record<string, string>> = {
  Explore:
    "You are a read-only exploration subagent. Investigate and report findings; do not modify files.",
  Plan: "You are a planning subagent. Draft a plan for the user's request; do not modify files.",
  Review: "You are a review subagent. Review the given code/artifact for correctness, security, and quality; do not modify files.",
  Implement: "You are an implementation subagent. Implement the requested changes; you may modify files.",
  Test: "You are a testing subagent. Run tests and report results; do not modify files other than test files.",
};

export function createHooks(
  ctx: RunContext,
  deps: HookDeps,
  executors: Record<string, any>,
): ScriptHooks {
  const { semaphore, runNested, args } = deps;

  async function agent(prompt: string, opts?: AgentOptions): Promise<any> {
    const agentId = ctx.agentCounter.next();
    const executorName = opts?.executor;

    if (!executorName) {
      throw new Error("agent() requires an explicit {executor} name (no default)");
    }
    const executor = executors[executorName];
    if (!executor) {
      throw new Error(`executor '${executorName}' not found in registry`);
    }

    const key = keyFor(prompt, opts);
    const cached = ctx.journal.takeCached(key);
    if (cached) {
      ctx.emit({ type: "agent_start", agentId, label: opts?.label ?? `agent-${agentId}`, phase: opts?.phase, cached: true });
      ctx.emit({ type: "agent_end", agentId, cached: true });
      return cached.result;
    }

    await semaphore.acquire();
    ctx.emit({ type: "agent_start", agentId, label: opts?.label ?? `agent-${agentId}`, phase: opts?.phase });

    try {
      const execOpts: ExecOptions = {
        prompt,
        schema: opts?.schema,
        model: opts?.model,
        appendSystemPrompt: opts?.agentType
          ? AGENT_TYPE_PRESETS[opts.agentType] ?? `You are a ${opts.agentType} subagent.`
          : undefined,
      };

      const result = await executor.runPrompt(execOpts);

      let value: any;
      if (opts?.schema && result.structuredOutput !== undefined) {
        const validation = validateAgainstSchema(opts.schema, result.structuredOutput);
        if (!validation.ok) {
          throw new Error(`Schema validation failed: ${validation.errors}`);
        }
        value = result.structuredOutput;
      } else if (opts?.schema && result.text) {
        try {
          const parsed = JSON.parse(result.text);
          assertObjectRootSchema(opts.schema);
          const validation = validateAgainstSchema(opts.schema, parsed);
          if (!validation.ok) {
            throw new Error(`Schema validation failed: ${validation.errors}`);
          }
          value = parsed;
        } catch {
          value = result.text;
        }
      } else {
        value = result.text;
      }

      const record: AgentRecord = {
        key,
        agentId,
        prompt,
        opts: opts as any,
        result: value,
        cached: false,
        timestamp: new Date().toISOString(),
      };
      ctx.journal.append(record);

      ctx.emit({
        type: "agent_end",
        agentId,
        costUsd: result.costUsd,
        durationMs: result.durationMs,
      });

      return value;
    } catch (err) {
      ctx.emit({
        type: "agent_end",
        agentId,
        error: String(err),
      });
      throw err;
    } finally {
      semaphore.release();
    }
  }

  async function pipeline<T, R>(
    items: readonly T[],
    ...stages: Array<(prev: any, item: T, index: number) => Promise<R>>
  ): Promise<R[]> {
    const results: R[] = new Array(items.length);
    await Promise.all(
      items.map((item, index) =>
        (async () => {
          let prev: any = undefined;
          for (const stage of stages) {
            try {
              prev = await stage(prev, item, index);
            } catch {
              return;
            }
          }
          results[index] = prev as R;
        })(),
      ),
    );
    return results.filter((r) => r !== undefined) as R[];
  }

  async function parallel<T>(thunks: ReadonlyArray<Thunk<T>>): Promise<T[]> {
    const results = await Promise.allSettled(thunks.map((t) => t()));
    return results.map((r) => {
      if (r.status === "fulfilled") return r.value as T;
      return null as any;
    });
  }

  function phase(title: string): void {
    ctx.emit({ type: "phase_start", phaseTitle: title });
  }

  function log(message: string): void {
    ctx.emit({ type: "log", text: message });
  }

  async function workflow(ref: WorkflowRef, nestedArgs?: unknown): Promise<unknown> {
    if (ctx.nestedDepth >= 1) {
      throw new Error("workflow() nesting is limited to one level");
    }
    return runNested(ref, nestedArgs);
  }

  return { agent, pipeline, parallel, phase, log, workflow, args };
}
