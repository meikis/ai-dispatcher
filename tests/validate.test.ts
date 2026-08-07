import { describe, it, expect } from "vitest";
import { validateAgainstSchema, assertObjectRootSchema, schemaToCliArg } from "../src/workflows/schema/validate.js";

describe("schema/validate", () => {
  describe("validateAgainstSchema", () => {
    const nameSchema = {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
      required: ["name"],
    };

    it("应通过有效对象", () => {
      const result = validateAgainstSchema(nameSchema, { name: "Alice", age: 30 });
      expect(result.ok).toBe(true);
    });

    it("应通过仅包含必需字段", () => {
      const result = validateAgainstSchema(nameSchema, { name: "Bob" });
      expect(result.ok).toBe(true);
    });

    it("应拒绝缺少必需字段", () => {
      const result = validateAgainstSchema(nameSchema, { age: 25 });
      expect(result.ok).toBe(false);
      expect(result.errors).toContain("name");
    });

    it("应拒绝类型错误", () => {
      const result = validateAgainstSchema(nameSchema, { name: 123 });
      expect(result.ok).toBe(false);
    });

    it("应验证枚举约束", () => {
      const enumSchema = {
        type: "object",
        properties: {
          status: { type: "string", enum: ["active", "inactive"] },
        },
        required: ["status"],
      };
      expect(validateAgainstSchema(enumSchema, { status: "active" }).ok).toBe(true);
      expect(validateAgainstSchema(enumSchema, { status: "unknown" }).ok).toBe(false);
    });

    it("应缓存验证器以提高性能", () => {
      validateAgainstSchema(nameSchema, { name: "Alice" });
      const result = validateAgainstSchema(nameSchema, { name: "Bob" });
      expect(result.ok).toBe(true);
    });
  });

  describe("assertObjectRootSchema", () => {
    it("对象根 schema 应通过", () => {
      expect(() => assertObjectRootSchema({ type: "object" })).not.toThrow();
    });

    it("非对象根 schema 应抛错", () => {
      expect(() => assertObjectRootSchema({ type: "string" })).toThrow(/root must be type:"object"/);
    });

    it("数组根 schema 应抛错", () => {
      expect(() => assertObjectRootSchema({ type: "array" })).toThrow();
    });
  });

  describe("schemaToCliArg", () => {
    it("应将 schema 序列化为 JSON 字符串", () => {
      const arg = schemaToCliArg({ type: "object", properties: { name: { type: "string" } } });
      const parsed = JSON.parse(arg);
      expect(parsed.type).toBe("object");
    });

    it("空 schema 应序列化", () => {
      const arg = schemaToCliArg({});
      expect(JSON.parse(arg)).toEqual({});
    });
  });
});
