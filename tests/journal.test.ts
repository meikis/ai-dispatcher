import { describe, it, expect } from "vitest";
import { keyFor } from "../src/workflows/journal/journal.js";

describe("journal.keyFor", () => {
  it("相同输入应产生相同哈希", () => {
    const k1 = keyFor("hello", { foo: "bar" });
    const k2 = keyFor("hello", { foo: "bar" });
    expect(k1).toBe(k2);
  });

  it("不同输入应产生不同哈希", () => {
    const k1 = keyFor("hello", { foo: "bar" });
    const k2 = keyFor("hello", { foo: "baz" });
    expect(k1).not.toBe(k2);
  });

  it("相同语义不同键顺序应产生相同哈希", () => {
    const k1 = keyFor("hello", { a: 1, b: 2 });
    const k2 = keyFor("hello", { b: 2, a: 1 });
    expect(k1).toBe(k2);
  });

  it("不同 prompt 应产生不同哈希", () => {
    const k1 = keyFor("prompt-a", {});
    const k2 = keyFor("prompt-b", {});
    expect(k1).not.toBe(k2);
  });

  it("应为 64 字符十六进制字符串", () => {
    const k = keyFor("test", {});
    expect(k).toHaveLength(64);
    expect(k).toMatch(/^[0-9a-f]+$/);
  });

  it("空 opts 与 undefined opts 应产生不同哈希", () => {
    const k1 = keyFor("test", {});
    const k2 = keyFor("test", undefined);
    expect(k1).not.toBe(k2);
  });
});
