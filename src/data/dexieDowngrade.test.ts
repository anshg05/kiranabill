import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import type { FinalLine } from "@/domain/finalBill";
import { KiranaBillDB } from "./db";
import { finaliseBill } from "./testNumbers";

// Option (b) step 1 (owner + reviewer, 18 Nov 2026): the phone's database went from version 8 (the 10 Nov 2026 release, ffb073f) to 9
// (KB-413 step 2's recordingDraft). If a later build ever runs OLDER code on a phone that already has version 9 - a build that goes back
// to earlier code - that older code asks IndexedDB for version 8. Dexie 4.4 retries the open at the installed version (dexie.mjs,
// tryOpenDB: on VersionError it opens with no version). This proves it on a real database: the 10 Nov schema (versions 1-8, the same
// store strings; its upgrades never run on a database already at 9) opens a version-9 database, reads it, bills on it - and today's code
// then still finds everything, its own table included. Every version must stay additive for this to hold (D55 §5's rule, on the phone).

/** The 10 Nov 2026 release's schema: KiranaBillDB's versions 1-8 exactly as released (ffb073f), nothing after. */
class ReleasedV8DB extends Dexie {
  constructor(name: string) {
    super(name);
    this.version(1).stores({
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
    this.version(2).stores({});
    this.version(3).stores({ meta: "&key" });
    this.version(4).stores({ billSearch: "&localId, [shopId+finalizedAt]" });
    this.version(5).stores({ billCancellations: "&billLocalId, shopId, replacementLocalId, syncStatus" });
    this.version(6).stores({ billMetrics: "&billLocalId, shopId, syncStatus", reviewCapture: "++id, shopId, billLocalId, capturedAt" });
    this.version(7).stores({ learningEvents: "&localId, shopId, syncStatus, [shopId+eventType]" });
    this.version(8).stores({ voiceQueue: "&recordingId, shopId, billLocalId, state" });
  }
}

const shopId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
const lines = (t: string): FinalLine[] =>
  parseUtterance(t, SEED_PARSER_CATALOG)!.map((item, i) => ({
    id: `l${i}`, utteranceId: 1, item, original: item, displayName: SEED_PARSER_CATALOG.byId.get(item.catalogId!)!.displayName, source: "fastpath" as const,
  }));

const names: string[] = [];
afterEach(async () => {
  for (const n of names.splice(0)) await Dexie.delete(n);
});

describe("the phone's database: older code (version 8) opens today's version 9", () => {
  it("the 10 Nov schema opens a version-9 database, reads the bills, bills on it; today's code then finds everything, its own table too", async () => {
    const name = `downgrade-${crypto.randomUUID()}`;
    names.push(name);

    // today's code: version 9, a saved bill, a saved recording (the version-9 table), a recording in the voice queue
    const now = new KiranaBillDB(name);
    await now.shops.put({ id: shopId, syncStatus: "synced", name: "Gupta Kirana Store", phone: null, address: null, logoUrl: null, catalogMode: "custom_only", billLanguage: "en", receiptPrefix: "KB", updatedAt: "2026-11-18T10:00:00.000Z" });
    await finaliseBill(now, { localId: crypto.randomUUID(), shopId, deviceId, startedAt: "2026-11-18T10:00:00.000Z", customer: { name: "Cash", mobile: null }, lines: lines("2 kilo chini"), flags: [], now: new Date("2026-11-18T10:01:00.000Z") });
    await now.recordingDraft.put({ shopId, bytes: new ArrayBuffer(8), mime: "audio/webm", recordedMs: 4200, savedAt: "2026-11-18T10:02:00.000Z" });
    await now.voiceQueue.put({ recordingId: "rec-1", shopId, billLocalId: "bill-x", state: "queued" } as never);
    expect(now.verno).toBe(9);
    now.close();

    // the older code: asks for version 8 - must open (at 9), read and write
    const old = new ReleasedV8DB(name);
    await old.open();
    // opened, not refused - at the phone's installed IndexedDB version (Dexie stores version x 10: 90 = version 9); Dexie's verno says 8
    expect(old.backendDB().version).toBe(90);
    const bills = await old.table("bills").where("[shopId+status]").equals([shopId, "final"]).toArray();
    expect(bills).toHaveLength(1);
    expect(await old.table("billItems").where("billLocalId").equals(bills[0].localId).count()).toBeGreaterThan(0);
    expect((await old.table("voiceQueue").get("rec-1"))?.state).toBe("queued");
    // and it bills (the same writes finalise does: a bill, its items, its search row)
    const t = (n: string) => old.table<Record<string, unknown>>(n);
    const second: Record<string, unknown> = { ...bills[0], localId: crypto.randomUUID(), receiptNumber: "TEST-2", syncStatus: "pending" };
    // (three plain writes - a typed multi-table transaction is too deep for tsc here; the point is that each table takes a write)
    await t("bills").add(second);
    await t("billItems").add({ billLocalId: second.localId, shopId, lineNo: 1, displayName: "Chini", totalPaise: 9000 });
    await t("billSearch").put({ localId: second.localId, shopId, finalizedAt: second.finalizedAt });
    old.close();

    // today's code again: both bills, the old code's write, and the version-9 table it never knew about
    const again = new KiranaBillDB(name);
    expect(await again.bills.where("[shopId+status]").equals([shopId, "final"]).count()).toBe(2);
    expect((await again.recordingDraft.get(shopId))?.recordedMs).toBe(4200);
    expect(again.verno).toBe(9);
    again.close();
  });
});
