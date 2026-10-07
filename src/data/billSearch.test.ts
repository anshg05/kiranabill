import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Dexie, { type DBCore, type Middleware } from "dexie";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import type { FinalLine } from "@/domain/finalBill";
import { toBillSearchRow } from "@/domain/billSearch";
import { KiranaBillDB } from "./db";
import { finaliseBill } from "./finalise";
import { loadSearchIndex } from "./history";
import { pushBills } from "./sync";

// D61 (owner, 7 Oct 2026): each final bill's search text lives in a
// device-only table, billSearch, written in the SAME transaction as the bill;
// existing final bills are backfilled by the version upgrade; the search loads
// read only billSearch (one range query) - never billItems, never anyOf or
// per-id lookups (in-memory IndexedDB can't show that slowness: a DBCore
// middleware records every table access instead); sync never touches it.

const shopId = "11111111-1111-4111-8111-111111111111";
const otherShop = "33333333-3333-4333-8333-333333333333";
const deviceId = "22222222-2222-4222-8222-222222222222";
let db: KiranaBillDB;
const DAY = 86_400_000;

async function seedShop(target: KiranaBillDB, id: string) {
  await target.shops.put({ id, syncStatus: "synced", name: "S", phone: null, address: null, logoUrl: null, catalogMode: "base_imported", billLanguage: "en", receiptPrefix: "KB", updatedAt: "2026-10-07T00:00:00.000Z" });
  await target.receiptNumberBlocks.put({ id: crypto.randomUUID(), shopId: id, deviceId, blockStart: 1, blockEnd: 50, nextNumber: 1, allocatedAt: "2026-10-07T00:00:00.000Z", syncStatus: "synced" });
}

beforeEach(async () => {
  db = new KiranaBillDB(`billsearch-${crypto.randomUUID()}`);
  await seedShop(db, shopId);
  await seedShop(db, otherShop);
});
afterEach(async () => {
  db.close();
  await db.delete();
});

const lines = (t: string): FinalLine[] =>
  parseUtterance(t, SEED_PARSER_CATALOG)!.map((item, i) => ({
    id: `l${i}`, utteranceId: 1, item, original: item, displayName: SEED_PARSER_CATALOG.byId.get(item.catalogId!)!.displayName, source: "fastpath" as const,
  }));

async function save(target: KiranaBillDB, shop: string, transcript: string, daysAgo: number, customer = { name: "Cash", mobile: null as string | null }) {
  const at = new Date(Date.now() - daysAgo * DAY);
  const localId = crypto.randomUUID();
  await finaliseBill(target, { localId, shopId: shop, deviceId, startedAt: at.toISOString(), customer, lines: lines(transcript), flags: [], now: at });
  return localId;
}

/** The row the domain would build for this stored bill - the expected value. */
async function expectedRow(target: KiranaBillDB, localId: string) {
  const b = (await target.bills.get(localId))!;
  const items = (await target.billItems.where("billLocalId").equals(localId).sortBy("lineNo")).map((i) => ({ displayName: i.displayName, spokenName: i.spokenName }));
  return toBillSearchRow({ localId, shopId: b.shopId, receiptNumber: b.receiptNumber, customerName: b.customerName, totalPaise: b.totalPaise, at: b.finalizedAt!, items });
}

/** Every table access, by table and operation (get / getMany / query / openCursor / mutate / count). */
async function recordAccess(target: KiranaBillDB) {
  const log: string[] = [];
  const mw: Middleware<DBCore> = {
    stack: "dbcore",
    name: "recordAccess",
    create: (down) => ({
      ...down,
      table: (name) => {
        const t = down.table(name);
        const wrap = <K extends "get" | "getMany" | "query" | "openCursor" | "mutate" | "count">(op: K) =>
          ((req: never) => {
            log.push(`${name}.${op}`);
            return (t[op] as (r: never) => unknown)(req);
          }) as DBCore["table"] extends (n: string) => infer T ? T extends Record<K, infer F> ? F : never : never;
        return { ...t, get: wrap("get"), getMany: wrap("getMany"), query: wrap("query"), openCursor: wrap("openCursor"), mutate: wrap("mutate"), count: wrap("count") };
      },
    }),
  };
  // Middleware takes effect when the database opens.
  target.close();
  target.use(mw);
  await target.open();
  return log;
}

describe("D61 - finaliseBill writes the search row in the same transaction", () => {
  it("every final bill has its row, equal to toBillSearchRow of the stored bill; never the mobile", async () => {
    const id = await save(db, shopId, "2 kilo chini aur 1 kilo besan", 0, { name: "Ramesh", mobile: "9123456789" });
    const row = await db.billSearch.get(id);
    expect(row).toEqual(await expectedRow(db, id));
    expect(JSON.stringify(row)).not.toContain("9123456789");
    expect((await db.bills.get(id))!.status).toBe("final"); // the bill itself as before (hard rule 2)
  });

  it("if the row can't be written, nothing is written - no bill without its row", async () => {
    db.billSearch.hook("creating", () => {
      throw new Error("search row write failed");
    });
    await expect(save(db, shopId, "2 kilo chini", 0)).rejects.toThrow();
    expect(await db.bills.count()).toBe(0);
    expect(await db.billItems.count()).toBe(0);
  });
});

