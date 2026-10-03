import "fake-indexeddb/auto";
import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseUtterance } from "@/domain/grammar";
import { prepareParserCatalog, type ParserCatalog } from "@/domain/catalogIndex";
import { customItem, editQty, editRate, editUnit } from "@/domain/billEdit";
import type { FinalLine } from "@/domain/finalBill";
import { KiranaBillDB } from "./db";
import { copyBaseCatalog, createShop } from "./shops";
import { reserveBlock } from "./receiptNumbers";
import { pullShop, pullShopProducts, syncNow } from "./sync";
import { loadShopCatalog } from "./shopCatalog";
import { finaliseBill } from "./finalise";
import { learnPendingBills } from "./learnBill";

/**
 * KB-307 commit 3 - learning on the real local stack, shipped code (D32):
 * a Ready-catalog shop (copy_base_catalog - real shop_products ids, so the
 * learning rows go through D53's same-shop composite FKs), real parser output
 * against THAT shop's catalog, finaliseBill -> learnPendingBills -> syncNow.
 * The server then has the learning events (with the server bill id), the
 * alias, the price observation and the provisional product. Learning again and
 * syncing again changes nothing on the server. Local stack only.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

describe("KB-307 e2e - finalise -> learn -> sync (local Postgres)", () => {
  let client: SupabaseClient;
  let shopId: string;
  let shop: ParserCatalog;
  const deviceId = crypto.randomUUID();
  const db = new KiranaBillDB(`e2e-learn-${crypto.randomUUID()}`);

  beforeAll(async () => {
    if (!url || !anonKey) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (.env.local)");
    const host = new URL(url).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`Refusing to run: "${host}" is not the local stack`);
    client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    // Generated test credentials for the LOCAL stack only - never printed.
    const { data, error } = await client.auth.signUp({ email: `e2e-${crypto.randomUUID()}@kb307.local`, password: crypto.randomUUID() });
    if (error || !data.user || !data.session) throw new Error(`local signUp failed: ${error?.message ?? "no session"}`);
    shopId = (await createShop(client, { ownerUserId: data.user.id, name: "KB-307 learning e2e", phone: null, catalogMode: "base_imported" })).id;
    await copyBaseCatalog(client, shopId, deviceId);
    await pullShop(client, db, shopId);
    await pullShopProducts(client, db, shopId);
    await reserveBlock(client, db, shopId, deviceId);
    shop = prepareParserCatalog((await loadShopCatalog(db, shopId)).entries);
  }, 60_000);

  const ok = <T,>(r: { ok: true; item: T } | { ok: false; error: string }): T => {
    if (!r.ok) throw new Error(r.error);
    return r.item;
  };

  function spokenLine(n: number, transcript: string, edit?: (i: FinalLine["item"]) => FinalLine["item"]): FinalLine {
    const [item] = parseUtterance(transcript, shop)!;
    return { id: `l${n}`, utteranceId: n, item: edit ? edit(item!) : item!, original: item!, displayName: shop.byId.get(item!.catalogId!)!.displayName, source: "fastpath" };
  }

  async function rows(table: string) {
    const { data, error } = await client.from(table).select("*").eq("shop_id", shopId);
    if (error) throw new Error(`${table}: ${error.message}`);
    return data as Array<Record<string, unknown>>;
  }

  it("the server gets the events (bill_id = the server bill), the alias, the price observation and the provisional product; a re-run changes nothing", async () => {
    const chiniId = spokenLine(1, "2 kilo चिनी").item.catalogId!;
    const custom = ok(editRate(ok(editQty(ok(editUnit(customItem("kuch naya"), "kg")), "2")), "30"));
    const localId = crypto.randomUUID();
    await finaliseBill(db, {
      localId, shopId, deviceId, startedAt: new Date().toISOString(), customer: { name: "Cash", mobile: null }, flags: [],
      lines: [
        spokenLine(1, "2 kilo चिनी"), // not an exact alias -> L2
        spokenLine(2, "1 kilo besan", (i) => ok(editRate(i, "95"))), // edited rate -> L3 only
        { id: "l3", utteranceId: 3, item: custom, original: customItem("kuch naya"), displayName: "kuch naya", source: "manual" }, // L1
      ],
    });
    expect(await learnPendingBills(db, shopId)).toBe(1);
    await syncNow({ client, localDb: db, shopId, deviceId });

    const { data: bills } = await client.from("bills").select("id").eq("shop_id", shopId).eq("local_id", localId);
    const serverBillId = (bills as Array<{ id: string }>)[0]!.id;

    const aliases = await rows("learned_aliases");
    expect(aliases.map((a) => [a.alias, a.shop_product_id, Number(a.confidence), a.hit_count, a.source])).toEqual([["चिनी", chiniId, 0.5, 1, "confirmation"]]);
    const observations = await rows("price_observations");
    expect(observations.map((o) => Number(o.observed_price_paise))).toEqual([9500]);
    const provisional = await rows("provisional_products");
    expect(provisional.map((p) => [p.spoken_name, p.seen_count, p.suggested_unit, Number(p.suggested_price_paise)])).toEqual([["kuch naya", 1, "kg", 3000]]);
    const events = await rows("learning_events");
    expect(events.map((e) => e.event_type).sort()).toEqual(["alias_confirmed", "bill_learned", "price_observed", "product_sighted"]);
    expect(new Set(events.map((e) => e.bill_id))).toEqual(new Set([serverBillId]));
    expect(events.find((e) => e.event_type === "alias_confirmed")!.payload).toMatchObject({ alias: "चिनी", source_layer: "fastpath" });

    // Idempotent end to end: learning again + syncing again -> the same server rows.
    const before = JSON.stringify([aliases, observations, provisional, events.length]);
    expect(await learnPendingBills(db, shopId)).toBe(0);
    await syncNow({ client, localDb: db, shopId, deviceId });
    const after = JSON.stringify([await rows("learned_aliases"), await rows("price_observations"), await rows("provisional_products"), (await rows("learning_events")).length]);
    expect(after).toBe(before);
  }, 60_000);
});
