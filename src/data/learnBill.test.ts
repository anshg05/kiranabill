import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { customItem, editRate, editUnit, editQty } from "@/domain/billEdit";
import type { FinalLine } from "@/domain/finalBill";
import { deterministicUuid } from "@/domain/ids";
import { KiranaBillDB } from "./db";
import { finaliseBill, type FinaliseInput } from "./finalise";
import { learnFromSavedBill, learnPendingBills } from "./learnBill";
import { isLearningPullDone, markLearningPullDone } from "./pullLearning";

// KB-307 commit 3 (owner, 3 Oct 2026): learning runs AFTER the bill commit, in
// its own transaction (08 §8), from the committed bill. Every learning row's id
// is deterministic (bill localId + line + kind), and a "bill_learned" marker is
// written in the same transaction - so a re-run (recovery, two tabs - KI-39) is
// a no-op, never double-counted. Real parser output (D39).

const shopId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
let db: KiranaBillDB;

beforeEach(async () => {
  db = new KiranaBillDB(`learn-${crypto.randomUUID()}`);
  await db.shops.put({ id: shopId, syncStatus: "synced", name: "Test", phone: null, address: null, logoUrl: null, catalogMode: "base_imported", billLanguage: "hi", receiptPrefix: "KB", updatedAt: "2026-10-03T00:00:00.000Z" });
  // This shop's catalog = the seed, with the seed's ids as shop product ids.
  await db.shopProducts.bulkPut(
    SEED_PARSER_CATALOG.entries.map((e) => ({
      id: e.id, shopId, baseProductId: e.id, displayName: e.displayName, category: null, unit: e.unit, pricePaise: e.suggestedPricePaise,
      aliases: e.aliases, source: "base" as const, useCount: 0, sku: null, barcode: null, isActive: true,
    })),
  );
  await db.receiptNumberBlocks.put({ id: crypto.randomUUID(), shopId, deviceId, blockStart: 1, blockEnd: 50, nextNumber: 1, allocatedAt: "2026-10-03T00:00:00.000Z", syncStatus: "synced" });
});
afterEach(async () => {
  db.close();
  await db.delete();
});

