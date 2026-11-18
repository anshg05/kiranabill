// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { render as say } from "@/domain/messages";
import { layoutReceipt, printStyle, SCREEN_STYLE, type Measure } from "@/domain/receiptLayout";
import { DEV_PRINT_BILLS } from "./devPrintBills";
import { BillView } from "./BillingScreen";
import { Receipt } from "./Receipt";
import { paintReceipt, SHARE_PALETTE } from "./receiptImage";
import { PRINT_PALETTE } from "./receiptPrint";
import type { ReceiptShare } from "./useReceiptShare";
import { setScreenLanguage } from "./screenLanguage";

// KB-413 step 4 (owner, 16 Nov 2026): 13 Bill saved - the tick pop, "Bill 515 saved", "3 items · Cash · 1:18 pm", the receipt printing
// out (1.2 s; reduced motion: shown at once) in design 13's receipt look with its torn edge, Print bill (today's PrintButton, REPRINT
// rules unchanged), four tiles WhatsApp / PDF / Share / SMS (nothing removed: Share = the phone's share sheet with the bill image, or
// today's image download where the phone cannot share files), "Start a new bill". Owner's answers: NO top bar (Back = Start a new
// bill), NO Add item on 13, no torn edge on the share image. The PRINTED bill is unchanged (the 12 /__dev/print previews prove it).

const env = vi.hoisted(() => ({ native: true, print: vi.fn(async (_r: unknown) => true) }));
vi.mock("@/data/nativeSignIn", () => ({ isNativeApp: () => env.native }));
vi.mock("./usePrint", () => ({
  PRINT_FAILURE_TEXT: {},
  usePrint: () => ({ state: { kind: "idle" }, print: env.print }),
}));

beforeEach(() => {
  env.native = true;
  env.print.mockClear();
});
afterEach(() => {
  cleanup();
  act(() => setScreenLanguage("en"));
  delete document.documentElement.dataset.motion;
});

const receipt = DEV_PRINT_BILLS.three; // Bill 515: चीनी, चावल (rate —), टाटा नमक - 11-11-2026 | 1:18 PM
const shareOf = (over: Partial<ReceiptShare> = {}): ReceiptShare => ({
  ready: true, smsText: "Bill 515", downloadImage: vi.fn(), downloadPdf: vi.fn(), whatsApp: vi.fn(), shareImage: vi.fn(), storedMobile: async () => null, sendSms: vi.fn(), ...over,
});
function saved(over: { share?: ReceiptShare; onNewBill?: () => void; cancelled?: boolean } = {}) {
  const r = over.cancelled ? { ...receipt, cancelled: "CANCELLED" } : receipt;
  return render(
    <BillView lines={[]} onEdit={() => null} onRemove={() => {}} onNewBill={over.onNewBill ?? (() => {})}
      saved={{ localId: "b515", receiptNumber: "515", receipt: r } as never} share={over.share ?? shareOf()} />,
  );
}
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const cls = (el: Element | null) => el?.getAttribute("class") ?? "";

