import { describe, it, expect } from "vitest";
import { createSemaphore, createCounter } from "../src/workflows/runtime/semaphore.js";

describe("createSemaphore", () => {
  it("应在限制内立即获取", async () => {
    const sem = createSemaphore(3);
    expect(sem.active).toBe(0);
    await sem.acquire();
    expect(sem.active).toBe(1);
    await sem.acquire();
    await sem.acquire();
    expect(sem.active).toBe(3);
  });

  it("应在释放后允许下一个获取", async () => {
    const sem = createSemaphore(2);
    await sem.acquire();
    await sem.acquire();
    expect(sem.active).toBe(2);

    sem.release();
    expect(sem.active).toBe(1);

    await sem.acquire();
    expect(sem.active).toBe(2);
  });

  it("超过限制时应排队等待", async () => {
    const sem = createSemaphore(1);
    await sem.acquire();
    let acquired = false;
    const waiter = sem.acquire().then(() => { acquired = true; });
    await Promise.resolve();
    expect(acquired).toBe(false);
    sem.release();
    await waiter;
    expect(acquired).toBe(true);
    expect(sem.active).toBe(1);
  });

  it("限制应为至少 1", () => {
    const sem = createSemaphore(0);
    expect(sem.limit).toBe(1);
  });

  it("小数限制应向下取整", () => {
    const sem = createSemaphore(2.7);
    expect(sem.limit).toBe(2);
  });
});

describe("createCounter", () => {
  it("应从 1 开始递增", () => {
    const c = createCounter(10);
    expect(c.next()).toBe(1);
    expect(c.next()).toBe(2);
    expect(c.next()).toBe(3);
    expect(c.count).toBe(3);
  });

  it("达到上限后应抛错", () => {
    const c = createCounter(3);
    c.next(); c.next(); c.next();
    expect(() => c.next()).toThrow("agent cap 3 exceeded");
  });

  it("count 应反映当前使用量", () => {
    const c = createCounter(5);
    expect(c.count).toBe(0);
    c.next();
    expect(c.count).toBe(1);
    c.next();
    expect(c.count).toBe(2);
  });
});
