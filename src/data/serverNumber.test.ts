// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BREAKER_MS, NUMBER_CAP_MS, WARM_EVERY_MS, requestBillNumber, resetNumberState, warmServer } from "./receiptNumbers";

// KB-351 (owner, 22 Oct 2026; D92): Bill Banao takes the next number from the server - one round trip, capped at 1.5 s
// (the CAP only: the owner wants it to feel instant). Any failure, a timeout, being offline or a slow server means the bill
// saves at once with an offline number instead - never "pending", never an error. After one failure the server is skipped for
// 30 s so every following bill is not slowed too.

const SHOP = "shop-1";
const LOCAL = "11111111-1111-4111-8111-111111111111";
type Reply = { data: unknown; error: { code?: string; message: string } | null };

function fake(reply: () => Promise<Reply> | Reply) {
  const calls: Array<{ fn: string; args: unknown }> = [];
  const client = { rpc: (fn: string, args: unknown) => (calls.push({ fn, args }), Promise.resolve(reply())) } as unknown as SupabaseClient;
  return { client, calls };
}

beforeEach(() => {
  resetNumberState();
  vi.useFakeTimers();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("requestBillNumber", () => {
  it("one round trip: next_bill_number(shop, bill) -> the plain number, with the time it took", async () => {
    const { client, calls } = fake(() => ({ data: 7, error: null }));
    const r = await requestBillNumber(client, SHOP, LOCAL);
    expect(r).toMatchObject({ receiptNumber: "7", source: "counter" });
    expect(typeof r!.ms).toBe("number");
    expect(calls).toEqual([{ fn: "next_bill_number", args: { p_shop_id: SHOP, p_local_id: LOCAL } }]);
  });

  it("a bigint that arrives as a string is still the plain number", async () => {
    expect((await requestBillNumber(fake(() => ({ data: "12", error: null })).client, SHOP, LOCAL))?.receiptNumber).toBe("12");
  });

  it("a server error (or RLS refusal) is null, never a throw", async () => {
    const { client } = fake(() => ({ data: null, error: { code: "42501", message: "denied" } }));
    expect(await requestBillNumber(client, SHOP, LOCAL)).toBeNull();
  });

  it("an answer that is not a positive whole number is refused - the bill takes an offline number", async () => {
    for (const data of [null, 0, -3, 2.5, "abc", {}]) {
      resetNumberState();
      expect(await requestBillNumber(fake(() => ({ data, error: null })).client, SHOP, LOCAL), String(data)).toBeNull();
    }
  });

  it("a network exception is null", async () => {
    const client = { rpc: () => Promise.reject(new TypeError("Failed to fetch")) } as unknown as SupabaseClient;
    expect(await requestBillNumber(client, SHOP, LOCAL)).toBeNull();
  });

  it("offline: null at once, no request at all", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { client, calls } = fake(() => ({ data: 1, error: null }));
    expect(await requestBillNumber(client, SHOP, LOCAL)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("the cap: a server that does not answer in 1.5 s is given up on - null at exactly the cap", async () => {
    expect(NUMBER_CAP_MS).toBe(1500);
    const { client } = fake(() => new Promise<Reply>(() => {}));
    const p = requestBillNumber(client, SHOP, LOCAL);
    await vi.advanceTimersByTimeAsync(NUMBER_CAP_MS - 1);
    let done = false;
    void p.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toBeNull();
  });

  it("the breaker: after one failure the server is skipped for 30 s (no request, no wait), then tried again", async () => {
    expect(BREAKER_MS).toBe(30_000);
    let ok = false;
    const { client, calls } = fake(() => (ok ? { data: 3, error: null } : { data: null, error: { message: "boom" } }));
    expect(await requestBillNumber(client, SHOP, LOCAL)).toBeNull();
    expect(calls).toHaveLength(1);
    ok = true;
    expect(await requestBillNumber(client, SHOP, "22222222-2222-4222-8222-222222222222")).toBeNull();
    expect(calls).toHaveLength(1); // skipped, not asked
    await vi.advanceTimersByTimeAsync(BREAKER_MS);
    expect((await requestBillNumber(client, SHOP, "33333333-3333-4333-8333-333333333333"))?.receiptNumber).toBe("3");
    expect(calls).toHaveLength(2);
  });

  it("a success closes the breaker at once", async () => {
    const { client } = fake(() => ({ data: 4, error: null }));
    expect((await requestBillNumber(client, SHOP, LOCAL))?.receiptNumber).toBe("4");
    expect((await requestBillNumber(client, SHOP, LOCAL))?.receiptNumber).toBe("4");
  });
});

describe("warmServer (so the first Bill Banao is not the slow one)", () => {
  it("asks the server one cheap question (sync_probe) - at most once every 20 s", async () => {
    expect(WARM_EVERY_MS).toBe(20_000);
    const { client, calls } = fake(() => ({ data: {}, error: null }));
    warmServer(client, SHOP);
    warmServer(client, SHOP);
    expect(calls.map((c) => c.fn)).toEqual(["sync_probe"]);
    await vi.advanceTimersByTimeAsync(WARM_EVERY_MS);
    warmServer(client, SHOP);
    expect(calls).toHaveLength(2);
  });

  it("a number request counts as a warm connection too; offline asks nothing; a failure never throws", async () => {
    const { client, calls } = fake(() => ({ data: 1, error: null }));
    await requestBillNumber(client, SHOP, LOCAL);
    warmServer(client, SHOP);
    expect(calls.map((c) => c.fn)).toEqual(["next_bill_number"]);
    resetNumberState();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    warmServer(client, SHOP);
    expect(calls).toHaveLength(1);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    expect(() => warmServer({ rpc: () => Promise.reject(new Error("x")) } as unknown as SupabaseClient, SHOP)).not.toThrow();
  });
});
