import { describe, it, expect, vi, beforeEach } from "vitest";

const store = new Map<string, number>();
const getMock = vi.fn(async (key: string) => store.get(key) ?? null);
const setJSONMock = vi.fn(async (key: string, value: number) => {
  store.set(key, value);
});

vi.mock("@netlify/blobs", () => ({
  getStore: vi.fn(() => ({ get: getMock, setJSON: setJSONMock })),
}));

import { checkRateLimit } from "./rateLimit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    store.clear();
    getMock.mockClear();
    setJSONMock.mockClear();
  });

  it("allows the first request for a shop and records it", async () => {
    const allowed = await checkRateLimit("shop-1");
    expect(allowed).toBe(true);
    expect(setJSONMock).toHaveBeenCalledWith(expect.stringContaining("shop-1"), 1);
  });

  it("allows requests up to the limit, then rejects the one over it", async () => {
    for (let i = 0; i < 300; i++) {
      const allowed = await checkRateLimit("shop-2");
      expect(allowed).toBe(true);
    }
    const overLimit = await checkRateLimit("shop-2");
    expect(overLimit).toBe(false);
  });

  it("tracks different shops independently", async () => {
    for (let i = 0; i < 300; i++) await checkRateLimit("shop-3");
    const shop3Blocked = await checkRateLimit("shop-3");
    const shop4Allowed = await checkRateLimit("shop-4");
    expect(shop3Blocked).toBe(false);
    expect(shop4Allowed).toBe(true);
  });
});
