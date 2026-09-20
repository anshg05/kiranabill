import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createShop, findOwnShop } from "./shops";

/**
 * A minimal fake of Supabase's fluent query builder. Each chain method
 * returns `this`; the object is directly awaitable (implements `.then`),
 * matching how the real PostgrestFilterBuilder works and how shops.ts
 * calls it (`await client.from(...).select(...)...`).
 */
function makeQueryResult(resolve: () => Promise<{ data: unknown; error: null }>) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    single: vi.fn(() => builder),
    maybeSingle: vi.fn(() => builder),
    then: (onFulfilled: (v: { data: unknown; error: null }) => unknown) => resolve().then(onFulfilled),
  };
  return builder;
}

describe("createShop", () => {
  it("awaits the shops insert to completion BEFORE starting the shop_members insert, never in parallel", async () => {
    const events: string[] = [];
    let shopsInsertResolved = false;

    // Two-phase mock: the FIRST call to from("shops") is findOwnShop's own
    // lookup (must return no existing shop, to force the insert path);
    // the SECOND call is the actual insert this test is verifying.
    let shopsCallIndex = 0;
    const from = vi.fn((table: string) => {
      if (table === "shops") {
        shopsCallIndex++;
        if (shopsCallIndex === 1) {
          return makeQueryResult(async () => ({ data: null, error: null }));
        }
        return makeQueryResult(async () => {
          events.push("shops:insert:start");
          // Artificial delay: if the real code awaited these two inserts
          // in parallel (e.g. Promise.all, or fired the second without
          // awaiting the first), the shop_members call below would be
          // logged BEFORE this resolves, since nothing would block it.
          await new Promise((r) => setTimeout(r, 20));
          events.push("shops:insert:resolved");
          shopsInsertResolved = true;
          return {
            data: { id: "shop-1", owner_user_id: "user-1", name: "Test Shop", phone: null, catalog_mode: "custom_only" },
            error: null,
          };
        });
      }
      if (table === "shop_members") {
        // Distinguish hasOwnerMembership's check (.select/.eq/.maybeSingle,
        // returns "no row") from the actual insert - both hit this table,
        // and only the insert matters for the ordering this test checks.
        let isInsert = false;
        const builder = {
          select: vi.fn(() => builder),
          eq: vi.fn(() => builder),
          maybeSingle: vi.fn(() => builder),
          insert: vi.fn(() => {
            isInsert = true;
            return builder;
          }),
          then: (onFulfilled: (v: { data: unknown; error: null }) => unknown) =>
            Promise.resolve().then(() => {
              if (isInsert) {
                events.push(`shop_members:insert:start (shopsInsertResolved=${shopsInsertResolved})`);
              }
              return { data: null, error: null };
            }).then(onFulfilled),
        };
        return builder;
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const client = { from } as unknown as SupabaseClient;

    const shop = await createShop(client, {
      ownerUserId: "user-1",
      name: "Test Shop",
      phone: null,
      catalogMode: "custom_only",
    });

    expect(shop.id).toBe("shop-1");
    expect(events).toEqual([
      "shops:insert:start",
      "shops:insert:resolved",
      "shop_members:insert:start (shopsInsertResolved=true)",
    ]);
  });

  it("resumes an orphaned shop (exists, no membership) instead of creating a duplicate", async () => {
    const insertCalls: string[] = [];

    const from = vi.fn((table: string) => {
      if (table === "shops") {
        return makeQueryResult(async () => ({
          data: { id: "orphan-shop", owner_user_id: "user-1", name: "Orphan Shop", phone: null, catalog_mode: "custom_only" },
          error: null,
        }));
      }
      if (table === "shop_members") {
        const builder = {
          select: vi.fn(() => builder),
          eq: vi.fn(() => builder),
          insert: vi.fn((row: unknown) => {
            insertCalls.push(JSON.stringify(row));
            return builder;
          }),
          maybeSingle: vi.fn(() => builder),
          then: (onFulfilled: (v: { data: unknown; error: null }) => unknown) => {
            // First call (hasOwnerMembership check) returns no row; the
            // insert call (if it happens) resolves with success.
            const hasInsertCall = insertCalls.length > 0;
            return Promise.resolve({ data: hasInsertCall ? null : null, error: null }).then(onFulfilled);
          },
        };
        return builder;
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const client = { from } as unknown as SupabaseClient;

    const shop = await createShop(client, {
      ownerUserId: "user-1",
      name: "Orphan Shop",
      phone: null,
      catalogMode: "custom_only",
    });

    expect(shop.id).toBe("orphan-shop");
    expect(insertCalls).toEqual([JSON.stringify({ shop_id: "orphan-shop", user_id: "user-1", role: "owner" })]);
  });

  it("does not insert a shop_members row if one already exists (fully-completed prior attempt, idempotent)", async () => {
    let membershipInsertCalled = false;

    const from = vi.fn((table: string) => {
      if (table === "shops") {
        return makeQueryResult(async () => ({
          data: { id: "shop-1", owner_user_id: "user-1", name: "Test Shop", phone: null, catalog_mode: "custom_only" },
          error: null,
        }));
      }
      if (table === "shop_members") {
        const builder = {
          select: vi.fn(() => builder),
          eq: vi.fn(() => builder),
          insert: vi.fn(() => {
            membershipInsertCalled = true;
            return builder;
          }),
          maybeSingle: vi.fn(() => builder),
          then: (onFulfilled: (v: { data: unknown; error: null }) => unknown) =>
            Promise.resolve({ data: { shop_id: "shop-1" }, error: null }).then(onFulfilled),
        };
        return builder;
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const client = { from } as unknown as SupabaseClient;

    await createShop(client, { ownerUserId: "user-1", name: "Test Shop", phone: null, catalogMode: "custom_only" });

    expect(membershipInsertCalled).toBe(false);
  });
});

describe("findOwnShop", () => {
  it("returns null when the user owns no shop", async () => {
    const from = vi.fn(() =>
      makeQueryResult(async () => ({ data: null, error: null })),
    );
    const client = { from } as unknown as SupabaseClient;

    const shop = await findOwnShop(client, "user-1");
    expect(shop).toBeNull();
  });

  it("maps a returned row to the Shop shape", async () => {
    const from = vi.fn(() =>
      makeQueryResult(async () => ({
        data: { id: "shop-1", owner_user_id: "user-1", name: "Test Shop", phone: "9876543210", catalog_mode: "base_imported" },
        error: null,
      })),
    );
    const client = { from } as unknown as SupabaseClient;

    const shop = await findOwnShop(client, "user-1");
    expect(shop).toEqual({
      id: "shop-1",
      ownerUserId: "user-1",
      name: "Test Shop",
      phone: "9876543210",
      catalogMode: "base_imported",
    });
  });
});
