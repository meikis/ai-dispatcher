// semaphore.ts — counting semaphore + global agent counter
// semaphore.ts —— 计数信号量 + 全局 agent 计数器

import { TOTAL_AGENT_CAP } from "../types.js";

export interface Semaphore {
  acquire(): Promise<void>;
  release(): void;
  readonly active: number;
  readonly limit: number;
}

export function createSemaphore(limit: number): Semaphore {
  const cap = Math.max(1, Math.floor(limit));
  const waiters: Array<() => void> = [];
  let active = 0;
  return {
    get active() { return active; },
    get limit() { return cap; },
    acquire(): Promise<void> {
      if (active < cap) {
        active += 1;
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        waiters.push(resolve);
      });
    },
    release(): void {
      const next = waiters.shift();
      if (next !== undefined) {
        next();
        return;
      }
      if (active > 0) {
        active -= 1;
      }
    },
  };
}

export interface Counter {
  next(): number;
  readonly count: number;
}

export function createCounter(cap: number): Counter {
  let count = 0;
  return {
    get count() { return count; },
    next(): number {
      if (count >= cap) {
        throw new Error("agent cap " + cap + " exceeded");
      }
      count += 1;
      return count;
    },
  };
}

export { TOTAL_AGENT_CAP };