describe("13 Bill saved, as drawn", () => {
  it("the tick pops; 'Bill 515 saved'; '3 items · Cash · 1:18 pm' (the receipt's own time)", () => {
    saved();
    const tick = document.querySelector("[data-saved-tick]")!;
    expect(cls(tick)).toContain("animate-kb-pop");
    expect(cls(tick)).toContain("bg-kb-ok");
    const status = screen.getByRole("status", { name: "Bill saved" });
    expect(status.textContent).toContain("Bill 515 saved");
    expect(screen.getByText("3 items · Cash · 1:18 pm")).toBeTruthy();
  });

  it("owner's answer: NO top bar - no title bar, no ≡ menu, no sync chip, no total panel, no Bill Banao", () => {
    saved();
    expect(screen.queryByRole("button", { name: "Menu" })).toBeNull();
    expect(screen.queryByRole("heading", { level: 1, name: "Bill saved" })).toBeNull();
    expect(screen.queryByTestId("bill-total")).toBeNull();
    expect(screen.queryByRole("button", { name: /Bill Banao/ })).toBeNull();
  });

  it("the receipt prints out in 1.2 s on its torn paper (13's frame); the receipt keeps today's content", () => {
    saved();
    const paper = screen.getByRole("article", { name: "Receipt" }).closest("[data-receipt-print]")!;
    expect(cls(paper)).toContain("animate-kb-print-saved");
    expect(paper.querySelector("svg[viewBox='0 0 280 10']")).toBeTruthy(); // the torn edge
    const r = within(screen.getByRole("article", { name: "Receipt" }));
    for (const s of ["GUPTA KIRANA STORE", "11-11-2026 | 1:18 PM", "चीनी", "₹90", "चावल", "—", "टाटा नमक", "TOTAL", "₹460", "Thank You!"]) expect(r.getAllByText(s, { exact: false }).length).toBeGreaterThan(0);
  });

  it("a long bill is never cut: once the print has run (the file's 0 -> 520 px), the 520 px cap is gone", () => {
    saved();
    const paper = screen.getByRole("article", { name: "Receipt" }).closest("[data-receipt-print]") as HTMLElement;
    // jsdom has no AnimationEvent, so React may listen under the prefixed name - send both, as a browser sends one
    act(() => {
      paper.dispatchEvent(new Event("animationend", { bubbles: true }));
      paper.dispatchEvent(new Event("webkitAnimationEnd", { bubbles: true }));
    });
    expect(cls(paper)).not.toContain("animate-kb-print-saved");
    expect(screen.getByRole("article", { name: "Receipt" })).toBeTruthy();
  });

  it("reduced motion: the stylesheet stops every kb- animation - the receipt is simply there, everything works", () => {
    document.documentElement.dataset.motion = "reduce";
    const onNewBill = vi.fn();
    saved({ onNewBill });
    expect(screen.getByRole("article", { name: "Receipt" })).toBeTruthy();
    fireEvent.click(button("Start a new bill"));
    expect(onNewBill).toHaveBeenCalledOnce();
  });

  it("the actions in the drawn order: Print bill (primary), WhatsApp, PDF, Share, SMS, Start a new bill; no Add item (owner)", () => {
    saved();
    const names = screen.getAllByRole("button").map((b) => b.textContent?.trim());
    expect(names).toEqual(["Print bill", "WhatsApp", "PDF", "Share", "SMS", "Start a new bill"]);
    expect(cls(button("Print bill"))).toContain("bg-kb-primary");
    expect(cls(button("WhatsApp"))).toContain("text-kb-ok");
    for (const n of ["WhatsApp", "PDF", "Share", "SMS"]) expect(button(n).querySelector("svg")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Add item/ })).toBeNull();
  });

  it("each tile does today's thing: WhatsApp, PDF download, Share = the share sheet with the image, SMS opens its sheet", () => {
    const share = shareOf();
    saved({ share });
    fireEvent.click(button("WhatsApp"));
    fireEvent.click(button("PDF"));
    fireEvent.click(button("Share"));
    expect([share.whatsApp, share.downloadPdf, share.shareImage].map((f) => (f as ReturnType<typeof vi.fn>).mock.calls.length)).toEqual([1, 1, 1]);
    fireEvent.click(button("SMS"));
    expect(screen.getByRole("region", { name: "Send SMS" })).toBeTruthy();
  });

  it("until the image and PDF are ready the three file tiles say so and do nothing; SMS works", () => {
    const share = shareOf({ ready: false });
    saved({ share });
    for (const n of ["WhatsApp", "PDF", "Share"]) expect(button(n).getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(button("Share"));
    expect(share.shareImage).not.toHaveBeenCalled();
    expect(screen.getByText("Preparing the receipt…")).toBeTruthy();
  });

  it("Print bill is today's PrintButton: the first copy is the original, every later copy says REPRINT", async () => {
    saved();
    await act(async () => void fireEvent.click(button("Print bill")));
    await act(async () => void fireEvent.click(button("Print bill")));
    expect(env.print.mock.calls.map((c) => (c[0] as { reprint?: string }).reprint ?? null)).toEqual([null, "REPRINT"]);
  });

  it("outside the Android app there is no Print bill (as today); the tiles stay", () => {
    env.native = false;
    saved();
    expect(screen.queryByRole("button", { name: "Print bill" })).toBeNull();
    expect(button("Share")).toBeTruthy();
  });

  it("Start a new bill starts the next bill", () => {
    const onNewBill = vi.fn();
    saved({ onNewBill });
    fireEvent.click(button("Start a new bill"));
    expect(onNewBill).toHaveBeenCalledOnce();
  });

  it("the phone's Back on 13 starts the next bill too (owner's answer) - it never leaves the app", async () => {
    const onNewBill = vi.fn();
    saved({ onNewBill });
    expect(typeof window.history.state?.kbSaved).toBe("string");
    act(() => window.history.back());
    await waitFor(() => expect(onNewBill).toHaveBeenCalledOnce());
  });

  it("in Hindi: the title, the line under it, the tiles and Start a new bill", () => {
    act(() => setScreenLanguage("hi"));
    saved();
    expect(screen.getByRole("status", { name: say("bill.savedLabel", {}, "hi") }).textContent).toContain(`${say("bill.savedBefore", {}, "hi")} 515 ${say("bill.savedAfter", {}, "hi")}`);
    expect(screen.getByText(say("saved.subMany", { n: 3, customer: "Cash", time: "1:18 pm" }, "hi"))).toBeTruthy();
    for (const key of ["saved.startNew", "share.share", "print.bill"] as const) expect(say(key, {}, "hi")).not.toBe(say(key, {}, "en"));
    expect(button(say("saved.startNew", {}, "hi"))).toBeTruthy();
  });

  it("one item: '1 item · …'", () => {
    const one = { ...receipt, rows: receipt.rows.slice(0, 1) };
    render(<BillView lines={[]} onEdit={() => null} onRemove={() => {}} saved={{ localId: "b", receiptNumber: "515", receipt: one } as never} share={shareOf()} />);
    expect(screen.getByText("1 item · Cash · 1:18 pm")).toBeTruthy();
  });

  it("a named customer is said by name", () => {
    const named = { ...receipt, customer: "Ramesh" };
    render(<BillView lines={[]} onEdit={() => null} onRemove={() => {}} saved={{ localId: "b", receiptNumber: "515", receipt: named } as never} share={shareOf()} />);
    expect(screen.getByText("3 items · Ramesh · 1:18 pm")).toBeTruthy();
  });
});

