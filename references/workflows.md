# 工程编排助手详细使用指南

工程编排助手（Workflow Agent）通过 `import { runWorkflow } from './src/workflows'` 直接调用项目内置的 open-dynamic-workflows 运行时，把大规模、需多 agent 并行 / 对抗验证的工程任务编排成可观测、可 resume 的工作流。它是 5 个领域助手（文件 / 系统 / 应用 / 浏览 / 调研）的**放大器**——不替代它们，而是给它们提供规模化执行后端。

---

## 何时用 workflow（vs 普通派发）

### 识别大规模任务的信号清单

总指挥据此判断「该派工程编排助手而非普通 5 助手」：

1. **规模量词**：任务目标含「整个代码库 / 整个目录 / 数百文件 / 全部模块」等，单助手单轮跑不完。
2. **对抗验证需求**：需要多 agent 并行 + 对抗式验证才保证质量（安全扫描怕误报、bug 审计怕漏报）。
3. **未知规模发现**：穷尽式排查，规模未知，需 loop-until-dry（K 轮无新发现才停）。
4. **多视角融合**：同一问题需多视角独立起草再合成（多份方案对比、多源交叉验证）。
5. **断点续跑需求**：任务耗时长或会中断，需 resume 续跑、已完成零 token 重放。
6. **全程可观测需求**：需要进度树 + journal + per-agent trace 用于事后复盘 / 审计。
7. **跨域大规模编排**：跨 5 个领域助手的大规模编排（如代码库审计 = 文件读源码 + 调研查 CVE + 多 agent 验证）。

命中任一信号 → 优先派工程编排助手。

### 普通派发 vs 工程编排对照表

| 维度 | 普通派发（5 助手） | 工程编排助手 |
|------|-------------------|--------------|
| 任务规模 | 单文件 / 少量文件 / 单轮可完成 | 整个代码库 / 数百文件 / 未知规模 |
| agent 数 | 1–3 个 | 数十至上千（上限 1000） |
| 验证方式 | 单轮人工核对 | 对抗式 / judge panel / loop 自动验证 |
| 可恢复性 | 中断重跑 | resume 续跑，已完成零 token 重放 |
| 可观测性 | 终端输出 | 进度树 + journal + per-agent trace |

---

## 依赖配置

本项目已将 open-dynamic-workflows 源码内嵌在 `src/workflows/` 目录中。工程编排助手通过 `import` 直接调用，无需安装外部 CLI。

### 首次使用引导

**话术**（总指挥对用户说）：

> 「这个任务规模较大（命中信号：X/Y/Z），建议使用工程编排助手来编排多 agent 并行执行，可显著提速并支持断点续跑（中断后零 token 重放已完成部分）。需要先安装一个依赖包 `ajv`（用于 JSON Schema 验证）。是否继续？」

**用户同意后，执行安装**：

```bash
npm install ajv
```

> 注意：`ajv` 是 open-dynamic-workflows 的唯一外部依赖，已在 `package.json` 中声明。如已安装则跳过。

---

## workflow.js 编写要点

workflow.js 用 **Plain JavaScript**（非 TypeScript——无类型注解、interface、泛型），顶层 `await` 可用，顶层 `return <value>` 是 workflow 的结果。

### 1. `meta` 块（必需，必须在最前）

```js
export const meta = {
  name: 'security-audit',                 // 必需
  description: '全代码库安全扫描 + 对抗验证',  // 必需
  whenToUse: '...',                        // 可选
  phases: [                                // 可选，每个 phase() 调用对应一项
    { title: 'Scan', detail: '...' },
    { title: 'Verify', detail: '...', model: 'opus' },
  ],
}
```

必须是**纯字面量**——无变量、函数调用、展开、模板插值。缺失或非字面量会快速失败并报清晰错误。

### 2. 脚本作用域注入的 hooks

