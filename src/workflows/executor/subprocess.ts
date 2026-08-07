// subprocess.ts — CLI-agnostic streaming subprocess driver.
// subprocess.ts —— 与具体 CLI 无关的流式子进程 driver。

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ExecOptions, ExecResult, Executor } from "../types.js";

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEBUG = process.env.ODW_DEBUG === "1";

export interface SubprocessSpec {
  command: string;
  prepare: (opts: ExecOptions) => Promise<{ args: string[]; stdin?: string; cleanup?: () => void }>;
  parseLine: (line: string) => any | null;
  reduce: (events: any[], ctx: { stderr: string; exitCode: number | null; opts: ExecOptions }) => any;
}

export interface ExecResultCore {
  text: string;
  structuredOutput?: unknown;
  sessionId: string | null;
  costUsd: number;
  resultSubtype: string;
  isError: boolean;
  usage: { inputTokens: number; outputTokens: number };
}

export function makeSubprocessExecutor(spec: SubprocessSpec): Executor {
  return {
    name: spec.command,
    async runPrompt(opts: ExecOptions): Promise<ExecResult> {
      const startTime = Date.now();
      const events: any[] = [];
      let stderr = "";
      let exitCode: number | null = null;

      const { args, stdin, cleanup } = await spec.prepare(opts);

      if (DEBUG) {
        console.warn(`[executor] spawn ${spec.command} ${args.join(" ")}`);
      }

      return new Promise<ExecResult>((resolve) => {
        const child = spawn(spec.command, args, {
          stdio: ["pipe", "pipe", "pipe"],
        });

        const timeout = setTimeout(() => {
          child.kill("SIGTERM");
        }, DEFAULT_TIMEOUT_MS);

        child.stdout?.on("data", (data) => {
          const lines = data.toString().split("\n");
          for (const line of lines) {
            const parsed = spec.parseLine(line);
            if (parsed) events.push(parsed);
          }
        });

        child.stderr?.on("data", (data) => {
          stderr += data.toString();
        });

        child.on("close", (code) => {
          clearTimeout(timeout);
          exitCode = code;
          const core = spec.reduce(events, { stderr, exitCode, opts }) as ExecResultCore;
          const durationMs = Date.now() - startTime;

          if (cleanup) cleanup();

          if (DEBUG && core.isError && stderr.trim().length > 0) {
            console.warn(`[executor] stderr tail: ${stderr.trim().slice(-500)}`);
          }

          resolve({
            ...core,
            durationMs,
          });
        });

        if (stdin) {
          child.stdin?.write(stdin);
          child.stdin?.end();
        }
      });
    },
  };
}
