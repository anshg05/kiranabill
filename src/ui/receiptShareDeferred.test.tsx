// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import type { FinalLine } from "@/domain/finalBill";
import { KiranaBillDB } from "@/data/db";
import { finaliseBill } from "@/data/finalise";
import { loadReceipt } from "@/data/receipt";
import { useReceiptShare, type RenderReceiptFiles } from "./useReceiptShare";
import type { SavedBill } from "./useFinalise";

// KB-352: the receipt's PNG and PDF (fonts, canvas, a PDF) are the heaviest thing that starts when the receipt appears. They are made in
// idle time AFTER the receipt has painted - the share buttons say "Preparing the receipt…" until then - so they can never hold up the paint.

const shopId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
let db: KiranaBillDB;
beforeEach(async () => {
  db = new KiranaBillDB(`share-def-${crypto.randomUUID()}`);
  await db.shops.put({ id: shopId, syncStatus: "synced", name: "S", phone: null, address: null, logoUrl: null, catalogMode: "base_imported", billLanguage: "en", receiptPrefix: null, updatedAt: "2026-10-28T00:00:00.000Z" });
});
afterEach(async () => {
  cleanup();
  db.close();
  await db.delete();
});

async function savedBill(): Promise<SavedBill> {
  const items = parseUtterance("2 kilo chini", SEED_PARSER_CATALOG)!;
  const lines: FinalLine[] = items.map((item, i) => ({ id: `l${i}`, utteranceId: 1, item, original: item, displayName: "Chini", source: "fastpath" }));
  const localId = crypto.randomUUID();
  const r = await finaliseBill(db, { localId, shopId, deviceId, startedAt: new Date().toISOString(), customer: { name: "Cash", mobile: null }, lines, flags: [], serverNumber: "1" });
  return { localId, receiptNumber: r.receiptNumber, receipt: await loadReceipt(db, localId) };
}

describe("useReceiptShare - the files are made after the paint", () => {
  it("render is not called while the receipt is first being shown, only afterwards, once", async () => {
    const saved = await savedBill();
    const render = vi.fn<RenderReceiptFiles>(async () => ({ png: new Blob(["p"]), pdf: new Blob(["d"]) }));
    const { result } = renderHook(() => useReceiptShare({ localDb: db, saved, render }));
    expect(render).not.toHaveBeenCalled();
    expect(result.current?.ready).toBe(false);
    await waitFor(() => expect(render).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current?.ready).toBe(true));
  });

  it("a receipt that is left (New bill) before the idle moment is never rendered", async () => {
    const saved = await savedBill();
    const render = vi.fn<RenderReceiptFiles>(async () => ({ png: new Blob(["p"]), pdf: new Blob(["d"]) }));
    const { unmount } = renderHook(() => useReceiptShare({ localDb: db, saved, render }));
    unmount();
    await new Promise((r) => setTimeout(r, 400));
    expect(render).not.toHaveBeenCalled();
  });
});