| API | 语义 | 关键要点 |
|-----|------|---------|
| `agent(prompt, opts?) → Promise<any>` | 派一个子 agent | 无 `schema` 返回最终文本；有 `schema` 返回验证后的对象；跳过 / 中止返回 `null`（用 `.filter(Boolean)` 过滤） |
| `opts.executor` | **必需**，指定哪个 CLI 跑这个节点 | 如 `'claude'` / `'codex'`；无默认；未知名失败 |
| `opts.label` | 短显示标签 | `{ label: 'review:bugs' }` |
| `opts.phase` | 归到某个进度组 | 在 parallel / pipeline 阶段内用 |
| `opts.schema` | JSON Schema，强制结构化输出 | root 必须 `type:"object"` |
| `opts.model` | 覆盖默认模型 | `{ model: 'opus' }` |
| `opts.isolation` | `'worktree'` 用 fresh git worktree | 昂贵，仅并行改文件时用 |
| `opts.agentType` | 命名子 agent 预设 | `{ agentType: 'reviewer' }` |
| `pipeline(items, stage1, stage2, …) → Promise<any[]>` | **无屏障**，每项独立流过所有阶段 | item A 在阶段 3 时 item B 可在阶段 1；抛错的项落 `null` 并跳过剩余阶段；**这是多阶段工作的默认** |
| `parallel(thunks) → Promise<any[]>` | **屏障**，等全部完成 | 抛错的 thunk 落 `null`，永不 reject；**传函数非 promise**：`parallel(items.map(x => () => agent(...)))` |
| `phase(title)` | 开始一个阶段，后续 `agent()` 归组 | `phase('扫描'); ... phase('验证')` |
| `log(message)` | 进度叙述 | `log('已扫描 50/500 文件')` |
| `args` | 运行输入（来自调用参数），原样 | `const target = args.targetDir` |
| `workflow(nameOrRef, args?) → Promise<any>` | 嵌套调用另一 workflow（仅一层） | 共享并发 / agent / abort |

### 3. per-node executor 可混用 CLI

每个 `agent()` 自带 `executor`，同一段脚本可混用不同 CLI——例如一个 CLI 起草、另一个审查：

```js
const draft = await agent('Draft a fix for this failing test.', { executor: 'claude', label: 'draft' })
const review = await agent(`Independently review this fix — is it correct?\n\n${draft}`, {
  executor: 'codex', label: 'review', schema: VERDICT_SCHEMA,
})
return { draft, review }
```

### 4. 运行时强制的规则（违反即失败）

- **Plain JS only**：禁 `import` / `require` / `fs` / Node API。
- **每个 `agent()` 必须指定 `executor`**：无默认，缺失或未知名直接失败。
- **决定论约束**：`Date.now()` / `Math.random()` / 无参 `new Date()` 不可用（会破坏 resume）；通过 `args` 传时间戳，用 index 而非 random。
- **schema root**：必须 `type:"object"`（判别联合用 enum + 可选字段，非根 `oneOf`）。
- **限制**：并发 `min(16, cpus-2)`；总 agent 上限 1000 per run。

### 5. 默认用 `pipeline()`，必要时才用屏障

`parallel()`（屏障）仅当阶段 N 真的需要阶段 N-1 的**全部**结果时才用——如跨集合去重 / 合并、按总数早退、交叉比对。「我先 map / filter」不是理由（在 pipeline 阶段内做）。屏障会浪费快项的空闲时间等最慢项。

---

## 编排模式速查

| 模式 | 适用场景（一句话） |
|------|-------------------|
| **adversarial verify** | 每个 finding 派 N 个怀疑者反驳，多数反驳则丢弃——抑制误报的安全 / bug 扫描 |
| **perspective-diverse verify** | 不同视角（正确性 / 安全 / 性能 / 可复现）验证同一结论——需要多角度背书的关键判断 |
| **judge panel** | N 个角度生成 + 并行评分 + 合成——起草需多视角融合的方案 / 报告 |
| **loop-until-dry** | 未知规模发现，K 轮无新发现则停——穷尽式排查（全代码库找某类问题） |
| **multi-modal sweep** | 并行不同方式搜索——同一目标多种探测路径的覆盖 |
| **completeness critic** | 最后问「缺什么」，答案是下一轮——确保产出完整性 |

这些模式可组合（如 judge panel + completeness critic）；**任务决定结构，模式只是起点**，必要时可组合新颖的 harness（锦标赛、自修复循环、分级升级等）。

规模按需调：「找点 bug」→ 少量 finder + 单票验证；「彻底审计」→ 更大池 + 3–5 票对抗验证 + 合成。多结果运行**总以一个 synthesis agent 收尾**，返回紧凑的 JSON 可序列化结论。

---

## 运行方式

### 编程式 API（直接调用）

```typescript
import { runWorkflow, builtinExecutors } from './src/workflows';

// 方式一：按路径运行（.odw/<name>/script.js）
const result = await runWorkflow({
  scriptPath: 'path/to/workflow.js',
  args: { targetDir: 'src' },
  signal: controller.signal,         // 取消信号
  onEvent: (e) => {                  // 进度事件回调
    // e.type: 'phase_start' | 'agent_start' | 'agent_end' | 'log' | 'run_end'
    console.log(e);
  },
  executors: builtinExecutors,      // 内置 claude + codex
});

// 方式二：按源码字符串运行
const result2 = await runWorkflow({
  script: `
    export const meta = {
      name: 'my-workflow',
      description: '...',
    };
    // ... workflow 逻辑
    return { findings: [...] };
  `,
  args: { dir: 'src' },
});

// result: { runId, value, tokensSpent, agentCount, durationMs, events, ... }
// value 是脚本 return 的值
```

