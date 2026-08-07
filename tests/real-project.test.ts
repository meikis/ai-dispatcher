// 代码库安全扫描 - 真实端到端集成测试
// 使用真实的 workflow 脚本和模拟的 executor 运行完整流程

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runWorkflow } from "../src/workflows/runtime/run.js";
import type { Executor, ExecResult, RunOptions, ProgressEvent } from "../src/workflows/types.js";

// 真实的 mock executor —— 模拟安全审计 Agent 的行为
// 它会读取 prompt 中提到的文件名，返回模拟的审计结果
function makeSecurityAuditorExecutor(): Executor {
  const auditFindings: Record<string, { type: string; severity: string; description: string }[]> = {
    "user-service.ts": [
      { type: "hardcoded_secret", severity: "high", description: "API_KEY 硬编码在源码中" },
      { type: "sql_injection", severity: "high", description: "getUser 使用字符串拼接构建 SQL 查询" },
      { type: "sql_injection", severity: "high", description: "deleteUser 使用字符串拼接构建 SQL 查询" },
    ],
    "payment-handler.ts": [
      { type: "insecure_random", severity: "medium", description: "使用 Math.random() 生成令牌" },
      { type: "weak_crypto", severity: "medium", description: "使用 MD5 进行密码哈希" },
      { type: "timestamp_salt", severity: "low", description: "使用 Date.now() 作为盐值，可预测" },
    ],
    "data-exporter.ts": [
      { type: "path_traversal", severity: "high", description: "exportReport 路径拼接未校验" },
      { type: "hardcoded_secret", severity: "high", description: "DB_CONFIG.password 硬编码" },
      { type: "arbitrary_file_read", severity: "medium", description: "importData 读取任意路径文件" },
    ],
  };

  return {
    name: "mock-auditor",
    async runPrompt(opts) {
      // 从 prompt 中提取文件名（匹配 src/xxx.ts 格式的路径）
      const fileMatch = opts.prompt.match(/(src\/[\w-]+\.\w+)/);
      const fileName = fileMatch ? fileMatch[1].split("/").pop()! : "unknown";

      const findings = auditFindings[fileName] || [];
      const hasHigh = findings.some((f) => f.severity === "high");
      const score = hasHigh ? 40 : findings.length > 0 ? 65 : 95;

      const structuredOutput = {
        file: fileName,
        issues: findings,
        score,
      };

      return {
        text: JSON.stringify(structuredOutput),
        structuredOutput,
        sessionId: `audit-${Date.now()}`,
        costUsd: 0.02 * findings.length + 0.01,
        resultSubtype: "success",
        isError: false,
        usage: { inputTokens: opts.prompt.length, outputTokens: findings.length * 50 },
        durationMs: 50 + findings.length * 20,
      } as ExecResult;
    },
  };
}

