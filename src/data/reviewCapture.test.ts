import "fake-indexeddb/auto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { KiranaBillDB } from "./db";
import { pushBillMetrics, recordFinalised } from "./billMetrics";
import { REVIEW_RETENTION_DAYS, captureUtterance, clearReviewCapture, clearThenSignOut, isReviewCaptureOn, listReviewCapture, purgeReviewCapture, setReviewCapture } from "./reviewCapture";

// KB-404 (D80), S2 - Option A (owner, 16 Oct 2026): the review capture is DEVICE-ONLY, OFF by default, purged after 30 days
// and on sign-out; it is never pushed, never in the backup, never in an export. A transcript can contain a customer's
// spoken name or number - that is why it never leaves the shop's own phone.

const shopId = "11111111-1111-4111-8111-111111111111";
const DAY = 86_400_000;
const NOW = Date.parse("2026-10-16T10:00:00.000Z");
let db: KiranaBillDB;
beforeEach(() => {
  db = new KiranaBillDB(`review-${crypto.randomUUID()}`);
});
afterEach(async () => {
  vi.restoreAllMocks();
  db.close();
  await db.delete();
});

const pair = (transcript = "do kilo chini") => ({ billLocalId: "bill-1", transcript, path: "fastpath" as const, lines: [{ name: "Chini", qty: 2, unit: "kg", rate: 4500, total: 9000 }] });

describe("off by default", () => {
  it("nothing is captured until it is switched on", async () => {
    expect(await isReviewCaptureOn(db, shopId)).toBe(false);
    await captureUtterance(db, shopId, pair());
    expect(await db.reviewCapture.count()).toBe(0);
  });
  it("on: the heard words and the billed lines are kept, newest first", async () => {
    await setReviewCapture(db, shopId, true);
    await captureUtterance(db, shopId, pair("do kilo chini"), NOW);
    await captureUtterance(db, shopId, pair("ek kilo besan"), NOW + 1000);
    expect((await listReviewCapture(db, shopId)).map((r) => r.transcript)).toEqual(["ek kilo besan", "do kilo chini"]);
    expect((await listReviewCapture(db, shopId))[1]).toMatchObject({ billLocalId: "bill-1", path: "fastpath", lines: [{ name: "Chini", qty: 2, unit: "kg", rate: 4500, total: 9000 }] });
  });
  it("switching it off stops capturing but keeps what was captured (until Clear now / 30 days / sign-out)", async () => {
    await setReviewCapture(db, shopId, true);
    await captureUtterance(db, shopId, pair());
    await setReviewCapture(db, shopId, false);
    await captureUtterance(db, shopId, pair("another"));
    expect(await db.reviewCapture.count()).toBe(1);
  });
  it("per shop: the switch of one shop never captures for another", async () => {
    await setReviewCapture(db, shopId, true);
    await captureUtterance(db, "99999999-9999-4999-8999-999999999999", pair());
    expect(await db.reviewCapture.count()).toBe(0);
  });
});

describe("retention: 30 days, Clear now, sign-out", () => {
  beforeEach(async () => {
    await setReviewCapture(db, shopId, true);
  });
  it("purge removes only what is older than 30 days", async () => {
    expect(REVIEW_RETENTION_DAYS).toBe(30);
    await captureUtterance(db, shopId, pair("old"), NOW - 31 * DAY);
    await captureUtterance(db, shopId, pair("edge"), NOW - 29 * DAY);
    await captureUtterance(db, shopId, pair("new"), NOW);
    expect(await purgeReviewCapture(db, NOW)).toBe(1);
    expect((await listReviewCapture(db, shopId)).map((r) => r.transcript).sort()).toEqual(["edge", "new"]);
  });
  it("Clear now (and sign-out) removes every pair of this shop - and only this shop's", async () => {
    await captureUtterance(db, shopId, pair("mine"), NOW);
    await db.reviewCapture.add({ ...pair("theirs"), shopId: "99999999-9999-4999-8999-999999999999", capturedAt: new Date(NOW).toISOString() });
    expect(await clearReviewCapture(db, shopId)).toBe(1);
    expect(await db.reviewCapture.count()).toBe(1);
  });
});

