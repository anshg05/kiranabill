// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { receiptText, waLink } from "@/domain/receiptText";
import type { Receipt } from "@/domain/receipt";
import { KiranaBillDB } from "@/data/db";
import { BillView } from "./BillingScreen";
import { useBillLines } from "./useBillLines";
import { useFinalise } from "./useFinalise";
import { useReceiptShare, type RenderReceiptFiles } from "./useReceiptShare";

// KB-309 (owner, 4 Oct 2026): sharing from the saved screen, with a REAL
// finalised bill (D39). The PNG and PDF are rendered when the receipt is shown,
// so a tap shares a ready File (navigator.share needs the tap's activation);
// canShare picks share vs download; a cancelled share sheet does nothing;
// WhatsApp reads the mobile from the STORED bill at tap time; the mobile is
// never in the page.

const shopId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
const MOBILE = "9123456789";
let db: KiranaBillDB;
let renderFiles: ReturnType<typeof vi.fn<RenderReceiptFiles>>;
let share: ReturnType<typeof vi.fn>;
let canShare: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  db = new KiranaBillDB(`ui-share-${crypto.randomUUID()}`);
  await db.shops.put({ id: shopId, syncStatus: "synced", name: "Sharma Kirana", phone: "9876543210", address: null, logoUrl: null, catalogMode: "base_imported", billLanguage: "en", receiptPrefix: "KB", updatedAt: "2026-10-04T00:00:00.000Z" });
  await db.receiptNumberBlocks.put({ id: crypto.randomUUID(), shopId, deviceId, blockStart: 1, blockEnd: 50, nextNumber: 1, allocatedAt: "2026-10-04T00:00:00.000Z", syncStatus: "synced" });
  renderFiles = vi.fn<RenderReceiptFiles>(async () => ({ png: new Blob(["png"], { type: "image/png" }), pdf: new Blob(["pdf"], { type: "application/pdf" }) }));
  share = vi.fn(() => new Promise<void>(() => {})); // the share sheet stays open
  canShare = vi.fn(() => true);
  Object.defineProperty(navigator, "share", { value: share, configurable: true });
  Object.defineProperty(navigator, "canShare", { value: canShare, configurable: true });
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  db.close();
  await db.delete();
});

function Harness({ mobile }: { mobile: string | null }) {
  const bill = useBillLines(SEED_PARSER_CATALOG.entries);
  const fin = useFinalise({ localDb: db, shopId, deviceId });
  const share = useReceiptShare({ localDb: db, saved: fin.saved, render: renderFiles });
  useEffect(() => {
    const items = parseUtterance("2 kilo chini", SEED_PARSER_CATALOG)!;
    bill.add(items.map((item) => ({ item, displayName: SEED_PARSER_CATALOG.byId.get(item.catalogId!)!.displayName, source: "fastpath" as const })), [], "2 kilo chini");
    bill.setCustomerName("Ramesh");
    if (mobile) bill.setCustomerMobile(mobile);
    // once, on mount
  }, []);
  return (
    <BillView
      lines={bill.rows}
      onSignOut={() => {}}
      onEdit={bill.edit}
      onRemove={bill.remove}
      flags={bill.flags}
      pending={bill.pending}
      onAcknowledge={bill.acknowledge}
      notAdded={bill.notAdded}
      onRetry={() => {}}
      onDismiss={bill.dismiss}
      customer={bill.customer}
      onFinalise={() => void fin.finalise(bill.draft)}
      saving={fin.phase === "saving"}
      saved={fin.saved}
      share={share}
      onNewBill={() => {}}
    />
  );
}

async function saveBill(mobile: string | null = MOBILE) {
  render(<Harness mobile={mobile} />);
  await act(async () => {
    screen.getByRole("button", { name: "Bill Banao" }).click();
  });
  await waitFor(() => screen.getByRole("article", { name: "Receipt" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Share image" }).getAttribute("aria-disabled")).toBe("false"));
}

describe("KB-309 - share from the saved screen", () => {
  it("the PNG and PDF are rendered once, when the receipt is shown - from the stored receipt", async () => {
    await saveBill();
    expect(renderFiles).toHaveBeenCalledTimes(1);
    expect((renderFiles.mock.calls[0]![0] as Receipt).receiptNumber).toBe("KB-000001");
    for (const name of ["Share image", "PDF", "WhatsApp"]) expect(screen.getByRole("button", { name })).toBeTruthy();
  });

  it("Share image: navigator.share is called IN the tap with a ready PNG File - no rendering awaited", async () => {
    await saveBill();
    fireEvent.click(screen.getByRole("button", { name: "Share image" }));
    // Synchronously, before any await: the call that needs the tap's activation.
    expect(share).toHaveBeenCalledTimes(1);
    const file = (share.mock.calls[0]![0] as { files: File[] }).files[0]!;
    expect([file.name, file.type]).toEqual(["KB-000001.png", "image/png"]);
    expect(renderFiles).toHaveBeenCalledTimes(1); // not re-rendered on tap
  });

  it("PDF: shares the PDF File the same way", async () => {
    await saveBill();
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    const file = (share.mock.calls[0]![0] as { files: File[] }).files[0]!;
    expect([file.name, file.type]).toEqual(["KB-000001.pdf", "application/pdf"]);
  });

  it("canShare false (most desktops): the file downloads instead; no share call", async () => {
    canShare.mockReturnValue(false);
    URL.createObjectURL = vi.fn(() => "blob:receipt");
    URL.revokeObjectURL = vi.fn();
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });
    await saveBill();
    fireEvent.click(screen.getByRole("button", { name: "Share image" }));
    expect(share).not.toHaveBeenCalled();
    expect(clicked.map((a) => [a.download, a.href])).toEqual([["KB-000001.png", "blob:receipt"]]);
  });

  it("a cancelled share sheet (AbortError) does nothing - no download, no message, no warning", async () => {
    share.mockImplementation(() => Promise.reject(new DOMException("cancelled", "AbortError"))); // created at the call, as a real share sheet does
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await saveBill();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share image" }));
    });
    expect(anchorClick).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("WhatsApp: wa.me with the mobile read from the STORED bill at tap time (not the draft); the receipt text", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    await saveBill();
    // Prove the source: change the stored bill's mobile after saving.
    const stored = (await db.bills.toCollection().first())!;
    await db.bills.update(stored.localId, { customerMobile: "9988776655" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "WhatsApp" }));
    });
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    const receipt = renderFiles.mock.calls[0]![0] as Receipt;
    expect(open.mock.calls[0]).toEqual([waLink(receiptText(receipt), "9988776655"), "_blank", "noopener"]);
  });

  it("WhatsApp with no mobile on the bill: wa.me without a number", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    await saveBill(null);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "WhatsApp" }));
    });
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(String(open.mock.calls[0]![0])).toMatch(/^https:\/\/wa\.me\/\?text=/);
  });

  it("the mobile appears nowhere in the page - before and after the share taps", async () => {
    vi.spyOn(window, "open").mockImplementation(() => null);
    await saveBill();
    const forms = [MOBILE, "91234 56789", "919123456789"];
    for (const f of forms) expect(document.documentElement.outerHTML).not.toContain(f);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "WhatsApp" }));
      fireEvent.click(screen.getByRole("button", { name: "Share image" }));
    });
    for (const f of forms) expect(document.documentElement.outerHTML).not.toContain(f);
  });
});
