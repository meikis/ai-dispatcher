// 代码库安全扫描工作流
// 使用 open-dynamic-workflows API 编排多 Agent 协作

export const meta = {
  name: "codebase-security-audit",
  description: "对代码库进行安全扫描，发现硬编码密钥、注入风险、不安全随机数等问题",
  whenToUse: "审计代码库安全性、检查敏感信息泄露、代码质量基线扫描",
  phases: [
    { title: "文件扫描", detail: "遍历目标目录，收集所有源文件" },
    { title: "深度审计", detail: "逐文件运行安全审计 Agent" },
    { title: "汇总报告", detail: "汇总所有发现，生成结构化报告" },
  ],
};

// 模拟文件列表（在真实场景中由文件系统扫描 Agent 获取）
const sourceFiles = [
  "src/user-service.ts",
  "src/payment-handler.ts",
  "src/data-exporter.ts",
];

phase("文件扫描");
log(`发现 ${sourceFiles.length} 个源文件待审计`);

phase("深度审计");

// 使用 pipeline 逐文件审计，每个文件由独立 Agent 审查
// pipeline stage 签名为 (prev, item, index) => Promise<R>
// 单个文件审计失败不应影响其他文件
const auditResults = await pipeline(
  sourceFiles,
  async (_prev, file) => {
    try {
      return await agent(
        `你是一个代码安全审计专家。请审查文件 ${file} ，检查以下问题：
         1. 是否有硬编码的密钥/密码/凭证
         2. 是否存在 SQL 注入风险
         3. 是否使用了不安全的随机数生成
         4. 是否有路径遍历风险
         5. 是否使用了弱加密算法
         
         返回 JSON 格式：{ file, issues: [{type, severity, description}], score: 0-100 }`,
        { executor: "mock-auditor", schema: { type: "object", properties: { file: { type: "string" }, issues: { type: "array" }, score: { type: "number" } } } },
      );
    } catch (e) {
      log(`⚠️ 文件 ${file} 审计失败：${e.message}`);
      return { file, issues: [], score: 0, error: e.message };
    }
  },
);

phase("汇总报告");

const allIssues = [];
for (const result of auditResults) {
  if (result && result.issues) {
    for (const issue of result.issues) {
      allIssues.push({ file: result.file, ...issue });
    }
  }
}

const highCount = allIssues.filter((i) => i.severity === "high").length;
const mediumCount = allIssues.filter((i) => i.severity === "medium").length;
const lowCount = allIssues.filter((i) => i.severity === "low").length;

log(`审计完成：共发现 ${allIssues.length} 个问题（高危 ${highCount}，中危 ${mediumCount}，低危 ${lowCount}）`);

return {
  summary: {
    filesAudited: sourceFiles.length,
    totalIssues: allIssues.length,
    bySeverity: { high: highCount, medium: mediumCount, low: lowCount },
    pass: highCount === 0,
  },
  details: allIssues,
  recommendations: [
    "将硬编码密钥移至环境变量",
    "使用参数化查询替代字符串拼接",
    "使用 crypto.randomBytes 替代 Math.random",
    "对文件路径进行白名单校验",
    "使用 bcrypt/argon2 替代 md5",
  ],
};