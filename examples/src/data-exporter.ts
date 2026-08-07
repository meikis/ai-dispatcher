// 数据导出器 - 包含路径遍历风险
import fs from "fs";
import path from "path";

export function exportReport(filename: string) {
  const filePath = path.join("/exports", filename);
  const content = fs.readFileSync(filePath, "utf8");
  return content;
}

export function importData(filePath: string) {
  const data = fs.readFileSync(filePath, "utf8");
  return JSON.parse(data);
}

export const DB_CONFIG = {
  host: "localhost",
  port: 5432,
  password: "admin123",
};