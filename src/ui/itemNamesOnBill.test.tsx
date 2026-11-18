// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, renderHook, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { useEffect, type MutableRefObject } from "react";
import { KiranaBillDB } from "@/data/db";
import { finaliseBill } from "@/data/finalise";
import { loadReceipt } from "@/data/receipt";
import type { VoiceJobOutcome } from "@/data/voiceJob";
import { render as say } from "@/domain/messages";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { BillView } from "./BillingScreen";
import { useBillLines, type BillLines } from "./useBillLines";
import { useVoiceOrders, type AppendedOrder } from "./useVoiceOrders";

// KB-414 step 4 review (owner + reviewer, 18 Nov 2026): Bill design's "Item names on bill" row says "Voice orders print the name you
// said. Items you add by hand print the name from your items." This pins that sentence to what the app really does, through the
// real paths: a voice order (useVoiceOrders - D102, the V3 path) and Add item (BillView's panel), then the real save (finaliseBill)
// and the real receipt (loadReceipt). If either path changes, this fails - and the row's words must change with it.

const shopId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
let db: KiranaBillDB | null = null;
afterEach(async () => {
  cleanup();
  db?.close();
  await db?.delete();
  db = null;
  await new Promise((r) => setTimeout(r, 30));
});

function Harness({ api, voiceOrder }: { api: MutableRefObject<BillLines | null>; voiceOrder: AppendedOrder }) {
  const bill = useBillLines(SEED_PARSER_CATALOG.entries);
  useEffect(() => {
    bill.add(voiceOrder.lines, voiceOrder.flags, voiceOrder.transcript);
    // once, on mount
  }, []);
  api.current = bill;
  return <BillView lines={bill.rows} onEdit={bill.edit} onRemove={bill.remove} flags={bill.flags} pending={bill.pending} onAcknowledge={bill.acknowledge} catalog={SEED_PARSER_CATALOG} onAddByHand={bill.addByHand} focusLineId={bill.focusLineId} />;
}

describe("Item names on bill - the row's explanation is the real behaviour", () => {
  it("the row's words", () => {
    expect(say("more.namesAsSaid", {}, "en")).toBe("As you said them");
    expect(say("more.namesHelp", {}, "en")).toBe("Voice orders print the name you said. Items you add by hand print the name from your items.");
  });

  it("a voice line keeps the name said on the saved receipt; an item added by hand shows its name from the items", async () => {
    db = new KiranaBillDB(`ui-names-${crypto.randomUUID()}`);
    await db.shops.put({ id: shopId, syncStatus: "synced", name: "Gupta Kirana Store", phone: null, address: null, logoUrl: null, catalogMode: "base_imported", billLanguage: "en", receiptPrefix: "KB", updatedAt: "2026-11-18T10:00:00.000Z" });
    // the said name differs from the catalog's: चीनी is "Chini" in the items
    expect(SEED_PARSER_CATALOG.entries.find((e) => e.aliases.includes("चीनी"))?.displayName).toBe("Chini");

    // 1. a voice order through the real V3 path
    const appended: AppendedOrder[] = [];
    const done = (recordingId: string): VoiceJobOutcome => ({
      kind: "done",
      recordingId,
      transcript: "2 किलो चीनी",
      items: [{ spokenName: "चीनी", catalogId: null, isCustom: true, matchStatus: "none", qty: 2, unit: "kg", rate: null, rateUnit: null, total: null, priceType: "default" }],
    });
    const voiceDb = db;
    const hook = renderHook(() => useVoiceOrders({ db: voiceDb, shopId, billLocalId: "bill-v", parser: SEED_PARSER_CATALOG, submit: async (id) => done(id), onAppend: (o) => appended.push(o) }));
    await act(() => hook.result.current.generate(new Blob([new Uint8Array([1])], { type: "audio/webm" }), 3_000));
    await waitFor(() => expect(appended).toHaveLength(1));
    hook.unmount();

    // 2. the same product added by hand through Add item
    const api: MutableRefObject<BillLines | null> = { current: null };
    render(<Harness api={api} voiceOrder={appended[0]!} />);
    act(() => screen.getByRole("button", { name: "Add item" }).click());
    const panel = screen.getByRole("region", { name: "Add item" });
    fireEvent.change(within(panel).getByRole("searchbox", { name: "Search products" }), { target: { value: "चीनी" } });
    act(() => within(panel).getAllByRole("button", { name: /^Chini/ })[0]!.click());
    expect(api.current!.rows.map((r) => [r.displayName, r.source])).toEqual([["चीनी", "voice"], ["Chini", "manual"]]);

    // 3. saved, and the receipt read back from the phone
    const draft = api.current!.draft;
    await finaliseBill(db, { ...draft, shopId, deviceId, now: new Date("2026-11-18T10:05:00.000Z") });
    const receipt = await loadReceipt(db, draft.localId);
    expect(receipt!.rows.map((r) => r.name)).toEqual(["चीनी", "Chini"]);
  });
});