const ok = <T,>(r: { ok: true; item: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.item;
};

function line(n: number, transcript: string, source: FinalLine["source"] = "fastpath", edit?: (i: FinalLine["item"]) => FinalLine["item"]): FinalLine {
  const [item] = parseUtterance(transcript, SEED_PARSER_CATALOG)!;
  return { id: `l${n}`, utteranceId: n, item: edit ? edit(item!) : item!, original: item!, displayName: SEED_PARSER_CATALOG.byId.get(item!.catalogId!)!.displayName, source };
}

function custom(n: number, name: string, rate: string): FinalLine {
  const kg = ok(editUnit(customItem(name), "kg"));
  const priced = ok(editRate(ok(editQty(kg, "2")), rate));
  return { id: `l${n}`, utteranceId: n, item: priced, original: customItem(name), displayName: name, source: "manual" };
}

function bill(lines: FinalLine[], over: Partial<FinaliseInput> = {}): FinaliseInput {
  return { localId: crypto.randomUUID(), shopId, deviceId, startedAt: "2026-10-03T10:00:00.000Z", customer: { name: "Ramesh Kumar", mobile: "9876543210" }, lines, flags: [], ...over };
}

/** Everything learning writes, in a stable order - for "identical state" checks. */
async function snapshot() {
  const by = <T extends { localId: string }>(rows: T[]) => rows.sort((a, b) => a.localId.localeCompare(b.localId));
  return {
    aliases: by(await db.learnedAliases.toArray()),
    provisional: by(await db.provisionalProducts.toArray()),
    observations: by(await db.priceObservations.toArray()),
    events: by(await db.learningEvents.toArray()),
  };
}

const NOW = Date.parse("2026-10-03T12:00:00.000Z");

describe("learnFromSavedBill - what a finalised bill writes", () => {
  it("alias, price observation, provisional product and their events - ids derived from the bill; every alias event tagged with its layer", async () => {
    const draft = bill([line(1, "2 kilo चिनी"), line(2, "3 parle ji 10 wala", "voice"), line(3, "1 kilo besan", "manual", (i) => ok(editRate(i, "95"))), custom(4, "kuch naya", "30")]);
    await finaliseBill(db, draft);
    expect(await learnFromSavedBill(db, draft.localId, NOW)).toEqual({ learned: true, decisions: 4 });
    const s = await snapshot();

    expect(s.aliases.map((a) => [a.alias, a.shopProductId, a.confidence, a.hitCount, a.source, a.syncStatus, a.shopId, a.deviceId])).toEqual(
      expect.arrayContaining([
        ["चिनी", "27", 0.5, 1, "confirmation", "pending", shopId, deviceId],
        ["parle ji", "52", 0.5, 1, "confirmation", "pending", shopId, deviceId],
      ]),
    );
    expect(s.aliases.find((a) => a.alias === "चिनी")!.localId).toBe(deterministicUuid("learned_alias", shopId, "चिनी"));
    expect(s.observations).toEqual([
      expect.objectContaining({ localId: deterministicUuid("price_observation", draft.localId, 3), shopProductId: expect.any(String), observedPricePaise: 9500, syncStatus: "pending" }),
    ]);
    expect(s.provisional).toEqual([expect.objectContaining({ spokenName: "kuch naya", seenCount: 1, suggestedUnit: "kg", suggestedPricePaise: 3000, promotedAt: null })]);

    const events = s.events.map((e) => [e.eventType, e.billLocalId, (e.payload as { source_layer?: string }).source_layer ?? null]);
    expect(events).toEqual(
      expect.arrayContaining([
        ["alias_confirmed", draft.localId, "fastpath"],
        ["alias_confirmed", draft.localId, "gemini"],
        ["price_observed", draft.localId, null],
        ["product_sighted", draft.localId, null],
        ["bill_learned", draft.localId, null],
      ]),
    );
    expect(s.events.find((e) => e.eventType === "bill_learned")!.localId).toBe(deterministicUuid("bill_learned", draft.localId));
  });

  it("no customer data in any learning row (DPDP - D52)", async () => {
    const draft = bill([line(1, "2 kilo चिनी"), custom(2, "kuch naya", "30")]);
    await finaliseBill(db, draft);
    await learnFromSavedBill(db, draft.localId, NOW);
    const all = JSON.stringify(await snapshot());
    expect(all).not.toContain("Ramesh");
    expect(all).not.toContain("9876543210");
  });

  it("run twice -> identical state; the second run is a no-op (owner)", async () => {
    const draft = bill([line(1, "2 kilo चिनी"), line(2, "2 kilo cheeni", "fastpath", (i) => ok(editRate(i, "48"))), custom(3, "kuch naya", "30")]);
    await finaliseBill(db, draft);
    await learnFromSavedBill(db, draft.localId, NOW);
    const once = await snapshot();
    expect(await learnFromSavedBill(db, draft.localId, NOW + 60_000)).toEqual({ learned: false, decisions: 0 });
    expect(await snapshot()).toEqual(once);
  });

  it("two tabs learning the same bill at once -> the same state as one run (KI-39)", async () => {
    const draft = bill([line(1, "2 kilo चिनी"), custom(2, "kuch naya", "30")]);
    await finaliseBill(db, draft);
    const results = await Promise.all([learnFromSavedBill(db, draft.localId, NOW), learnFromSavedBill(db, draft.localId, NOW)]);
    expect(results.map((r) => r.learned).sort()).toEqual([false, true]);
    const s = await snapshot();
    expect(s.aliases).toHaveLength(1);
    expect(s.aliases[0]).toMatchObject({ hitCount: 1, confidence: 0.5 });
    expect(s.provisional[0]).toMatchObject({ seenCount: 1 });
  });

  it("a removed voice line with a learned alias suppresses it on the NEXT bill (the removed lines are kept on the bill locally)", async () => {
    const first = bill([line(1, "2 kilo चिनी")]);
    await finaliseBill(db, first);
    await learnFromSavedBill(db, first.localId, NOW);
    const second = bill([line(1, "1 kilo besan")], { discarded: [{ spokenName: "चिनी", shopProductId: "27", source: "fastpath" }] });
    await finaliseBill(db, second);
    await learnFromSavedBill(db, second.localId, NOW);
    const s = await snapshot();
    expect(s.aliases.find((a) => a.alias === "चिनी")).toMatchObject({ confidence: 0.3 }); // retired, kept so the server learns it too
    expect(s.events.find((e) => e.eventType === "alias_suppressed")!.payload).toMatchObject({ alias: "चिनी", source_layer: "fastpath", retired: true, confidence_before: 0.5, confidence_after: 0.3 });
  });

  it("a learning failure never touches the bill: nothing learned, no marker, the bill intact - and it's learned later", async () => {
    const draft = bill([line(1, "2 kilo चिनी")]);
    await finaliseBill(db, draft);
    const fail = () => {
      throw new Error("simulated disk failure");
    };
    db.learnedAliases.hook("creating", fail);
    await expect(learnFromSavedBill(db, draft.localId, NOW)).rejects.toThrow();
    expect((await snapshot()).events).toHaveLength(0);
    expect(await db.bills.get(draft.localId)).toMatchObject({ status: "final" });
    db.learnedAliases.hook("creating").unsubscribe(fail);
    await markLearningPullDone(db, shopId); // KB-326: the app's entry point waits for the first learning pull
    expect(await learnPendingBills(db, shopId, NOW)).toBe(1);
    expect((await snapshot()).aliases).toHaveLength(1);
  });
});

describe("learnPendingBills - recovery on start", () => {
  it("learns every final bill without a marker, once; drafts never teach (hard rule 8)", async () => {
    const a = bill([line(1, "2 kilo चिनी")]);
    const b = bill([custom(1, "kuch naya", "30")]);
    await finaliseBill(db, a);
    await finaliseBill(db, b);
    await db.bills.add({ ...(await db.bills.get(a.localId))!, localId: crypto.randomUUID(), status: "draft", receiptNumber: "DRAFT" });
    await markLearningPullDone(db, shopId); // KB-326: the app's entry point waits for the first learning pull
    expect(await learnPendingBills(db, shopId, NOW)).toBe(2);
    expect(await learnPendingBills(db, shopId, NOW)).toBe(0);
    const markers = (await db.learningEvents.toArray()).filter((e) => e.eventType === "bill_learned").map((e) => e.billLocalId).sort();
    expect(markers).toEqual([a.localId, b.localId].sort());
  });
});

describe("learnPendingBills - the learning gate (KB-326, D66)", () => {
  it("a phone that has not finished its first learning pull learns NOTHING (a fresh row would overwrite the server's counts); the bill waits, unlearned", async () => {
    const draft = bill([line(1, "2 kilo चिनी")]);
    await finaliseBill(db, draft);
    expect(await isLearningPullDone(db, shopId)).toBe(false);
    expect(await learnPendingBills(db, shopId, NOW)).toBe(0);
    const snap = await snapshot();
    expect(snap.aliases).toHaveLength(0);
    expect(snap.events).toHaveLength(0); // not even a marker: it is learned later, once
  });

  it("once the pull is done, the waiting bill is learned - once", async () => {
    const draft = bill([line(1, "2 kilo चिनी")]);
    await finaliseBill(db, draft);
    await learnPendingBills(db, shopId, NOW);
    await markLearningPullDone(db, shopId);
    expect(await learnPendingBills(db, shopId, NOW)).toBe(1);
    expect(await learnPendingBills(db, shopId, NOW)).toBe(0);
    expect((await snapshot()).aliases).toHaveLength(1);
  });

  it("the gate is per shop: another shop's finished pull does not open this one", async () => {
    await markLearningPullDone(db, "99999999-9999-4999-8999-999999999999");
    expect(await isLearningPullDone(db, shopId)).toBe(false);
  });
});
