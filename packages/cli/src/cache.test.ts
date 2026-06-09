import { describe, it, expect } from "vitest";
import { createTtlCache } from "./cache.js";

describe("createTtlCache", () => {
  it("calls compute once for a repeated key within TTL", async () => {
    let calls = 0;
    const cache = createTtlCache(1000, () => 0);
    const compute = async (): Promise<number> => {
      calls += 1;
      return 42;
    };
    expect(await cache.getOrCompute("k", compute)).toBe(42);
    expect(await cache.getOrCompute("k", compute)).toBe(42);
    expect(calls).toBe(1);
  });

  it("recomputes after the TTL elapses", async () => {
    let calls = 0;
    let clock = 0;
    const cache = createTtlCache(1000, () => clock);
    const compute = async (): Promise<number> => {
      calls += 1;
      return calls;
    };
    expect(await cache.getOrCompute("k", compute)).toBe(1);
    clock = 999; // still within TTL
    expect(await cache.getOrCompute("k", compute)).toBe(1);
    clock = 1001; // expired
    expect(await cache.getOrCompute("k", compute)).toBe(2);
    expect(calls).toBe(2);
  });

  it("invalidateAll forces a recompute", async () => {
    let calls = 0;
    const cache = createTtlCache(1000, () => 0);
    const compute = async (): Promise<number> => {
      calls += 1;
      return calls;
    };
    expect(await cache.getOrCompute("k", compute)).toBe(1);
    cache.invalidateAll();
    expect(await cache.getOrCompute("k", compute)).toBe(2);
    expect(calls).toBe(2);
  });

  it("treats distinct keys independently", async () => {
    const cache = createTtlCache(1000, () => 0);
    const a = await cache.getOrCompute("a", async () => "alpha");
    const b = await cache.getOrCompute("b", async () => "beta");
    expect(a).toBe("alpha");
    expect(b).toBe("beta");

    // Each key keeps its own cached value.
    let extraCalls = 0;
    expect(
      await cache.getOrCompute("a", async () => {
        extraCalls += 1;
        return "recomputed";
      }),
    ).toBe("alpha");
    expect(extraCalls).toBe(0);
  });
});
