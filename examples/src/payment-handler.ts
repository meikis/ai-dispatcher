// 支付处理器 - 包含不安全的随机数和密码处理
import crypto from "crypto";

export function generateToken(): string {
  return Math.random().toString(36).substring(2);
}

export function hashPassword(password: string): string {
  const salt = Date.now().toString();
  return crypto.createHash("md5").update(password + salt).digest("hex");
}

export function processPayment(amount: number, cardNumber: string) {
  console.log("Processing payment:", amount, "for card:", cardNumber);
  return { success: true, transactionId: generateToken() };
}