describe("D61 - the search loads", () => {
  it("90 days = one range query on billSearch; 'older' = this shop's rows; never billItems, never a get / getMany", async () => {
    const recent = await save(db, shopId, "1 kilo besan", 2);
    const old = await save(db, shopId, "2 kilo chini", 120);
    await save(db, otherShop, "2 kilo chini", 1);
    const log = await recordAccess(db);

    const since = new Date(Date.now() - 90 * DAY).toISOString();
    const window = await loadSearchIndex(db, shopId, since);
    expect(window.map((r) => r.localId)).toEqual([recent]);
    const all = await loadSearchIndex(db, shopId, null);
    expect(all.map((r) => r.localId)).toEqual([recent, old]);

    expect(log.filter((l) => !l.startsWith("billSearch."))).toEqual([]); // no billItems, no bills
    expect(log.filter((l) => /\.(get|getMany|openCursor)$/.test(l))).toEqual([]); // no per-id lookups, no anyOf cursor jumps
    expect(log.filter((l) => l === "billSearch.query")).toHaveLength(2); // one query per load
  });
});

describe("D61 - sync never reads or sends billSearch", () => {
  it("pushing a final bill touches no billSearch, and the payload carries no search text", async () => {
    await save(db, shopId, "2 kilo chini", 0, { name: "Ramesh", mobile: null });
    const log = await recordAccess(db);
    const sent: unknown[] = [];
    const client = { rpc: (_name: string, args: unknown) => (sent.push(args), Promise.resolve({ data: crypto.randomUUID(), error: null })) } as unknown as SupabaseClient;
    await pushBills(client, db);
    expect(sent).toHaveLength(1);
    expect(log.some((l) => l.startsWith("bills."))).toBe(true); // the recorder works: the push's own reads are logged
    expect(log.filter((l) => l.startsWith("billSearch."))).toEqual([]);
    expect(JSON.stringify(sent)).not.toMatch(/"text"|"dateKey"|"sequence"/);
  });
});

describe("D61 - the version upgrade backfills existing final bills", () => {
  it("a DB at the old version with REAL finalised bills, opened at the new version: every final bill has a correct row", async () => {
    // Real finalised bills, made by today's finaliseBill...
    const ids = [await save(db, shopId, "2 kilo chini aur 1 kilo besan", 0, { name: "Ramesh", mobile: "9123456789" }), await save(db, shopId, "1 kilo besan", 3), await save(db, otherShop, "2 kilo chini", 120)];
    const bills = await db.bills.toArray();
    const items = await db.billItems.toArray();
    const expected = await Promise.all(ids.map((id) => expectedRow(db, id)));

    // ...copied into a database at the OLD schema (versions 1-3, no billSearch).
    const name = `billsearch-old-${crypto.randomUUID()}`;
    const old = new Dexie(name);
    old.version(1).stores({
      bills: "&localId, shopId, status, syncStatus, createdAt, customerName, totalPaise, [shopId+status]",
      billItems: "++id, billLocalId, &[billLocalId+lineNo]",
      learnedAliases: "&localId, shopId, syncStatus",
      provisionalProducts: "&localId, shopId, syncStatus",
      priceObservations: "&localId, shopId, syncStatus",
      learningEvents: "&localId, shopId, syncStatus",
      shopProducts: "&id, shopId, displayName, *aliases",
      baseProducts: "&id, displayName, *aliases",
      receiptNumberBlocks: "&id, shopId, syncStatus, [shopId+nextNumber]",
      shops: "&id, syncStatus",
      syncState: "&tableName",
    });
    old.version(2).stores({});
    old.version(3).stores({ meta: "&key" });
    await old.open();
    expect(old.tables.map((t) => t.name)).not.toContain("billSearch");
    await old.table("bills").bulkPut([...bills, { ...bills[0]!, localId: crypto.randomUUID(), status: "draft" }]); // a draft gets no row
    await old.table("billItems").bulkPut(items);
    old.close();

    const upgraded = new KiranaBillDB(name);
    await upgraded.open();
    const rows = await upgraded.billSearch.toArray();
    expect(rows.sort((a, b) => a.localId.localeCompare(b.localId))).toEqual(expected.sort((a, b) => a.localId.localeCompare(b.localId)));
    expect(JSON.stringify(rows)).not.toContain("9123456789");
    upgraded.close();
    await upgraded.delete();
  });
});
