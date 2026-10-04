// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { receiptText, smsText, waLink } from "@/domain/receiptText";
import type { Receipt } from "@/domain/receipt";
import { KiranaBillDB } from "@/data/db";
import { BillView } from "./BillingScreen";
import { useBillLines } from "./useBillLines";
import { useFinalise } from "./useFinalise";
import { useReceiptShare, type RenderReceiptFiles } from "./useReceiptShare";

// KB-309 commit 3 (owner, 4 Oct 2026 - the legacy behaviour, D58): four buttons
// under the saved receipt, with a REAL finalised bill (D39). Image and PDF always
// DOWNLOAD. WhatsApp shares the PNG through the share sheet when files can be
// shared (inside the tap - the files are rendered when the receipt is shown),
// otherwise opens wa.me with the text and the STORED bill's mobile. SMS opens a
// sheet pre-filled from the STORED bill; Send only for a valid D52 number. The
// mobile is never in the page (only as the SMS field's value while it's open).

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
  await waitFor(() => expect(screen.getByRole("button", { name: "Image" }).getAttribute("aria-disabled")).toBe("false"));
}

/** Anchor clicks (downloads, sms:) - captured, never navigated. */
function captureAnchors() {
  URL.createObjectURL = vi.fn(() => "blob:receipt");
  URL.revokeObjectURL = vi.fn();
  const clicked: HTMLAnchorElement[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push(this);
  });
  return clicked;
}

const button = (name: string) => screen.getByRole("button", { name });
const field = () => screen.getByRole("textbox", { name: "Mobile for SMS" }) as HTMLInputElement;

async function openSms() {
  await act(async () => {
    fireEvent.click(button("SMS"));
  });
  await waitFor(() => expect(field()).toBeTruthy());
}

describe("KB-309 - four buttons on the saved screen (D58, the legacy behaviour)", () => {
  it("Image, PDF, WhatsApp, SMS; the PNG and PDF rendered once, when the receipt is shown", async () => {
    await saveBill();
    expect(renderFiles).toHaveBeenCalledTimes(1);
    expect((renderFiles.mock.calls[0]![0] as Receipt).receiptNumber).toBe("KB-000001");
    for (const name of ["Image", "PDF", "WhatsApp", "SMS"]) expect(button(name)).toBeTruthy();
  });

  it("Image always DOWNLOADS the PNG - no share sheet, even where files can be shared", async () => {
    const clicked = captureAnchors();
    await saveBill();
    fireEvent.click(button("Image"));
    expect(share).not.toHaveBeenCalled();
    expect(clicked.map((a) => [a.download, a.href])).toEqual([["KB-000001.png", "blob:receipt"]]);
  });

  it("PDF always DOWNLOADS the PDF - no share sheet", async () => {
    const clicked = captureAnchors();
    await saveBill();
    fireEvent.click(button("PDF"));
    expect(share).not.toHaveBeenCalled();
    expect(clicked.map((a) => a.download)).toEqual(["KB-000001.pdf"]);
  });
});

