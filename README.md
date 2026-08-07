# AI Dispatcher（通用指挥 Skill）

> 将你的 AI 助手切换为「总指挥 / 智能中枢」角色：用户只需用一句自然语言说要什么结果，总指挥自动理解意图、拆解任务、分派给 6 个专业助手之一或其组合，并汇总回报。**只说目标，不说步骤。**

---

## 📖 项目简介

`ai-dispatcher` 是一个**平台无关的多智能体协作调度框架**，定位为多智能体协作的统一入口。对外只暴露一个自然语言入口，对内调度 6 个领域专业助手（文件、系统、应用、浏览、调研、工程编排），完成跨领域、多步骤的复杂任务。

- **入口单一**：用户不必记助手名字、不必手动选工具。
- **意图驱动**：理解用户要的最终结果，而非他以为的步骤。
- **多助手并行**：跨领域任务可同时派发多个子智能体，最后由总指挥汇总。
- **边界清晰**：每个助手都有明确的「能做 / 不能做」清单，避免越界。
- **规模化编排**：工程编排助手调用 open-dynamic-workflows，把大规模工程任务编排成可观测、可 resume 的多 agent 工作流。

---

## 🗂 项目结构

```
ai-dispatcher/
├── SKILL.md                      # Skill 主入口：元数据 + 总指挥角色与核心规则
├── README.md                     # 本说明文档
├── package.json                  # 项目依赖配置（ajv + @types/node + typescript）
├── tsconfig.json                 # TypeScript 编译配置
├── .gitignore                    # Git 忽略规则
├── tests/                        # 单元测试 + 集成测试（共 151 用例 / 14 文件）
│   ├── types.test.ts             # 类型常量（TOTAL_AGENT_CAP）
│   ├── semaphore.test.ts         # 并发信号量 + agent 计数器
│   ├── sandbox.test.ts           # 沙箱：meta 提取 + 决定论检测 + 脚本运行
│   ├── validate.test.ts          # JSON Schema 校验 + 缓存
│   ├── journal.test.ts           # keyFor 哈希稳定性
│   ├── journal-integration.test.ts # openJournal / persistScript / resume 缓存
│   ├── tree.test.ts              # 进度树渲染
│   ├── hooks.test.ts             # agent/pipeline/parallel/phase/log 钩子
│   ├── index.test.ts             # 公开 API 导出验证
│   ├── stream-json.test.ts       # Claude stream-json reducer
│   ├── codex-jsonl.test.ts       # Codex jsonl reducer
│   ├── subprocess.test.ts       # 子进程 executor
│   ├── run.test.ts               # runWorkflow 集成测试
│   └── run-advanced.test.ts      # runWorkflow 进阶测试（schema/并发/错误处理）
├── src/
│   └── workflows/                # open-dynamic-workflows 源码内嵌
│       ├── index.ts              # 公开 API：runWorkflow + 内置 executor
│       ├── types.ts              # 类型定义（Meta/Event/Result/Hook）
│       ├── runtime/
│       │   ├── run.ts            # runWorkflow() 主入口
│       │   ├── sandbox.ts        # VM 沙箱 + meta 提取 + 决定论检测
│       │   ├── hooks.ts          # agent/pipeline/parallel/phase/log 编排钩子
│       │   └── semaphore.ts      # 并发信号量 + agent 计数器
│       ├── executor/
│       │   ├── subprocess.ts    # CLI 无关的子进程执行器
│       │   ├── claude/           # Claude executor
│       │   └── codex/            # Codex executor
│       ├── journal/journal.ts    # 运行日志持久化（resume 基础）
│       ├── schema/validate.ts    # ajv JSON Schema 校验
│       └── progress/tree.ts      # 进度树渲染
└── references/
    ├── agents.md                 # 6 个专业助手的详细能力与禁止项
    ├── dispatch-table.md         # 命令 → 助手 路由映射 + 多助手协作实战举例
    └── workflows.md              # 工程编排助手详细使用指南
```

| 文件 | 作用 |
|------|------|
| `SKILL.md` | Skill 元数据、总指挥角色定位、核心命令规则、派发与执行流程、硬约束、汇报格式 |
| `references/agents.md` | 文件 / 系统 / 应用 / 浏览 / 调研 / 工程编排 六个助手的命令方式、核心能力、能干与不能干清单 |
| `references/dispatch-table.md` | 快速命令速查表、多助手协作实战举例、指挥规则速记 |
| `references/workflows.md` | 工程编排助手的何时用、安装指引、workflow.js 编写要点、编排模式速查、运行方式、限制约束、可观测性与 resume |
| `src/workflows/` | open-dynamic-workflows 核心源码，通过 `import { runWorkflow } from './src/workflows'` 直接调用 |

### 快速开始