describe("design 13's receipt look (on screen: 13, History; Receipt.tsx)", () => {
  it("white paper, no border, Plex Mono (Devanagari in Noto Sans Devanagari - the mono font's fallback, KB-429), the drawn sizes and colours", () => {
    render(<Receipt receipt={receipt} />);
    const a = screen.getByRole("article", { name: "Receipt" });
    expect(cls(a)).toMatch(/\bbg-kb-card\b/);
    expect(cls(a)).toMatch(/\bfont-mono\b/);
    expect(cls(a)).not.toMatch(/\bborder\b/);
    expect(cls(a)).toContain("text-kb-12");
    expect(cls(screen.getByText("GUPTA KIRANA STORE", { exact: false }))).toContain("text-kb-15");
    expect(cls(screen.getByText("11-11-2026 | 1:18 PM"))).toContain("text-kb-receipt-sub");
    expect(cls(a.querySelector("thead tr"))).toContain("border-kb-receipt-strong");
    expect(cls(screen.getByText("2 kg").closest("td"))).toContain("text-kb-receipt-strong");
    expect(cls(screen.getByText("₹90").closest("td"))).toContain("font-bold");
    expect(cls(screen.getByText("TOTAL").closest("tr"))).toContain("text-kb-16");
    expect(cls(screen.getByText("Thank You!").closest("footer"))).toContain("border-kb-receipt-rule");
  });

  it("a cancelled bill keeps its CANCELLED mark (KB-325), in the new look", () => {
    render(<Receipt receipt={{ ...receipt, cancelled: "CANCELLED" }} />);
    expect(screen.getByTestId("receipt-cancelled").textContent).toBe("CANCELLED");
  });
});

