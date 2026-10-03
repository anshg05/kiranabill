import "fake-indexeddb/auto";
import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { billFlags, type UtteranceRecord } from "@/domain/billEdit";
import { evaluateReviewFlags } from "@/domain/reviewFlags";
import type { FinalLine } from "@/domain/finalBill";
import { KiranaBillDB } from "./db";
import { createShop } from "./shops";
import { reserveBlock } from "./receiptNumbers";
import { syncNow } from "./sync";
import { finaliseBill, type FinaliseInput } from "./finalise";

/**
 * KB-307 commit 2 - finalise on the real local stack, shipped code (D21/D32):
 * finaliseBill() writes the bill locally (one Dexie transaction), syncNow()
 * pushes it through push_bill. Online -> block number; no block (the offline-
 * exhaustion path) -> D23 fallback number, synced later as 'fallback'; a double
 * tap -> one bill on the server; a failure inside the transaction -> nothing
 * written, nothing consumed, nothing pushed. Local stack only.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

describe("KB-307 e2e - finalise -> sync (local Postgres)", () => {
  let client: SupabaseClient;
  let shopId: string;

  beforeAll(async () => {
    if (!url || !anonKey) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (.env.local)");
    const host = new URL(url).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`Refusing to run: "${host}" is not the local stack`);
    client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    // Generated test credentials for the LOCAL stack only - never printed.
    const { data, error } = await client.auth.signUp({ email: `e2e-${crypto.randomUUID()}@kb307.local`, password: crypto.randomUUID() });
    if (error || !data.user || !data.session) throw new Error(`local signUp failed: ${error?.message ?? "no session"}`);
    shopId = (await createShop(client, { ownerUserId: data.user.id, name: "KB-307 finalise e2e", phone: null, catalogMode: "custom_only" })).id;
  });

  /** A device: its own local DB and id (blocks belong to a device, D38). */
  function device() {
    return { db: new KiranaBillDB(`e2e-finalise-${crypto.randomUUID()}`), deviceId: crypto.randomUUID() };
  }

  /** Real parser output for each utterance, with the flags the screen would place. */
  function draft(deviceId: string, ...transcripts: string[]): FinaliseInput {
    const lines: FinalLine[] = [];
    const utterances: UtteranceRecord[] = [];
    transcripts.forEach((t, u) => {
      const items = parseUtterance(t, SEED_PARSER_CATALOG)!;
      const ids = items.map((item) => {
        const id = `l${lines.length + 1}`;
        lines.push({ id, utteranceId: u + 1, item, original: item, displayName: SEED_PARSER_CATALOG.byId.get(item.catalogId!)!.displayName, source: "fastpath" });
        return id;
      });
      utterances.push({ id: u + 1, lineIds: ids, flags: [...evaluateReviewFlags(t, items, SEED_PARSER_CATALOG.entries)], transcript: t });
    });
    // custom_only shop: the seed's ids aren't this shop's products, so the lines carry no product id here.
    const shopless = lines.map((l) => ({ ...l, item: { ...l.item, catalogId: null }, original: { ...l.original, catalogId: null } }));
    const flags = billFlags(lines, utterances, SEED_PARSER_CATALOG.entries).map((f) => ({ ...f, acknowledged: f.severity === "HIGH" }));
    return { localId: crypto.randomUUID(), shopId, deviceId, startedAt: new Date().toISOString(), customer: { name: "Cash", mobile: null }, lines: shopless, flags };
  }

  async function serverBill(localId: string) {
    const { data, error } = await client
      .from("bills")
      .select("status, receipt_number, receipt_number_source, total_paise, bill_items(line_no, display_name, total_paise, review_flags, source)")
      .eq("shop_id", shopId)
      .eq("local_id", localId);
    if (error) throw new Error(error.message);
    return data;
  }

  it("online: block number; synced; the server has the bill, its items and their review flags (with acknowledgement)", async () => {
    const { db, deviceId } = device();
    await reserveBlock(client, db, shopId, deviceId);
    const d = draft(deviceId, "2 kilo chini 5 wala", "1 kilo besan"); // HIGH unusual_rate + unusual_total, acknowledged
    const saved = await finaliseBill(db, d);
    expect(saved.source).toBe("block");
    await syncNow({ client, localDb: db, shopId, deviceId });
    expect((await db.bills.get(d.localId))?.syncStatus).toBe("synced");
    const [bill] = await serverBill(d.localId);
    expect(bill).toMatchObject({ status: "final", receipt_number: saved.receiptNumber, receipt_number_source: "block", total_paise: 1000 + 9000 });
    const items = [...(bill!.bill_items as Array<Record<string, unknown>>)].sort((a, b) => (a.line_no as number) - (b.line_no as number));
    expect(items.map((i) => [i.line_no, i.display_name, i.total_paise])).toEqual([
      [1, "Chini", 1000],
      [2, "Besan", 9000],
    ]);
    expect(items[0]!.review_flags).toEqual(
      expect.arrayContaining([
        { code: "unusual_rate", severity: "HIGH", acknowledged: true },
        { code: "unusual_total", severity: "HIGH", acknowledged: true },
      ]),
    );
  });

  it("offline (no block on this device): D23 fallback number; pushed later, stored as 'fallback'", async () => {
    const { db, deviceId } = device(); // never reserved a block - the offline-exhaustion path
    const d = draft(deviceId, "2 kilo chini");
    const saved = await finaliseBill(db, d);
    expect(saved).toMatchObject({ source: "fallback", receiptNumber: `KB-${deviceId}-1` });
    expect((await db.bills.get(d.localId))?.syncStatus).toBe("pending");
    await syncNow({ client, localDb: db, shopId, deviceId }); // "back online"
    const [bill] = await serverBill(d.localId);
    expect(bill).toMatchObject({ receipt_number: `KB-${deviceId}-1`, receipt_number_source: "fallback", status: "final" });
  });

  it("double tap: two concurrent finalises -> one bill locally and on the server", async () => {
    const { db, deviceId } = device();
    await reserveBlock(client, db, shopId, deviceId);
    const d = draft(deviceId, "1 kilo besan");
    const [a, b] = await Promise.all([finaliseBill(db, d), finaliseBill(db, d)]);
    expect(a.receiptNumber).toBe(b.receiptNumber);
    expect(await db.bills.count()).toBe(1);
    await syncNow({ client, localDb: db, shopId, deviceId });
    expect(await serverBill(d.localId)).toHaveLength(1);
  });

  it("a failure inside the transaction: nothing written, no number consumed, nothing reaches the server", async () => {
    const { db, deviceId } = device();
    await reserveBlock(client, db, shopId, deviceId);
    const before = (await db.receiptNumberBlocks.toArray())[0]!.nextNumber;
    const d = draft(deviceId, "1 kilo besan");
    const fail = () => {
      throw new Error("simulated disk failure");
    };
    db.billItems.hook("creating", fail);
    await expect(finaliseBill(db, d)).rejects.toThrow();
    db.billItems.hook("creating").unsubscribe(fail);
    expect(await db.bills.count()).toBe(0);
    expect((await db.receiptNumberBlocks.toArray())[0]!.nextNumber).toBe(before);
    await syncNow({ client, localDb: db, shopId, deviceId });
    expect(await serverBill(d.localId)).toHaveLength(0);
  });
});
