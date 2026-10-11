import "fake-indexeddb/auto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { KiranaBillDB, type LocalBill, type LocalBillItem } from "./db";
import { createShop } from "./shops";
import { reserveBlock, consumeNextNumber } from "./receiptNumbers";
import { pushBills } from "./sync";

/**
 * KB-334 (D73, D74): a shop may use several devices at once. Real local stack (D21, D32): a real signUp,
 * real RLS, the real exclusion constraint and the real push_bill. Two "devices" = two Dexie databases of the
 * same user, each with its own device id. Refuses anything but localhost.
 *
 * Run: `npm run test:e2e` (needs `npx supabase start` and every migration, incl. receipt_blocks_no_overlap).
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

function assertLocal(): void {
  if (!url || !anonKey) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (.env.local)");
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`Refusing to run: VITE_SUPABASE_URL host "${host}" is not 127.0.0.1/localhost.`);
  }
}

interface Device {
  id: string;
  db: KiranaBillDB;
}

describe("KB-334 multi-device receipt numbers - real local stack", () => {
  let client: SupabaseClient;
  let pg: Client;
  let shopId: string;
  const devices: Device[] = [];

  const newDevice = (): Device => {
    const d = { id: crypto.randomUUID(), db: new KiranaBillDB(`e2e-md-${crypto.randomUUID()}`) };
    devices.push(d);
    return d;
  };

  const blocksOnServer = async () => {
    const res = await pg.query(
      `select block_start, block_end, device_id from receipt_number_blocks where shop_id = $1 order by block_start`,
      [shopId],
    );
    return res.rows.map((r) => ({ start: Number(r.block_start), end: Number(r.block_end), deviceId: String(r.device_id) }));
  };

  const overlaps = (rows: Array<{ start: number; end: number }>) => {
    const bad: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        if (rows[i]!.start <= rows[j]!.end && rows[j]!.start <= rows[i]!.end) bad.push(`${rows[i]!.start}-${rows[i]!.end} / ${rows[j]!.start}-${rows[j]!.end}`);
      }
    }
    return bad;
  };

  /** A finalised one-line bill on `device`, numbered from its own block, left pending. */
  async function makeBill(device: Device): Promise<string> {
    const localId = crypto.randomUUID();
    const receipt = await consumeNextNumber(client, device.db, shopId, device.id);
    const now = new Date().toISOString();
    const item: LocalBillItem = {
      billLocalId: localId, shopId, lineNo: 1, shopProductId: null, displayName: "Chini", spokenName: "chini", qty: 1, unit: "kg", ratePaise: 4500,
      rateUnit: "kg", totalPaise: 4500, priceType: "default", source: "fastpath", reviewFlags: [], wasEdited: false,
    };
    const bill: LocalBill = {
      localId, shopId, status: "final", syncStatus: "pending", receiptNumber: receipt.receiptNumber, receiptNumberSource: receipt.source,
      customerName: "Cash", customerMobile: null, subtotalPaise: 4500, totalPaise: 4500, schemaVersion: 1,
      deviceId: device.id, createdAt: now, finalizedAt: now, syncedAt: null,
    };
    await device.db.bills.add(bill);
    await device.db.billItems.add(item);
    return receipt.receiptNumber;
  }

  beforeAll(async () => {
    assertLocal();
    pg = new Client({ connectionString: DB_URL });
    await pg.connect();
    client = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    // Generated test credentials for the LOCAL stack only - never printed.
    const { data, error } = await client.auth.signUp({ email: `e2e-${crypto.randomUUID()}@kb334.local`, password: crypto.randomUUID() });
    if (error || !data.user || !data.session) throw new Error(`local signUp failed: ${error?.message ?? "no session"}`);
    const shop = await createShop(client, { ownerUserId: data.user.id, name: "KB-334 e2e", phone: null, catalogMode: "custom_only" });
    shopId = shop.id;
  });

  afterAll(async () => {
    await pg?.end();
    devices.forEach((d) => d.db.close());
  });

  it("1. the database refuses an overlapping block for the same shop (23P01) and accepts the next one", async () => {
    const insert = (start: number, end: number) =>
      pg.query(
        `insert into receipt_number_blocks (shop_id, device_id, block_start, block_end, next_number) values ($1, 'sql-probe', $2, $3, $2)`,
        [shopId, start, end],
      );
    try {
      await insert(9001, 9050);
      await expect(insert(9025, 9075)).rejects.toMatchObject({ code: "23P01" });
      await expect(insert(9001, 9050)).rejects.toMatchObject({ code: "23P01" });
      await insert(9051, 9100); // adjacent is fine
    } finally {
      await pg.query(`delete from receipt_number_blocks where shop_id = $1 and device_id = 'sql-probe'`, [shopId]);
    }
  });

  it("2. four devices reserving at the same instant, three rounds: no overlap, and every device ends up with a block", async () => {
    const before = (await blocksOnServer()).length;
    for (let round = 0; round < 3; round++) {
      const four = [newDevice(), newDevice(), newDevice(), newDevice()];
      await Promise.all(four.map((d) => reserveBlock(client, d.db, shopId, d.id)));
      for (const d of four) {
        const mine = await d.db.receiptNumberBlocks.where("shopId").equals(shopId).toArray();
        expect(mine.filter((b) => b.deviceId === d.id).length, `device ${d.id} has no block in round ${round}`).toBeGreaterThanOrEqual(1);
      }
    }
    const all = await blocksOnServer();
    expect(all.length).toBe(before + 12);
    expect(overlaps(all)).toEqual([]);
  });

  it("3. two devices bill at the same time: every receipt number is different and every bill reaches the server", async () => {
    const a = newDevice();
    const b = newDevice();
    await Promise.all([reserveBlock(client, a.db, shopId, a.id), reserveBlock(client, b.db, shopId, b.id)]);
    const numbers: string[] = [];
    for (let i = 0; i < 5; i++) {
      numbers.push(await makeBill(a));
      numbers.push(await makeBill(b));
    }
    expect(new Set(numbers).size).toBe(10);
    const [ra, rb] = await Promise.all([pushBills(client, a.db), pushBills(client, b.db)]);
    expect(ra.anyTransientFailure).toBe(false);
    expect(rb.anyTransientFailure).toBe(false);
    for (const d of [a, b]) {
      const bills = await d.db.bills.toArray();
      expect(bills.map((x) => x.syncStatus)).toEqual(Array(5).fill("synced"));
    }
    const onServer = await pg.query(`select receipt_number from bills where shop_id = $1 and receipt_number = any($2)`, [shopId, numbers]);
    expect(onServer.rowCount).toBe(10);
  });
});