describe("sign-out", () => {
  it("clears this shop's pairs, then signs out - and signs out even if the clear fails", async () => {
    await setReviewCapture(db, shopId, true);
    await captureUtterance(db, shopId, pair());
    const signOut = vi.fn();
    await clearThenSignOut(db, shopId, signOut);
    expect(await db.reviewCapture.count()).toBe(0);
    expect(signOut).toHaveBeenCalledTimes(1);
    vi.spyOn(db.reviewCapture, "where").mockImplementation(() => { throw new Error("x"); });
    await expect(clearThenSignOut(db, shopId, signOut)).resolves.toBeUndefined();
    expect(signOut).toHaveBeenCalledTimes(2);
  });
});

describe("a capture failure never reaches the bill", () => {
  it("a failing write is swallowed", async () => {
    await setReviewCapture(db, shopId, true);
    vi.spyOn(db.reviewCapture, "add").mockRejectedValue(new Error("quota"));
    await expect(captureUtterance(db, shopId, pair())).resolves.toBeUndefined();
  });
});

describe("it never leaves the phone", () => {
  it("no sync code touches the table, and the metrics push has no text in it", async () => {
    const dir = join(__dirname);
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".e2e.test.ts"));
    const touching = files.filter((f) => /reviewCapture/.test(readFileSync(join(dir, f), "utf8")));
    expect(touching.sort()).toEqual(["db.ts", "reviewCapture.ts"]); // the type + store and the module itself - nothing in sync.ts or billMetrics.ts
  });

  it("the row pushed to the server carries numbers and enums only - no transcript, no name, no item", async () => {
    await setReviewCapture(db, shopId, true);
    await captureUtterance(db, shopId, pair("Ramesh ka do kilo chini"), NOW);
    const billId = crypto.randomUUID();
    await db.bills.add({
      localId: billId, serverId: crypto.randomUUID(), shopId, status: "final", syncStatus: "synced", receiptNumber: "KB-000001", receiptNumberSource: "block", customerName: "Ramesh",
      customerMobile: "9876543210", subtotalPaise: 9000, totalPaise: 9000, schemaVersion: 1, deviceId: "dev", createdAt: new Date(NOW).toISOString(), finalizedAt: new Date(NOW).toISOString(), syncedAt: null,
    });
    await db.billItems.add({ billLocalId: billId, shopId, lineNo: 1, shopProductId: null, displayName: "Chini", spokenName: "chini", qty: 2, unit: "kg", ratePaise: 4500, rateUnit: "kg", totalPaise: 9000, priceType: "rate", source: "fastpath", reviewFlags: [], wasEdited: false });
    await recordFinalised(db, shopId, {
      billLocalId: billId, deviceId: "dev", turns: 1, secondsToBill: 9, utterances: [{ path: "fastpath", stopToTranscriptMs: 900, transcriptToItemsMs: 100 }], finaliseToReceiptMs: 150,
      snapshot: { voiceLines: 1, editedLines: 0, manualLines: 0, removedLines: 0, notAdded: 0, flagsRaised: 0, flagsAcknowledged: 0 },
    });
    const sent: Record<string, unknown>[] = [];
    const client = { from: () => ({ insert: async (row: Record<string, unknown>) => (sent.push(row), { error: null }) }) } as unknown as SupabaseClient;
    await pushBillMetrics(client, db);
    expect(sent).toHaveLength(1);
    const text = JSON.stringify(sent[0]);
    for (const secret of ["Ramesh", "9876543210", "Chini", "chini", "do kilo", "transcript\""]) expect(text).not.toContain(secret);
    expect(Object.keys(sent[0]!).sort()).toEqual([
      "bill_id", "bill_local_id", "device_id", "edited_lines", "finalise_to_receipt_ms", "flags_acknowledged", "flags_raised", "line_count", "local_id", "manual_lines", "not_added", "number_ms",
      "receipt_number", "recorded_at", "removed_lines", "seconds_to_bill", "shop_id", "total_paise", "turns", "utterances", "voice_lines",
    ]);
  });
});
