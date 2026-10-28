import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

const fromMock = vi.fn();
const createClientMock = vi.fn((..._args: unknown[]) => ({ from: fromMock }));
vi.mock("@supabase/supabase-js", () => ({ createClient: (...a: unknown[]) => createClientMock(...a) }));

import { cachedShop, lookupShop, mayRunUnconfirmed, noteUnconfirmed, resetAuthState, SHOP_CACHE_MS, UNCONFIRMED_PER_MINUTE } from "./auth";

// KB-353: the token is verified locally (jwt.ts); this file answers the one question left - which shop does this
// verified user belong to? - with the caller's own JWT, so RLS stays the boundary (hard rule 4). A confirmed answer is
// kept for 5 minutes per user. A signed-in user who belongs to no shop is capped per USER.

function selectChain(result: { data: unknown; error: unknown }) {
  return { select: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(result) }) };
}
const hit = (shop = "shop-1", user = "user-1") => selectChain({ data: [{ shop_id: shop, user_id: user }], error: null });

beforeEach(() => {
  resetAuthState();
  fromMock.mockReset();
  createClientMock.mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-28T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("lookupShop", () => {
  it("queries shop_members with the CALLER's own Authorization header (never a service role)", async () => {
    fromMock.mockReturnValue(hit());
    expect(await lookupShop("Bearer real-jwt", "https://x.supabase.co", "anon-key", "user-1")).toBe("shop-1");
    expect(createClientMock).toHaveBeenCalledWith("https://x.supabase.co", "anon-key", { global: { headers: { Authorization: "Bearer real-jwt" } } });
    expect(fromMock).toHaveBeenCalledWith("shop_members");
  });

  it("null when the query errors (RLS / revoked), when it returns no rows, or when the row is someone else's", async () => {
    fromMock.mockReturnValue(selectChain({ data: null, error: { message: "boom" } }));
    expect(await lookupShop("Bearer j", "u", "k", "user-1")).toBeNull();
    fromMock.mockReturnValue(selectChain({ data: [], error: null }));
    expect(await lookupShop("Bearer j", "u", "k", "user-1")).toBeNull();
    fromMock.mockReturnValue(hit("shop-9", "user-2"));
    expect(await lookupShop("Bearer j", "u", "k", "user-1")).toBeNull();
    expect(cachedShop("user-1")).toBeNull();
  });

  it("a thrown query is a 'no', not a crash", async () => {
    fromMock.mockReturnValue({ select: () => ({ limit: () => Promise.reject(new Error("network")) }) });
    expect(await lookupShop("Bearer j", "u", "k", "user-1")).toBeNull();
  });
});

describe("the per-user shop cache", () => {
  it("a confirmed shop is remembered for 5 minutes, then forgotten", async () => {
    expect(SHOP_CACHE_MS).toBe(300_000);
    fromMock.mockReturnValue(hit());
    await lookupShop("Bearer j", "u", "k", "user-1");
    expect(cachedShop("user-1")).toBe("shop-1");
    vi.advanceTimersByTime(SHOP_CACHE_MS - 1);
    expect(cachedShop("user-1")).toBe("shop-1");
    vi.advanceTimersByTime(2);
    expect(cachedShop("user-1")).toBeNull();
  });

  it("only a CONFIRMED answer is cached - a 'no' is never remembered (and never poisons a later member)", async () => {
    fromMock.mockReturnValue(selectChain({ data: [], error: null }));
    await lookupShop("Bearer j", "u", "k", "user-1");
    expect(cachedShop("user-1")).toBeNull();
  });

  it("per user: one user's shop never answers for another", async () => {
    fromMock.mockReturnValue(hit("shop-1", "user-1"));
    await lookupShop("Bearer j", "u", "k", "user-1");
    expect(cachedShop("user-2")).toBeNull();
  });

  it("stays bounded: a flood of distinct users cannot grow it without limit", async () => {
    for (let i = 0; i < 1200; i++) {
      fromMock.mockReturnValue(hit("s", `u${i}`));
      await lookupShop("Bearer j", "u", "k", `u${i}`);
    }
    let kept = 0;
    for (let i = 0; i < 1200; i++) if (cachedShop(`u${i}`)) kept++;
    expect(kept).toBeLessThanOrEqual(1000);
    expect(cachedShop("u1199")).toBe("s"); // the newest survives
  });
});

describe("the per-user cap on unconfirmed work", () => {
  it("a user may start Groq in parallel UNCONFIRMED_PER_MINUTE times a minute after a 'no'; after that the check runs first", () => {
    for (let i = 0; i < UNCONFIRMED_PER_MINUTE; i++) {
      expect(mayRunUnconfirmed("user-1")).toBe(true);
      noteUnconfirmed("user-1");
    }
    expect(mayRunUnconfirmed("user-1")).toBe(false);
    expect(mayRunUnconfirmed("user-2")).toBe(true);
  });

  it("the cap lifts when the minute is up", () => {
    for (let i = 0; i < UNCONFIRMED_PER_MINUTE; i++) noteUnconfirmed("user-1");
    expect(mayRunUnconfirmed("user-1")).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(mayRunUnconfirmed("user-1")).toBe(true);
  });
});