describe("真实场景：代码库安全扫描", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "real-audit-test-"));
  });

  it("应运行完整的安全审计 workflow 并生成结构化报告", async () => {
    const sourcePath = path.join(process.cwd(), "examples", "security-audit.js");
    const source = readFileSync(sourcePath, "utf8");

    const events: ProgressEvent[] = [];
    const result = await runWorkflow({
      script: source,
      baseDir: tmpDir,
      executors: { "mock-auditor": makeSecurityAuditorExecutor() },
      onEvent: (e) => events.push(e),
    });

    // 1. 验证 workflow 成功运行
    expect(result).toBeDefined();
    expect(result.runId.startsWith("run-")).toBe(true);
    expect(result.value).toBeDefined();

    const value: any = result.value;

    // 2. 验证汇总结果
    expect(value.summary).toBeDefined();
    expect(value.summary.filesAudited).toBe(3);
    expect(value.summary.totalIssues).toBe(9); // 3 + 3 + 3
    expect(value.summary.bySeverity.high).toBe(5); // 3 high + 0 high + 2 high
    expect(value.summary.bySeverity.medium).toBe(3);
    expect(value.summary.bySeverity.low).toBe(1);
    expect(value.summary.pass).toBe(false);

    // 3. 验证详细发现
    expect(value.details).toHaveLength(9);

    const fileNames = value.details.map((d: any) => d.file);
    expect(fileNames).toContain("user-service.ts");
    expect(fileNames).toContain("payment-handler.ts");
    expect(fileNames).toContain("data-exporter.ts");

    // 4. 验证建议
    expect(value.recommendations.length).toBeGreaterThan(0);

    // 5. 验证事件流
    const phaseStarts = events.filter((e) => e.type === "phase_start");
    expect(phaseStarts.length).toBeGreaterThanOrEqual(3);

    const agentStarts = events.filter((e) => e.type === "agent_start");
    expect(agentStarts.length).toBe(3); // 3 个文件各 1 次 audit

    const agentEnds = events.filter((e) => e.type === "agent_end");
    expect(agentEnds.length).toBe(3);

    const logs = events.filter((e) => e.type === "log");
    expect(logs.length).toBeGreaterThanOrEqual(2);

    // 6. 验证运行元数据
    expect(result.agentCount).toBeGreaterThanOrEqual(3);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.runDir.startsWith(tmpDir)).toBe(true);
  });

  it("应通过 scriptPath 运行真实脚本", async () => {
    const scriptPath = path.join(process.cwd(), "examples", "security-audit.js");

    const result = await runWorkflow({
      scriptPath,
      baseDir: tmpDir,
      executors: { "mock-auditor": makeSecurityAuditorExecutor() },
    });

    expect(result.value).toBeDefined();
    const value: any = result.value;
    expect(value.summary.filesAudited).toBe(3);
  });

  it("应将脚本和运行日志持久化到磁盘", async () => {
    const sourcePath = path.join(process.cwd(), "examples", "security-audit.js");
    const source = readFileSync(sourcePath, "utf8");

    const result = await runWorkflow({
      script: source,
      baseDir: tmpDir,
      executors: { "mock-auditor": makeSecurityAuditorExecutor() },
    });

    // 验证脚本持久化
    const scriptPath = path.join(result.runDir, "script.js");
    expect(existsSync(scriptPath)).toBe(true);

    // 验证运行目录存在
    expect(existsSync(result.runDir)).toBe(true);

    // 验证 agents 目录存在
    const agentsDir = path.join(result.runDir, "agents");
    expect(existsSync(agentsDir)).toBe(true);
  });

  it("应在日志事件中报告审计进度", async () => {
    const sourcePath = path.join(process.cwd(), "examples", "security-audit.js");
    const source = readFileSync(sourcePath, "utf8");

    const events: ProgressEvent[] = [];
    await runWorkflow({
      script: source,
      baseDir: tmpDir,
      executors: { "mock-auditor": makeSecurityAuditorExecutor() },
      onEvent: (e) => events.push(e),
    });

    const logTexts = events
      .filter((e) => e.type === "log")
      .map((e) => e.text || "");

    expect(logTexts.some((t) => t.includes("3 个源文件"))).toBe(true);
    expect(logTexts.some((t) => t.includes("审计完成"))).toBe(true);
    expect(logTexts.some((t) => t.includes("高危"))).toBe(true);
  });

  it("应正确处理 pipeline 中单个文件的审计失败", async () => {
    const partiallyFailingExecutor: Executor = {
      name: "partial-fail",
      async runPrompt(opts) {
        const fileMatch = opts.prompt.match(/(src\/[\w-]+\.\w+)/);
        const fileName = fileMatch ? fileMatch[1].split("/").pop()! : "unknown";

        if (fileName === "payment-handler.ts") {
          return {
            text: "Audit failed for payment handler",
            sessionId: null,
            costUsd: 0,
            resultSubtype: "error",
            isError: true,
            usage: { inputTokens: 0, outputTokens: 0 },
            durationMs: 50,
          } as ExecResult;
        }

        const findings: Record<string, any[]> = {
          "user-service.ts": [
            { type: "hardcoded_secret", severity: "high", description: "API_KEY 硬编码" },
          ],
          "data-exporter.ts": [
            { type: "path_traversal", severity: "high", description: "路径遍历风险" },
          ],
        };

        const fileFindings = findings[fileName] || [];
        const structuredOutput = { file: fileName, issues: fileFindings, score: 50 };

        return {
          text: JSON.stringify(structuredOutput),
          structuredOutput,
          sessionId: "ok",
          costUsd: 0.01,
          resultSubtype: "success",
          isError: false,
          usage: { inputTokens: 10, outputTokens: 5 },
          durationMs: 30,
        } as ExecResult;
      },
    };

    // 使用 inline 脚本测试部分失败容错
    const source = `
      export const meta = {
        name: 'partial-fail-test',
        description: 'Test partial failure handling',
      };

      const items = ['src/user-service.ts', 'src/payment-handler.ts', 'src/data-exporter.ts'];
      
      const auditResults = await pipeline(
        items,
        async (_prev, file) => {
          try {
            return await agent('请审查文件 ' + file, {
              executor: 'partial-fail',
              schema: { type: 'object', properties: { file: { type: 'string' }, issues: { type: 'array' }, score: { type: 'number' } } },
            });
          } catch(e) {
            return { file, error: e.message };
          }
        },
      );

      return { auditResults, resultCount: auditResults.length };
    `;

    const result = await runWorkflow({
      script: source,
      baseDir: tmpDir,
      executors: { "partial-fail": partiallyFailingExecutor },
    });

    const value: any = result.value;

    // pipeline 应产生 3 个结果（包括错误包装）
    expect(value).toBeDefined();
    expect(value.resultCount).toBe(3);
    
    // 2 个成功 + 1 个失败
    const successCount = value.auditResults.filter((r: any) => r && !r.error).length;
    const errorCount = value.auditResults.filter((r: any) => r && r.error).length;
    expect(successCount).toBe(2);
    expect(errorCount).toBe(1);

    // 验证具体结果
    const successResults = value.auditResults.filter((r: any) => r && !r.error);
    expect(successResults.map((r: any) => r.file)).toContain("user-service.ts");
    expect(successResults.map((r: any) => r.file)).toContain("data-exporter.ts");
    
    const errorResults = value.auditResults.filter((r: any) => r && r.error);
    expect(errorResults[0].file).toBe("src/payment-handler.ts");
  });

  it("应验证 meta 信息被正确提取和发出", async () => {
    const sourcePath = path.join(process.cwd(), "examples", "security-audit.js");
    const source = readFileSync(sourcePath, "utf8");

    const events: ProgressEvent[] = [];
    await runWorkflow({
      script: source,
      baseDir: tmpDir,
      executors: { "mock-auditor": makeSecurityAuditorExecutor() },
      onEvent: (e) => events.push(e),
    });

    // meta.phases 中的 phase 应作为事件发出
    const phaseStarts = events.filter((e) => e.type === "phase_start");
    const phaseTitles = phaseStarts.map((e) => e.phaseTitle);
    expect(phaseTitles).toContain("文件扫描");
    expect(phaseTitles).toContain("深度审计");
    expect(phaseTitles).toContain("汇总报告");
  });
});