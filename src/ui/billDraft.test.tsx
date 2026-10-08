// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { KiranaBillDB } from "@/data/db";
import type { CatalogEntry } from "@/domain/catalog";
import { parseUtterance } from "@/domain/grammar";
import { evaluateReviewFlags } from "@/domain/reviewFlags";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import type { BillLine } from "@/data/voiceBilling";
import { DRAFT_SAVE_DELAY_MS, draftKey, loadDraft, saveDraft } from "./billDraftStore";
import { EMPTY_BILL, useBillLines } from "./useBillLines";

// KB-313 (owner, 8 Oct 2026): "a half-built bill is never lost to a network blink" - or a reload, or Android
// killing the backgrounded tab. REAL parseUtterance() output (D39); the per-user database (D38), one key per shop.

const shopId = "11111111-1111-4111-8111-111111111111";
const catalog: readonly CatalogEntry[] = SEED_PARSER_CATALOG.entries;
let db: KiranaBillDB;

beforeEach(() => {
  db = new KiranaBillDB(`bill-draft-hook-${crypto.randomUUID()}`);
});
afterEach(async () => {
  cleanup();
  db.close();
  await db.delete();
});

function voice(transcript: string): { lines: BillLine[]; flags: ReturnType<typeof evaluateReviewFlags> } {
  const items = parseUtterance(transcript, SEED_PARSER_CATALOG);
  if (!items) throw new Error(`"${transcript}" did not parse`);
  return {
    lines: items.map((item) => ({ item, displayName: (item.catalogId && SEED_PARSER_CATALOG.byId.get(item.catalogId)?.displayName) || item.spokenName, source: "fastpath" as const })),
    flags: evaluateReviewFlags(transcript, items, catalog),
  };
}
const mount = () => renderHook(() => useBillLines(catalog, { db, shopId }));
const stored = () => db.meta.get(draftKey(shopId));
const addVoice = (r: ReturnType<typeof mount>, t: string) => {
  const v = voice(t);
  act(() => r.result.current.add(v.lines, v.flags, t));
};

describe("the half-built bill survives", () => {
  it("it is written shortly after a change, and not before (one write for a burst of edits)", async () => {
    const r = mount();
    await waitFor(() => expect(r.result.current.ready).toBe(true));
    addVoice(r, "2 kilo chini");
    expect(await stored()).toBeUndefined(); // debounced
    await waitFor(async () => expect(await stored()).toBeDefined(), { timeout: DRAFT_SAVE_DELAY_MS * 8 });
  });

  it("a reload brings it back exactly as it was: lines, prices, customer, id and start time", async () => {
    const first = mount();
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    addVoice(first, "2 kilo chini");
    addVoice(first, "teen parle g 10 wala");
    act(() => void first.result.current.setCustomerName("Ramesh"));
    act(() => void first.result.current.setCustomerMobile("98765 43210"));
    const before = first.result.current;
    await waitFor(async () => expect((await loadDraft(db, shopId))?.customer.name).toBe("Ramesh"), { timeout: 2000 });
    first.unmount();

    const second = mount(); // a fresh app start
    await waitFor(() => expect(second.result.current.ready).toBe(true));
    expect(second.result.current.rows).toEqual(before.rows);
    expect(second.result.current.customer).toEqual({ name: "Ramesh", mobile: "9876543210" });
    expect(second.result.current.localId).toBe(before.localId);
    expect(second.result.current.startedAt).toBe(before.startedAt);
    expect(second.result.current.flags.length).toBe(before.flags.length); // flags are re-derived from the lines
  });

  it("closing the page right after a change still saves it (pagehide flushes the debounce)", async () => {
    const r = mount();
    await waitFor(() => expect(r.result.current.ready).toBe(true));
    addVoice(r, "2 kilo chini");
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    // well inside the 250 ms debounce - only the flush can have written it
    await waitFor(async () => expect(await stored()).toBeDefined(), { timeout: DRAFT_SAVE_DELAY_MS * 0.6, interval: 10 });
  });

  it("backgrounding the tab (visibilitychange to hidden) flushes it too", async () => {
    const r = mount();
    await waitFor(() => expect(r.result.current.ready).toBe(true));
    addVoice(r, "2 kilo chini");
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(async () => expect(await stored()).toBeDefined(), { timeout: DRAFT_SAVE_DELAY_MS * 0.6, interval: 10 });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  });

  it("a restored line keeps its price when the catalog's price has since changed (never re-priced - hard rule 7)", async () => {
    const first = mount();
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    addVoice(first, "2 kilo chini");
    const line = first.result.current.rows[0]!;
    first.unmount();
    // the shop raises chini's price meanwhile
    const repriced = catalog.map((c) => (c.id === line.item.catalogId ? { ...c, suggestedPricePaise: c.suggestedPricePaise + 500 } : c));
    await saveDraft(db, shopId, { ...EMPTY_BILL, localId: crypto.randomUUID(), startedAt: new Date().toISOString(), rows: [line], utterances: [{ id: 1, lineIds: [line.id], flags: [], transcript: "2 kilo chini" }], nextId: 2 });
    const second = renderHook(() => useBillLines(repriced, { db, shopId }));
    await waitFor(() => expect(second.result.current.ready).toBe(true));
    expect(second.result.current.rows[0]!.item.rate).toBe(line.item.rate);
    expect(second.result.current.rows[0]!.item.total).toBe(line.item.total);
  });
});

