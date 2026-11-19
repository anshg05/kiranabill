import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { KiranaBillDB, shopDbName } from "./db";
import { DeviceDB } from "./device";
import { deleteMyAccount, type DeleteDeps } from "./accountDeletion";

// KB-430 (D119): the phone's side of "Delete my account". The SERVER deletes everything in one transaction (delete_my_account); the
// phone touches nothing of its own until the server has answered "deleted" - then it deletes this user's database, forgets the
// active user and signs out locally. Offline: nothing happens. A shared shop: nothing happens. A lost answer: the phone asks whether
// the login still exists - gone means the deletion finished, there means nothing was deleted.

const USER = "11111111-1111-4111-8111-111111111111";
const SHOP = "22222222-2222-4222-8222-222222222222";
const calls: string[] = [];

function fakeClient(opts: { rpc?: () => Promise<{ data: unknown; error: unknown }>; logos?: string[]; removeError?: unknown; userGone?: boolean } = {}) {
  return {
    storage: {
      from: (bucket: string) => ({
        list: async (prefix: string) => {
          calls.push(`list ${bucket} ${prefix}`);
          return { data: (opts.logos ?? []).map((name) => ({ name })), error: null };
        },
        remove: async (paths: string[]) => {
          calls.push(`remove ${bucket} ${paths.join(",")}`);
          return { data: null, error: opts.removeError ?? null };
        },
      }),
    },
    rpc: async (name: string) => {
      calls.push(`rpc ${name}`);
      return (opts.rpc ?? (async () => ({ data: { bills: 3, shops: 1, auth_users: 1 }, error: null })))();
    },
    auth: {
      getUser: async () => {
        calls.push("getUser");
        return opts.userGone ? { data: { user: null }, error: { status: 403, message: "User from sub claim in JWT does not exist" } } : { data: { user: { id: USER } }, error: null };
      },
      signOut: async (o?: { scope?: string }) => {
        calls.push(`signOut ${o?.scope ?? "global"}`);
        return { error: null };
      },
    },
  };
}

async function phone() {
  const localDb = new KiranaBillDB(shopDbName(USER));
  await localDb.open();
  const deviceDb = new DeviceDB(`dev-${crypto.randomUUID()}`);
  await deviceDb.meta.put({ key: "activeUserId", value: USER });
  return { localDb, deviceDb };
}
const exists = async (name: string) => (await Dexie.getDatabaseNames()).includes(name);
const run = async (client: ReturnType<typeof fakeClient>, online = true) => {
  const p = await phone();
  const out = await deleteMyAccount({ client: client as unknown as DeleteDeps["client"], userId: USER, shopIds: [SHOP], localDb: p.localDb, deviceDb: p.deviceDb, isOnline: () => online });
  return { out, ...p };
};

afterEach(async () => {
  calls.length = 0;
  for (const n of await Dexie.getDatabaseNames()) await Dexie.delete(n);
});

describe("deleteMyAccount (KB-430)", () => {
  it("online: the shop's logo files, then the server - and only then the phone's database, the active user and a LOCAL sign-out", async () => {
    const { out, deviceDb } = await run(fakeClient({ logos: ["logo.png"] }));
    expect(out).toEqual({ kind: "deleted", counts: { bills: 3, shops: 1, auth_users: 1 } });
    expect(calls).toEqual([`list shop-logos ${SHOP}`, `remove shop-logos ${SHOP}/logo.png`, "rpc delete_my_account", "signOut local"]);
    expect(await exists(shopDbName(USER))).toBe(false);
    expect(await deviceDb.meta.get("activeUserId")).toBeUndefined(); // forgotten (setActiveUserId(null) removes the key)
  });

  it("offline: nothing is asked and nothing on the phone is touched", async () => {
    const { out, localDb } = await run(fakeClient(), false);
    expect(out).toEqual({ kind: "offline" });
    expect(calls).toEqual([]);
    expect(localDb.isOpen()).toBe(true);
    expect(await exists(shopDbName(USER))).toBe(true);
  });

  it("a shop with other members: refused by the server - the phone keeps everything", async () => {
    const { out } = await run(fakeClient({ rpc: async () => ({ data: null, error: { code: "P0001", message: "delete_account: a shop has other members - remove them first", hint: "shared_shop" } }) }));
    expect(out).toEqual({ kind: "shared_shop" });
    expect(await exists(shopDbName(USER))).toBe(true);
    expect(calls).not.toContain("signOut local");
  });

  it("a logo that will not go: stops BEFORE the server is asked - nothing deleted anywhere", async () => {
    const { out } = await run(fakeClient({ logos: ["logo.png"], removeError: { message: "storage down" } }));
    expect(out).toEqual({ kind: "failed", reason: "logos" });
    expect(calls).not.toContain("rpc delete_my_account");
    expect(await exists(shopDbName(USER))).toBe(true);
  });

  it("the answer was lost and the login is GONE: the deletion finished - the phone is cleared", async () => {
    const { out } = await run(fakeClient({ rpc: async () => ({ data: null, error: { message: "TypeError: Failed to fetch" } }), userGone: true }));
    expect(out).toEqual({ kind: "deleted", counts: null });
    expect(await exists(shopDbName(USER))).toBe(false);
  });

  it("the answer was lost and the login is STILL THERE: nothing was deleted (one transaction) - the phone keeps everything", async () => {
    const { out } = await run(fakeClient({ rpc: async () => ({ data: null, error: { message: "TypeError: Failed to fetch" } }) }));
    expect(out).toEqual({ kind: "failed", reason: "server" });
    expect(await exists(shopDbName(USER))).toBe(true);
    expect(calls).not.toContain("signOut local");
  });

  it("any other server error: nothing on the phone is touched", async () => {
    const { out } = await run(fakeClient({ rpc: async () => ({ data: null, error: { code: "XX000", message: "boom" } }) }));
    expect(out).toEqual({ kind: "failed", reason: "server" });
    expect(await exists(shopDbName(USER))).toBe(true);
  });
});