describe("the share image: 13's receipt look, the printed bill untouched", () => {
  const measure: Measure = (text, font) => [...text].length * font.size * 0.6;

  it("SCREEN_STYLE is 13's receipt at 320 px: name 15 bold, small 11, rows 12, amounts and the number bold, TOTAL 16 bold", () => {
    expect([SCREEN_STYLE.title, SCREEN_STYLE.small, SCREEN_STYLE.name, SCREEN_STYLE.cell, SCREEN_STYLE.amount, SCREEN_STYLE.number, SCREEN_STYLE.total]).toEqual([
      { size: 15, weight: 700, tracking: 0.5 }, { size: 11, weight: 400 }, { size: 12, weight: 400 }, { size: 12, weight: 400 }, { size: 12, weight: 700 }, { size: 12, weight: 700 }, { size: 16, weight: 700 },
    ]);
  });

  it("the share palette is 13's colours on plain white: no border, no torn edge (owner)", () => {
    expect(SHARE_PALETTE).toMatchObject({ ink: "#263238", inkSoft: "#6B7580", line: "#ECE8E1", muted: "#C9C2B8", strong: "#4B5560", border: false });
    expect(SHARE_PALETTE.widths).toEqual({ dashed: 1, dark: 2, light: 1 });
  });

  /** A canvas that only records what is drawn, in which colour. */
  function fakeCtx() {
    const drawn: { text?: string; style: string; spacing: string }[] = [];
    const ctx = {
      fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "left", textBaseline: "top", letterSpacing: "0px",
      fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, setLineDash() {},
      stroke() { drawn.push({ style: String(ctx.strokeStyle), spacing: ctx.letterSpacing }); },
      fillText(text: string) { drawn.push({ text, style: String(ctx.fillStyle), spacing: ctx.letterSpacing }); },
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, drawn };
  }

  it("qty, rate and the header rule in 13's strong grey; the shop name tracked .5 px", () => {
    const { ctx, drawn } = fakeCtx();
    paintReceipt(ctx, layoutReceipt(receipt, measure, 320), SHARE_PALETTE);
    const colourOf = (t: string) => drawn.find((d) => d.text === t)!.style;
    expect([colourOf("2 kg"), colourOf("₹45"), colourOf("₹90"), colourOf("चीनी")]).toEqual(["#4B5560", "#4B5560", "#263238", "#263238"]);
    expect(drawn.find((d) => d.text === "GUPTA KIRANA STORE")!.spacing).toBe("0.5px");
    expect(drawn.find((d) => d.text === "चीनी")!.spacing).toBe("0px");
    expect(drawn.some((d) => d.text === undefined && d.style === "#4B5560")).toBe(true); // the 2 px rule under the header
  });

  it("the PRINTER's palette paints exactly as before: all black, no tracking (it has no strong grey)", () => {
    const { ctx, drawn } = fakeCtx();
    paintReceipt(ctx, layoutReceipt(receipt, measure, 384, 0, printStyle("narrow")), PRINT_PALETTE);
    expect(new Set(drawn.map((d) => d.style))).toEqual(new Set(["#000000"]));
    expect(new Set(drawn.map((d) => d.spacing))).toEqual(new Set(["0px"]));
    expect("strong" in PRINT_PALETTE).toBe(false);
  });

  it("a palette without the strong grey paints as before: the header rule in inkSoft, qty and rate in ink (the printer's path)", () => {
    const { ctx, drawn } = fakeCtx();
    const { strong: _none, ...old } = SHARE_PALETTE;
    paintReceipt(ctx, layoutReceipt(receipt, measure, 384, 0, printStyle("narrow")), { ...old, ink: "#111111", inkSoft: "#222222", line: "#333333", muted: "#444444" });
    const strokes = drawn.filter((d) => d.text === undefined).map((d) => d.style);
    expect(strokes).toContain("#222222"); // the rule under the header
    expect(new Set(strokes)).toEqual(new Set(["#222222", "#333333", "#444444"]));
    expect(drawn.find((d) => d.text === "2 kg")!.style).toBe("#111111");
  });
});