describe("what is NOT restored", () => {
  it("a bill that was finalised meanwhile (a crash right after Bill Banao): the draft is dropped, never re-finalised", async () => {
    const localId = crypto.randomUUID();
    const line = voice("2 kilo chini").lines[0]!;
    await saveDraft(db, shopId, { ...EMPTY_BILL, localId, startedAt: "2026-10-08T10:00:00.000Z", rows: [{ id: "l1", utteranceId: 1, item: line.item, original: line.item, displayName: line.displayName, source: "fastpath" }], utterances: [{ id: 1, lineIds: ["l1"], flags: [], transcript: "x" }], nextId: 2 });
    await db.bills.add({ localId, shopId, status: "final", syncStatus: "pending", receiptNumber: "KB-000001", receiptNumberSource: "block", customerName: "Cash", customerMobile: null, subtotalPaise: 100, totalPaise: 100, schemaVersion: 1, deviceId: "d", createdAt: "2026-10-08T10:00:00.000Z", finalizedAt: "2026-10-08T10:05:00.000Z", syncedAt: null });
    const r = mount();
    await waitFor(() => expect(r.result.current.ready).toBe(true));
    expect(r.result.current.rows).toHaveLength(0);
    expect(r.result.current.localId).not.toBe(localId);
    expect(await stored()).toBeUndefined();
  });

  it("a damaged draft starts an empty bill, never throws, and is removed", async () => {
    await db.meta.put({ key: draftKey(shopId), value: "{broken" });
    const r = mount();
    await waitFor(() => expect(r.result.current.ready).toBe(true));
    expect(r.result.current.rows).toHaveLength(0);
    expect(await stored()).toBeUndefined();
  });

  it("a retry that was in flight comes back as 'not added' with its transcript, not as retrying", async () => {
    await saveDraft(db, shopId, { ...EMPTY_BILL, localId: crypto.randomUUID(), startedAt: "2026-10-08T10:00:00.000Z", notAdded: [{ id: "n1", transcript: "do kilo kuch", retrying: true, message: "Couldn't read the items" }], nextNotAddedId: 2 });
    const r = mount();
    await waitFor(() => expect(r.result.current.ready).toBe(true));
    expect(r.result.current.notAdded).toEqual([{ id: "n1", transcript: "do kilo kuch", retrying: false, message: "Couldn't read the items" }]);
    expect(r.result.current.pending).toBe(1);
  });

  it("someone who starts a bill before the draft has loaded keeps theirs: the late restore changes nothing", async () => {
    const stale = voice("2 kilo chini").lines[0]!;
    await saveDraft(db, shopId, { ...EMPTY_BILL, localId: crypto.randomUUID(), startedAt: "2026-10-08T10:00:00.000Z", rows: [{ id: "l1", utteranceId: 1, item: stale.item, original: stale.item, displayName: stale.displayName, source: "fastpath" }], utterances: [{ id: 1, lineIds: ["l1"], flags: [], transcript: "x" }], nextId: 2 });
    const r = mount();
    addVoice(r, "teen parle g 10 wala"); // before ready
    await waitFor(() => expect(r.result.current.ready).toBe(true));
    expect(r.result.current.rows).toHaveLength(voice("teen parle g 10 wala").lines.length);
    expect(r.result.current.rows[0]!.displayName).not.toBe(stale.displayName);
  });
});

describe("saved and cleared bills leave no draft", () => {
  it("after Bill Banao the draft is removed, and later changes do not bring it back until the next bill", async () => {
    const r = mount();
    await waitFor(() => expect(r.result.current.ready).toBe(true));
    addVoice(r, "2 kilo chini");
    await waitFor(async () => expect(await stored()).toBeDefined(), { timeout: 2000 });
    await act(() => r.result.current.discardDraft());
    expect(await stored()).toBeUndefined();
    act(() => void r.result.current.setCustomerName("Ramesh")); // the saved bill's screen is read-only, but even so
    await new Promise((res) => setTimeout(res, DRAFT_SAVE_DELAY_MS * 3));
    expect(await stored()).toBeUndefined();
    act(() => r.result.current.reset()); // New bill
    addVoice(r, "teen parle g 10 wala");
    await waitFor(async () => expect(await stored()).toBeDefined(), { timeout: 2000 });
  });

  it("Clear bill empties the bill, starts a new one, removes the draft - and teaches nothing (hard rule 8)", async () => {
    const r = mount();
    await waitFor(() => expect(r.result.current.ready).toBe(true));
    addVoice(r, "2 kilo chini");
    await waitFor(async () => expect(await stored()).toBeDefined(), { timeout: 2000 });
    const oldId = r.result.current.localId;
    await act(() => r.result.current.clearBill());
    expect(r.result.current.rows).toHaveLength(0);
    expect(r.result.current.localId).not.toBe(oldId);
    expect(await stored()).toBeUndefined();
    expect(await db.bills.count()).toBe(0);
    expect(await db.learningEvents.count()).toBe(0);
    expect(await db.learnedAliases.count()).toBe(0);
    expect(await db.provisionalProducts.count()).toBe(0);
    expect(await db.priceObservations.count()).toBe(0);
  });

  it("an empty bill keeps no draft at all", async () => {
    const r = mount();
    await waitFor(() => expect(r.result.current.ready).toBe(true));
    await new Promise((res) => setTimeout(res, DRAFT_SAVE_DELAY_MS * 2));
    expect(await stored()).toBeUndefined();
  });
});

describe("without a database (the old call shape)", () => {
  it("works as before and is ready at once", () => {
    const r = renderHook(() => useBillLines(catalog));
    expect(r.result.current.ready).toBe(true);
    expect(r.result.current.rows).toHaveLength(0);
  });
});
