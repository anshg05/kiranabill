import "fake-indexeddb/auto";
import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { KiranaBillDB, type LocalBill } from "./db";
import { createShop } from "./shops";
import { consumeNextNumber, reserveBlock } from "./receiptNumbers";
import { pushBills } from "./sync";
import { isStorableMobile, isStorableName, parseCustomerName, parseIndianMobile } from "@/domain/customer";

/**
 * KB-306 (owner, 3 Oct 2026; D52): the client and the bills CHECK constraints
 * apply IDENTICAL rules - a mismatch would make a bill a permanent 23514 sync
 * conflict. Every tricky input goes through the SHIPPED path (D32): parsed
 * like the screen does, written to Dexie, pushed by pushBills() through the
 * real push_bill() to the local Postgres. client-accept <=> server-accept.
 * Local stack only; `npm run test:e2e`.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const NAMES = [
  "Cash",
  "",
  "  Ramesh   Kumar  ",
  "रामलाल जी",
  "a".repeat(60),
  "a".repeat(61),
  "😀".repeat(60), // 60 code points, 120 UTF-16 units
  "😀".repeat(61),
  "क्षि".repeat(15), // 60 code points
  `${"क्षि".repeat(15)}क`, // 61
  "👨‍👩‍👧".repeat(12), // ZWJ family: 5 code points each = 60
  `${"👨‍👩‍👧".repeat(12)}x`,
  "Ram\u0000esh",
];

const MOBILES = [
  "",
  "9876543210",
  "98765 43210",
  "98765-43210",
  "+91 98765 43210",
  "+919876543210",
  "919876543210",
  "09876543210",
  "९८७६५४३२१०",
  "+९१ ९८७६५ ४३२१०",
  "6000000000",
  "12345",
  "98765432101",
  "5876543210",
  "0000000000",
  "+1 9876543210",
  "abc",
];

describe("KB-306 e2e - customer rules: client <=> bills CHECK constraints (local Postgres)", () => {
  let client: SupabaseClient;
  let shopId: string;
  const deviceId = crypto.randomUUID();
  const localDb = new KiranaBillDB(`e2e-customer-${crypto.randomUUID()}`);

  beforeAll(async () => {
    if (!url || !anonKey) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (.env.local)");
    const host = new URL(url).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`Refusing to run: "${host}" is not the local stack`);
    client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    // Generated test credentials for the LOCAL stack only - never printed.
    const { data, error } = await client.auth.signUp({ email: `e2e-${crypto.randomUUID()}@kb306.local`, password: crypto.randomUUID() });
    if (error || !data.user || !data.session) throw new Error(`local signUp failed: ${error?.message ?? "no session"}`);
    shopId = (await createShop(client, { ownerUserId: data.user.id, name: "KB-306 e2e", phone: null, catalogMode: "custom_only" })).id;
    await reserveBlock(client, localDb, shopId, deviceId);
  });

  /** Push one final bill with these customer fields; true = the server stored it. */
  async function serverAccepts(customerName: string, customerMobile: string | null): Promise<boolean> {
    const localId = crypto.randomUUID();
    const receipt = await consumeNextNumber(client, localDb, shopId, deviceId);
    const now = new Date().toISOString();
    const bill: LocalBill = {
      localId, shopId, status: "final", syncStatus: "pending",
      receiptNumber: receipt.receiptNumber, receiptNumberSource: receipt.source,
      customerName, customerMobile, subtotalPaise: 4500, totalPaise: 4500, schemaVersion: 1,
      deviceId, createdAt: now, finalizedAt: now, syncedAt: null,
    };
    await localDb.bills.add(bill);
    await localDb.billItems.add({
      billLocalId: localId, shopId, lineNo: 1, shopProductId: null, displayName: "Chini", spokenName: "Chini",
      qty: 1, unit: "kg", ratePaise: 4500, rateUnit: "kg", totalPaise: 4500, priceType: "default", source: "manual", reviewFlags: [], wasEdited: false,
    });
    await pushBills(client, localDb);
    const status = (await localDb.bills.get(localId))?.syncStatus;
    if (status !== "synced" && status !== "conflict") throw new Error(`bill ${localId} ended ${status} - transient, not a verdict`);
    return status === "synced";
  }

  it("names: what the client would store is accepted iff the client accepts the input", { timeout: 120_000 }, async () => {
    const rows: string[] = [];
    for (const raw of NAMES) {
      const parsed = parseCustomerName(raw);
      const sent = parsed.ok ? parsed.value : raw;
      const accepted = await serverAccepts(sent, null);
      rows.push(`${JSON.stringify(raw).slice(0, 40).padEnd(42)} client ${parsed.ok ? "accept" : "reject"} · server ${accepted ? "accept" : "reject"}`);
      expect([raw, accepted]).toEqual([raw, parsed.ok]);
    }
    console.log(rows.join("\n"));
  });

  it("mobiles: what the client would store is accepted iff the client accepts the input", { timeout: 120_000 }, async () => {
    const rows: string[] = [];
    for (const raw of MOBILES) {
      const parsed = parseIndianMobile(raw);
      const sent = parsed.ok ? parsed.value : raw;
      const accepted = await serverAccepts("Cash", sent);
      rows.push(`${JSON.stringify(raw).padEnd(22)} -> ${JSON.stringify(sent).padEnd(16)} client ${parsed.ok ? "accept" : "reject"} · server ${accepted ? "accept" : "reject"}`);
      expect([raw, accepted]).toEqual([raw, parsed.ok]);
    }
    console.log(rows.join("\n"));
  });

  it("the stored-value checks mirror the CHECKs on raw strings too", { timeout: 120_000 }, async () => {
    for (const raw of NAMES.filter((n) => !n.includes("\u0000"))) {
      expect([raw, await serverAccepts(raw, null)]).toEqual([raw, isStorableName(raw)]);
    }
    for (const raw of MOBILES) {
      const value = raw === "" ? null : raw;
      expect([raw, await serverAccepts("Cash", value)]).toEqual([raw, isStorableMobile(value)]);
    }
  });
});
