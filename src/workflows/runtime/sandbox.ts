// sandbox.ts — extract the `meta` literal and run the workflow script in node:vm.
// sandbox.ts —— 提取 `meta` 字面量，并在 node:vm 中运行 workflow 脚本。

import vm from "node:vm";
import type { WorkflowMeta, ScriptHooks } from "../types.js";

const META_DECL_RE = /(?:^|\n)\s*(?:export\s+)?const\s+meta\s*=/;

const DETERMINISM_BAN_RE = /\b(Date\.now|Math\.random)\s*\(|new\s+Date\s*\(\s*\)/;

export function hasDeterminismBreakers(source: string): boolean {
  return DETERMINISM_BAN_RE.test(source);
}

export function extractMeta(source: string): WorkflowMeta {
  const match = source.match(META_DECL_RE);
  if (!match) {
    throw new Error("workflow script must declare `const meta = {...}` at the top");
  }
  const start = match.index! + match[0].length;
  // Balanced-brace scan
  let depth = 0;
  let i = start;
  let inString: string | null = null;
  let escaped = false;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (escaped) { escaped = false; continue; }
    if (inString) {
      if (ch === "\\") { escaped = true; continue; }
      if (ch === inString) { inString = null; }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inString = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  const literal = source.slice(start, i);
  const sandbox: any = {};
  try {
    vm.runInNewContext("meta = " + literal, sandbox, { timeout: 1000 });
  } catch (err) {
    throw new Error(`meta block must be a pure literal (no variables, functions, or templates): ${String(err)}`);
  }
  if (!sandbox.meta || typeof sandbox.meta !== "object") {
    throw new Error("meta block must produce an object");
  }
  const meta = sandbox.meta as WorkflowMeta;
  if (!meta.name || typeof meta.name !== "string") {
    throw new Error("meta.name is required and must be a string");
  }
  if (!meta.description || typeof meta.description !== "string") {
    throw new Error("meta.description is required and must be a string");
  }
  return meta;
}

export async function runScript(source: string, hooks: ScriptHooks, args: unknown): Promise<unknown> {
  // Strip top-level `export` keyword so the script runs as plain module code
  const stripped = source
    .replace(/^\s*export\s+const\s+/gm, "const ")
    .replace(/^\s*export\s+async\s+function\s+/gm, "async function ")
    .replace(/^\s*export\s+function\s+/gm, "function ")
    .replace(/^\s*export\s+default\s+/gm, "const __default =");

  // Build the script body
  const body = `
    "use strict";
    const __result = (async () => {
      ${stripped}
    })();
    __result;
  `;

  const context: any = {
    agent: hooks.agent,
    pipeline: hooks.pipeline,
    parallel: hooks.parallel,
    phase: hooks.phase,
    log: hooks.log,
    workflow: hooks.workflow,
    args: hooks.args ?? args,
    // Determinism traps
    Date: new Proxy(Date, {
      get(target, prop) {
        if (prop === "now" || prop === "parse" || prop === "UTC") {
          throw new Error(`Determinism violation: ${String(prop)}() is not allowed in workflow scripts`);
        }
        return (target as any)[prop];
      },
      construct(target, args) {
        if (args.length === 0) {
          throw new Error("Determinism violation: new Date() without arguments is not allowed");
        }
        return Reflect.construct(target, args as any[]);
      },
    }),
    Math: new Proxy(Math, {
      get(target, prop) {
        if (prop === "random") {
          throw new Error("Determinism violation: Math.random() is not allowed in workflow scripts");
        }
        return (target as any)[prop];
      },
    }),
    console: { log: hooks.log, warn: hooks.log, error: hooks.log, info: hooks.log },
  };

  try {
    const result = await vm.runInNewContext(body, context, {
      timeout: 30 * 60 * 1000,
    });
    return result;
  } catch (err) {
    throw new Error(`workflow script failed: ${String(err)}`);
  }
}
