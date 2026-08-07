// types.ts — the FROZEN contract for the whole runtime.
// types.ts —— 整个运行时的冻结契约。
//
// Every module codes against these types. Do not change a shape without updating
// 每个模块都针对这些类型编码。改任何形状都要同步更新
// every consumer. Public API types and internal cross-module shapes both live here so
// 每一个消费方。公开 API 类型和内部跨模块形状都放在这里，
// there is one source of truth.
// 这样就有唯一的事实来源。

// JSON Schema (loose — we pass it through to the CLI and to ajv)
// JSON Schema（宽松定义 —— 我们把它透传给 CLI 和 ajv）
export type JsonSchema = Record<string, unknown>;

// meta 块
export interface PhaseMeta {
  readonly title: string;
  readonly detail?: string;
  readonly model?: string;
}
export interface WorkflowMeta {
  readonly name: string;
  readonly description: string;
  readonly whenToUse?: string;
  readonly phases?: ReadonlyArray<PhaseMeta>;
  readonly model?: string;
}

// 全局常量
export const TOTAL_AGENT_CAP = 1000;

// Executor
export interface Executor {
  readonly name: string;
  runPrompt(opts: ExecOptions): Promise<ExecResult>;
}

export interface ExecOptions {
  prompt: string;
  schema?: JsonSchema;
  model?: string;
  appendSystemPrompt?: string;
  resumeSessionId?: string;
}

export interface ExecResult {
  text: string;
  structuredOutput?: unknown;
  sessionId: string | null;
  costUsd: number;
  resultSubtype: string;
  isError: boolean;
  usage: { inputTokens: number; outputTokens: number };
  durationMs: number;
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

export interface ResultSubtype {
  subtype: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

// Progress
export interface ProgressEvent {
  type: "phase_start" | "agent_start" | "agent_end" | "log" | "run_end";
  phaseTitle?: string;
  phase?: string;
  agentId?: number;
  label?: string;
  text?: string;
  cached?: boolean;
  costUsd?: number;
  durationMs?: number;
  error?: string;
}

export interface EventSink {
  (event: ProgressEvent): void;
}

// Run context
export interface RunContext {
  runId: string;
  runDir: string;
  baseDir: string;
  cwd: string;
  model: string;
  args: unknown;
  concurrency: number;
  abortSignal: AbortSignal;
  semaphore: { acquire(): Promise<void>; release(): void; active: number; limit: number };
  agentCounter: { next(): number; count: number };
  nestedDepth: number;
  journal: {
    runId: string;
    runDir: string;
    persistScript(source: string, ext: string): Promise<string>;
    append(rec: AgentRecord): void;
    appendEvent(event: unknown): void;
    takeCached(key: string): AgentRecord | undefined;
    close(): Promise<void>;
  };
  emit(event: ProgressEvent): void;
}

// Script hooks
export interface ScriptHooks {
  agent(prompt: string, opts?: AgentOptions): Promise<any>;
  pipeline<T, R>(
    items: readonly T[],
    ...stages: Array<(prev: any, item: T, index: number) => Promise<R>>
  ): Promise<R[]>;
  parallel<T>(thunks: ReadonlyArray<Thunk<T>>): Promise<T[]>;
  phase(title: string): void;
  log(message: string): void;
  workflow(ref: WorkflowRef, args?: unknown): Promise<unknown>;
  readonly args: unknown;
}

export type Thunk<T> = () => Promise<T>;

export interface AgentOptions {
  executor: string;
  label?: string;
  phase?: string;
  schema?: JsonSchema;
  model?: string;
  isolation?: "worktree";
  agentType?: string;
}

export interface AgentRecord {
  key: string;
  agentId: number;
  prompt: string;
  opts: AgentOptions;
  result: any;
  cached: boolean;
  timestamp: string;
}

export interface WorkflowRef {
  nameOrPath: string;
  args?: unknown;
}

// Run options and result
export interface RunOptions {
  scriptPath?: string;
  script?: string;
  baseDir?: string;
  registryDir?: string;
  model?: string;
  concurrency?: number;
  signal?: AbortSignal;
  args?: unknown;
  onEvent?: EventSink;
  executors?: Record<string, Executor>;
  resumeFromRunId?: string;
}

export interface WorkflowResult {
  runId: string;
  runDir: string;
  value: unknown;
  tokensSpent: number;
  agentCount: number;
  durationMs: number;
  events: ProgressEvent[];
}