### 参数说明

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `scriptPath` | string | 二选一 | workflow.js 文件路径 |
| `script` | string | 二选一 | workflow 源码字符串 |
| `baseDir` | string | 否 | 运行产物落盘目录，默认 `.odw/runs/` |
| `model` | string | 否 | 默认模型，覆盖 meta.model |
| `concurrency` | number | 否 | 并发上限，默认 `min(16, cpus-2)` |
| `args` | unknown | 否 | 传递给 workflow 的参数，通过 `args` 变量访问 |
| `signal` | AbortSignal | 否 | 取消信号，Ctrl-C 时传递 |
| `onEvent` | (event) => void | 否 | 进度事件回调，接收 ProgressEvent |
| `executors` | Record<string, Executor> | 否 | 自定义 executor 注册表，内置 `builtinExecutors`（claude + codex） |
| `resumeFromRunId` | string | 否 | 从上次运行 ID 续跑 |

### 返回值

```typescript
interface WorkflowResult {
  runId: string;              // 本次运行唯一 ID
  runDir: string;             // 运行产物目录
  value: unknown;             // workflow 的 return 值
  tokensSpent: number;        // 本次运行消耗的 token
  agentCount: number;         // 总 agent 数
  durationMs: number;         // 运行耗时（毫秒）
  events: ProgressEvent[];    // 所有进度事件
}
```

### 取消与续跑

```typescript
// 取消
const controller = new AbortController();
const result = await runWorkflow({
  scriptPath: 'workflow.js',
  signal: controller.signal,
});
// Ctrl-C 或调用 controller.abort()
// 已完成的 agent 保留在 journal 中

// 续跑（中断后）
const resumed = await runWorkflow({
  scriptPath: 'workflow.js',
  resumeFromRunId: 'run-abc123',   // 上次运行 ID
});
// 已完成且 (prompt, opts) 未变的 agent() 从缓存重放，零 token
// 其余 agent 现场跑
```

---

## 限制与约束

- **并发上限**：`min(16, cpus-2)`，小机器更少。
- **总 agent 上限**：1000 per run。
- **Plain JS only**：禁 `import` / `require` / `fs` / Node API。
- **强制 executor**：每个 `agent()` 必须指定 `executor`，无默认。
- **决定论约束**：禁 `Date.now()` / `Math.random()` / 无参 `new Date`（破坏 resume）。
- **schema root**：必须 `type:"object"`。
- **嵌套**：`workflow()` 仅一层。

---

## 可观测性与 resume

### 可观测性

- **进度事件**：通过 `onEvent` 回调接收所有进度事件（phase_start / agent_start / agent_end / log / run_end）。
- **落盘产物**：每次运行的产物自动保存到 `baseDir/<runId>/`：
  - `journal.jsonl` — 运行元数据与 agent 记录
  - `events.jsonl` — 所有 ProgressEvent
  - `script.js` — workflow 源码快照
  - `agents/agent-N.jsonl` — 每个 agent 的详细 trace
- **调试模式**：设置环境变量 `ODW_DEBUG=1` 可在 stderr 输出 spawn 参数、退出状态和 stderr 末尾。
- **失败诊断**：`agent_end` 事件的 `error` 字段会内联显示失败原因，如 `agent failed (subtype=error_during_execution): You've hit your usage limit…`。

### resume（断点续跑）

- 通过 `resumeFromRunId` 参数传入上次运行 ID。
- 已完成且 `(prompt, opts)` 未变的 `agent()` 从缓存重放，**零 token 消耗**。
- 其余 agent 现场跑。
- Ctrl-C 取消：杀进程树，已完成保留，可后续 resume。

---

## 与 5 个领域助手的关系

工程编排助手是**放大器**，不替代 5 个领域助手：

- 5 个助手处理**单领域、单轮可完成**的任务。
- 工程编排助手处理**规模超出单助手单轮能力**的大任务。
- 每个子 agent 干的活仍落在 5 个助手的能力域（读文件、调研、浏览等），只是被 workflow.js 编排起来并行 / 对抗 / 迭代。

### 典型大规模任务 → 编排模式 → 复用助手能力域

| 大规模任务 | 编排模式 | 复用的助手能力域 |
|-----------|---------|-----------------|
| 代码库安全审计 | adversarial verify | 文件（读源码）+ 调研（查 CVE） |
| 数百文件框架迁移 | pipeline + loop-until-dry | 文件（批量改写） |
| 多源交叉验证研究 | judge panel | 调研（多源）+ 浏览（抓取） |
| 多视角方案起草 | judge panel + completeness critic | 调研（背景）+ 文件（落盘） |
