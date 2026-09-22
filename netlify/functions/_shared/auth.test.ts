import { describe, it, expect, vi } from "vitest";

const fromMock = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ from: fromMock })),
}));

import { resolveAuthedRequest } from "./auth";

function selectChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue(result),
    }),
  };
}

describe("resolveAuthedRequest", () => {
  it("returns null when there is no Authorization header at all", async () => {
    const req = new Request("https://example.com/voice", { method: "POST" });
    const result = await resolveAuthedRequest(req, "https://x.supabase.co", "anon-key");
    expect(result).toBeNull();
  });

  it("returns null when the Authorization header isn't a Bearer token", async () => {
    const req = new Request("https://example.com/voice", {
      method: "POST",
      headers: { Authorization: "Basic abc123" },
    });
    const result = await resolveAuthedRequest(req, "https://x.supabase.co", "anon-key");
    expect(result).toBeNull();
  });

  it("returns null when the shop_members query errors (invalid/expired JWT rejected by RLS)", async () => {
    fromMock.mockReturnValue(selectChain({ data: null, error: { message: "JWT expired" } }));
    const req = new Request("https://example.com/voice", {
      method: "POST",
      headers: { Authorization: "Bearer real-jwt" },
    });
    const result = await resolveAuthedRequest(req, "https://x.supabase.co", "anon-key");
    expect(result).toBeNull();
  });

  it("returns null when the query succeeds but returns zero rows", async () => {
    fromMock.mockReturnValue(selectChain({ data: [], error: null }));
    const req = new Request("https://example.com/voice", {
      method: "POST",
      headers: { Authorization: "Bearer real-jwt" },
    });
    const result = await resolveAuthedRequest(req, "https://x.supabase.co", "anon-key");
    expect(result).toBeNull();
  });

  it("resolves userId and shopId from a real matching row", async () => {
    fromMock.mockReturnValue(
      selectChain({ data: [{ shop_id: "shop-1", user_id: "user-1" }], error: null }),
    );
    const req = new Request("https://example.com/voice", {
      method: "POST",
      headers: { Authorization: "Bearer real-jwt" },
    });
    const result = await resolveAuthedRequest(req, "https://x.supabase.co", "anon-key");
    expect(result).toEqual({ userId: "user-1", shopId: "shop-1", client: { from: fromMock } });
  });
});