```typescript
import { runWorkflow, builtinExecutors } from './src/workflows';

const result = await runWorkflow({
  scriptPath: 'path/to/workflow.js',
  args: { targetDir: 'src' },
  onEvent: (e) => console.log(e),
  executors: builtinExecutors,
});
// result: { runId, value, tokensSpent, agentCount, durationMs, events }
```

### 运行测试

```bash
# 运行所有测试（14 个文件，151 个用例）
npm test

# 监听模式（开发时使用）
npm run test:watch

# 仅运行类型检查
npm run typecheck
```

**测试覆盖范围：**

| 测试文件 | 用例数 | 覆盖模块 |
|----------|--------|----------|
| `types.test.ts` | 2 | 类型常量 |
| `semaphore.test.ts` | 8 | 并发信号量、agent 计数器 |
| `sandbox.test.ts` | 22 | meta 提取、决定论检测、脚本运行、代理陷阱 |
| `validate.test.ts` | 11 | JSON Schema 校验、验证器缓存、root 断言 |
| `journal.test.ts` | 6 | keyFor 哈希稳定性、键序无关 |
| `journal-integration.test.ts` | 10 | openJournal、persistScript、resume 缓存、close |
| `tree.test.ts` | 5 | 进度树渲染、状态标记、事件转发 |
| `hooks.test.ts` | 12 | agent、pipeline、parallel、phase、log、缓存命中 |
| `index.test.ts` | 12 | 公开 API 导出完整性 |
| `stream-json.test.ts` | 16 | Claude stream-json 解析器、事件归约 |
| `codex-jsonl.test.ts` | 17 | Codex jsonl 解析器、事件归约、schema 模式 |
| `subprocess.test.ts` | 7 | 子进程 executor、stdin/stdout/stderr、cleanup |
| `run.test.ts` | 11 | runWorkflow 集成：内联/路径、agent 调用、并行、pipeline |
| `run-advanced.test.ts` | 12 | runWorkflow 进阶：schema、agentType、registry、并发、错误传播 |

---

## 🚀 何时触发

满足以下任一条件即应启用本 Skill：

- 用户给出一句含多步骤、跨领域、需多能力配合的复杂需求。
- 用户希望「只说目标，不说步骤」。
- 用户显式要求按「总指挥 / 多智能体」模式工作。
- 任务需要本地文件处理 + 联网调研 + 系统操作等多能力配合。
- 用户需求涉及整个代码库 / 数百文件等大规模量词，需多 agent 并行 + 对抗式验证。

---

## 🎯 六个专业助手速览

| 助手 | 命令方式示例 | 核心能力 |
|------|--------------|----------|
| **文件助手** | "帮我找一下 XXX 文件" / "把这个文档分析一下" | 文件搜索、整理、文档分析、格式转换、文件传输 |
| **系统助手** | "帮我调一下系统设置" / "电脑怎么这么卡" | 系统管理、性能优化、问题排查、窗口桌面管理 |
| **应用助手** | "帮我安装 XXX" / "打开 XXX 应用" | 应用安装卸载、应用内操作、小程序操作 |
| **浏览助手** | "帮我登录 XX 网站做 XX 事" / "帮我在网页上填个表" | 网页浏览、登录认证、表单填写、多页跳转 |
| **调研助手** | "帮我查一下 XXX" / "帮我做一个 XX 主题的调研" | 深度搜索、多源信息收集、综合分析总结 |
| **工程编排助手** | "帮我对整个代码库做一次安全审计" / "把这几百个文件批量迁移到新框架" | 调用 open-dynamic-workflows 编写并运行 workflow.js，大规模多 agent 并行 / 对抗验证 |

> 详细能力边界见 `references/agents.md`。

---

## 🧭 路由速查表

| 用户说 | 自动派发给 |
|--------|-----------|
| 找文件 / 读文档 / 整理文件 / 转格式 | 文件助手 |
| 调设置 / 清理磁盘 / 桌面整理 / 查配置 | 系统助手 |
| 装软件 / 开应用 / 小程序 / 游戏 | 应用助手 |
| 上网填表 / 登录网站 / 多步操作 | 浏览助手 |
| 查资料 / 做调研 / 写报告 / 对比分析 | 调研助手 |
| 代码库审计 / 大规模迁移 / 多源交叉验证 / 多视角起草 | 工程编排助手 |

---

## ⚙️ 工作流程

```
用户自然语言需求
        │
        ▼
┌─────────────────┐
│   总指挥        │  ① 理解意图
│  (ai-dispatcher)│  ② 拆解任务
│                 │  ③ 分派执行
└────────┬────────┘  ④ 汇总回报
         │
   ┌─────┼─────┬─────┬─────┬─────┐
   ▼     ▼     ▼     ▼     ▼     ▼
 文件  系统  应用  浏览  调研  工程
 助手  助手  助手  助手  助手  编排
   │     │     │     │     │     │
   └─────┴─────┴─────┴─────┴─────┘
                 │
                 ▼
        总指挥汇总并简洁回报
```

