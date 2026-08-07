// 用户服务 - 包含硬编码密钥和潜在注入风险
export const API_KEY = "sk-production-abc123def456";

export function getUser(userId: string) {
  const query = `SELECT * FROM users WHERE id = '${userId}'`;
  return db.query(query);
}

export function deleteUser(userId: string) {
  const query = `DELETE FROM users WHERE id = '${userId}'`;
  return db.query(query);
}

const db = {
  query: (q: string) => console.log("Executing:", q),
};