describe("KB-309 - WhatsApp sends the image", () => {
  it("canShare: navigator.share is called IN the tap with the ready PNG - nothing awaited, not re-rendered", async () => {
    await saveBill();
    fireEvent.click(button("WhatsApp"));
    expect(share).toHaveBeenCalledTimes(1); // synchronously, before any await
    const file = (share.mock.calls[0]![0] as { files: File[] }).files[0]!;
    expect([file.name, file.type]).toEqual(["KB-000001.png", "image/png"]);
    expect(renderFiles).toHaveBeenCalledTimes(1);
  });

  it("a cancelled share sheet (AbortError) does nothing - no wa.me, no download, no message, no warning", async () => {
    share.mockImplementation(() => Promise.reject(new DOMException("cancelled", "AbortError"))); // created at the call, as a real share sheet does
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const clicked = captureAnchors();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await saveBill();
    await act(async () => {
      fireEvent.click(button("WhatsApp"));
    });
    expect([open.mock.calls.length, clicked.length, warn.mock.calls.length]).toEqual([0, 0, 0]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("no file sharing: wa.me with the text and the mobile read from the STORED bill at tap time", async () => {
    canShare.mockReturnValue(false);
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    await saveBill();
    const stored = (await db.bills.toCollection().first())!;
    await db.bills.update(stored.localId, { customerMobile: "9988776655" }); // prove the source
    await act(async () => {
      fireEvent.click(button("WhatsApp"));
    });
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    const receipt = renderFiles.mock.calls[0]![0] as Receipt;
    expect(open.mock.calls[0]).toEqual([waLink(receiptText(receipt), "9988776655"), "_blank", "noopener"]);
    expect(share).not.toHaveBeenCalled();
  });

  it("no file sharing and no mobile on the bill: wa.me without a number", async () => {
    canShare.mockReturnValue(false);
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    await saveBill(null);
    await act(async () => {
      fireEvent.click(button("WhatsApp"));
    });
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(String(open.mock.calls[0]![0])).toMatch(/^https:\/\/wa\.me\/\?text=/);
  });
});

describe("KB-309 - SMS", () => {
  it("the field is pre-filled from the STORED bill's mobile when the sheet opens; the preview is the SMS text", async () => {
    await saveBill();
    const stored = (await db.bills.toCollection().first())!;
    await db.bills.update(stored.localId, { customerMobile: "9988776655" }); // read when the sheet opens, not before
    await openSms();
    await waitFor(() => expect(field().value).toBe("9988776655"));
    const receipt = renderFiles.mock.calls[0]![0] as Receipt;
    expect(screen.getByTestId("sms-preview").textContent).toBe(smsText(receipt));
    expect(button("Send").getAttribute("aria-disabled")).toBe("false");
  });

  it("no mobile on the bill: the field starts empty and Send is disabled", async () => {
    await saveBill(null);
    await openSms();
    expect(field().value).toBe("");
    expect(button("Send").getAttribute("aria-disabled")).toBe("true");
  });

  it("an invalid number: Send stays disabled, the D52 message shows, a tap sends nothing", async () => {
    const clicked = captureAnchors();
    await saveBill(null);
    await openSms();
    for (const bad of ["12345", "1234567890", "+44 7911 123456"]) {
      fireEvent.change(field(), { target: { value: bad } });
      expect(button("Send").getAttribute("aria-disabled"), bad).toBe("true");
      fireEvent.click(button("Send"));
    }
    expect(screen.getByRole("alert").textContent).toBe("Only Indian mobile numbers (+91)");
    expect(clicked).toHaveLength(0);
  });

  it("a typed number is normalised (D52) and Send opens sms:<10 digits>?body=; the bill is never changed", async () => {
    const clicked = captureAnchors();
    await saveBill(null);
    await openSms();
    fireEvent.change(field(), { target: { value: "+91 98765-43210" } });
    expect(button("Send").getAttribute("aria-disabled")).toBe("false");
    fireEvent.click(button("Send"));
    const receipt = renderFiles.mock.calls[0]![0] as Receipt;
    expect(clicked.map((a) => a.href)).toEqual([`sms:9876543210?body=${encodeURIComponent(smsText(receipt))}`]);
    expect((await db.bills.toCollection().first())!.customerMobile).toBeNull(); // never stored
  });
});

describe("KB-309 - the mobile in the page", () => {
  const forms = [MOBILE, "91234 56789", "919123456789"];

  it("nowhere with the SMS sheet closed - before and after the WhatsApp tap", async () => {
    canShare.mockReturnValue(false);
    vi.spyOn(window, "open").mockImplementation(() => null);
    await saveBill();
    for (const f of forms) expect(document.documentElement.outerHTML).not.toContain(f);
    await act(async () => {
      fireEvent.click(button("WhatsApp"));
    });
    for (const f of forms) expect(document.documentElement.outerHTML).not.toContain(f);
  });

  it("with the SMS sheet open: only as the field's value", async () => {
    await saveBill();
    await openSms();
    await waitFor(() => expect(field().value).toBe(MOBILE));
    const page = document.documentElement.cloneNode(true) as HTMLElement;
    page.querySelector('input[aria-label="Mobile for SMS"]')!.removeAttribute("value");
    for (const f of forms) expect(page.outerHTML).not.toContain(f);
  });
});