### 派发策略

- **单领域任务**：直接调用对应能力（文件检索用搜索/读取工具，联网用搜索/网页抓取，网页操作按浏览助手边界等）。
- **多领域任务**：拆解为子任务后，利用多智能体或工具并行调用，最后由总指挥汇总。
  - 动手前用一两句话说明派发计划（"我打算派文件助手搜索，再自己汇总成表"），跨领域任务必须先规划后动手。
- **大规模工程任务**：命中大规模信号（整个代码库 / 数百文件 / 需对抗验证）时，通过 `import { runWorkflow } from './src/workflows'` 直接 API 调用编排。首次使用需安装唯一依赖 `ajv`（`npm install ajv`）。详见 `references/workflows.md`。
- **需要用户介入时主动提示**：如验证码、账号密码、登录验证、手动填表等，停下等待而非绕过。

---

## 💡 多助手协作实战举例

| 用户需求 | 总指挥怎么做 |
|----------|-------------|
| 帮我把桌面上的截图中带「发票」两个字的全部整理到发票文件夹，然后生成一个 Excel 清单 | 文件助手搜索 + 整理 + 生成文件 |
| 我电脑很卡，帮我优化一下，保留 AI 软件和影视制作的空间 | 系统助手清理 + 优化 |
| 帮我安装某剪辑软件，然后打开它 | 应用助手安装 + 打开 |
| 帮我在购物网站搜索蓝牙耳机，对比前 3 款的价格和评价 | 浏览助手浏览 + 调研助手分析 |
| 帮我做一个今年 AI 视频生成工具的全面调研报告，保存到本地 | 调研助手调研 + 文件助手保存 |
| 帮我打开某平台创作者后台，配置自动回复规则 | 浏览助手打开网页 + 用户手动填 |
| 对整个 monorepo 做一次安全漏洞扫描，产出修复建议 | 工程编排助手跑 adversarial verify workflow |
| 把这 500 个旧版组件文件迁移到新框架 API | 工程编排助手跑 pipeline 批量迁移（支持 resume） |
| 从 5 个独立信息源交叉验证某公司财报数据 | 工程编排助手跑 judge panel workflow |

---

## 📋 核心命令规则（必须遵守）

1. **只对总指挥说话**：用户无需指定具体助手，总指挥自行判断派发对象。绝不让用户去记助手名字或手动选工具。
2. **说清结果，别说步骤**：用户只描述目标，总指挥负责规划步骤与派发。纠正用户「先打开 C 盘再进入 Documents…」这类步骤式指令，回归结果式表达。
3. **复杂任务一句话说完**：把完整目标一次给足，不要等用户分步喂；不要因为任务大就拆成多轮让用户接力。

---

## 🚧 硬约束（Boundaries）

- 不修改系统关键文件。
- 不绕过登录验证 / 验证码。
- 不读取聊天隐私。
- 不破解加密文件。

各助手的「不能做」清单见 `references/agents.md`，分派前对照确认，避免越界。

**工程编排助手专属边界**：不替代 5 个领域助手；workflow.js 必须 Plain JS；强制指定 executor；禁决定论违反（Date.now / Math.random / argless new Date）；schema root 必须 `type:"object"`；并发上限 min(16, cpus-2)，总上限 1000 agent；不适用单文件快速读写。

---

## 📤 汇报格式

任务完成后用简洁中文总结：

- 做了什么
- 派了哪些助手
- 结果在哪（文件路径 / URL）
- 有无需要用户手动处理的事项

一句话收尾点明：**「你只管说要什么，总指挥负责调度。」**

---

## 📚 相关资源

- `SKILL.md` — Skill 主入口
- `references/agents.md` — 6 个专业助手的命令方式、核心能力、能干 / 不能干的边界
- `references/dispatch-table.md` — 快速命令速查表与多助手协作实战举例
- `references/workflows.md` — 工程编排助手的详细使用指南（何时用、安装、workflow.js 编写、编排模式、运行、限制、可观测性）

---

## 🛠 平台适配

本 Skill 设计为**平台无关**，可适配任何支持多工具/多智能体调用的 AI 平台：

| 平台 | 适配方式 |
|------|---------|
| Claude / ChatGPT / Gemini | 将 SKILL.md 作为 System Prompt 注入，利用平台内置工具映射 6 个助手的能力；工程编排助手通过 `import { runWorkflow }` 源码内嵌方式调用 open-dynamic-workflows 运行时 |
| Minis / WorkBuddy | 直接作为 Skill 安装，自动匹配平台工具链 |
| 自定义 Agent 框架 | 参照 agents.md 实现各助手的能力接口，SKILL.md 作为调度逻辑 |

> 核心是一套**调度思维模型**，而非绑定任何特定工具或平台。