// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { KiranaBillDB, type LocalBillMetrics } from "@/data/db";
import { recordColdStart } from "@/data/billMetrics";
import { recordPhases } from "@/data/phaseTimings";
import { recordVoiceTiming } from "@/data/voiceTimings";
import { isReviewCaptureOn } from "@/data/reviewCapture";
import { PilotNumbers } from "./PilotNumbers";

// KB-404 (D80): the Developer-mode panel - the release gate's lines over the last 20 eligible voice bills (all phones of the
// shop), the four budgets, the "no bill lost or corrupted" check, and the review capture (S2, device-only). Text, never
// alarming colours; it says plainly when it has too little to say.

const shopId = "11111111-1111-4111-8111-111111111111";
let db: KiranaBillDB;
let seq = 0;
beforeEach(() => {
  db = new KiranaBillDB(`pilot-${crypto.randomUUID()}`);
});
afterEach(async () => {
  cleanup();
  db.close();
  await db.delete();
});

async function bill(over: Partial<LocalBillMetrics> = {}, status: "final" | "cancelled" = "final") {
  seq += 1;
  const billLocalId = crypto.randomUUID();
  const at = new Date(Date.UTC(2026, 9, 16, 10, 0, seq)).toISOString();
  await db.bills.add({
    localId: billLocalId, shopId, status, syncStatus: "synced", receiptNumber: `KB-${String(seq).padStart(6, "0")}`, receiptNumberSource: "block", customerName: "Cash", customerMobile: null,
    subtotalPaise: 9000, totalPaise: 9000, schemaVersion: 1, deviceId: "dev", createdAt: at, finalizedAt: at, syncedAt: at,
  });
  await db.billMetrics.add({
    billLocalId, shopId, localId: crypto.randomUUID(), syncStatus: "synced", updatedAt: at, deviceId: "dev", receiptNumber: `KB-${String(seq).padStart(6, "0")}`, totalPaise: 9000, lineCount: 2,
    turns: 1, secondsToBill: 12, utterances: [{ path: "fastpath", stopToTranscriptMs: 900, transcriptToItemsMs: 120 }], finaliseToReceiptMs: 200, numberMs: 120, voiceLines: 2, editedLines: 0, manualLines: 0,
    removedLines: 0, notAdded: 0, flagsRaised: 0, flagsAcknowledged: 0, recordedAt: at, ...over,
  });
  return billLocalId;
}
const typed = (secs: number) => bill({ turns: 0, voiceLines: 0, manualLines: 2, utterances: [], secondsToBill: secs, finaliseToReceiptMs: 150 });
const open = (reconcile?: () => Promise<{ checked: number; problems: { receiptNumber: string; problems: string[] }[]; asked: boolean }>) => {
  render(<PilotNumbers localDb={db} shopId={shopId} reconcile={reconcile} />);
  return screen.findByRole("region", { name: "Pilot numbers" }).then(async (panel) => {
    await within(panel).findByText(/in the window|No eligible voice bills yet/); // loaded
    return panel;
  });
};
const line = (panel: HTMLElement, label: string) => within(panel).getByText(label).closest("li") as HTMLElement;

describe("KB-352 - where stop → transcript goes", () => {
  const row = (panel: HTMLElement, label: string) => line(panel, label).textContent!;
  it("no turns yet: every line says 'no samples yet'", async () => {
    const panel = await open();
    expect(row(panel, "Whole: stop → transcript")).toContain("no samples yet");
    expect(row(panel, "Where /voice runs · where Groq answers from")).toContain("no samples yet");
  });

  it("the whole wait is split into the recorder, the request, the server's own parts and the network that is left; regions and audio size are named", async () => {
    for (const [i, total] of [2100, 3100, 7500].entries()) {
      await recordVoiceTiming(db, { at: `2026-10-28T10:0${i}:00.000Z`, audioBytes: 24_576, audioType: "audio/webm;codecs=opus", stopToBlobMs: 40, requestMs: total - 60, bodyMs: 3, totalMs: total, server: { auth: 200 + i, limit: 5, form: 9, groq: 400, total: 700 }, region: "us-east-2", groqRegion: "us-east-1" });
    }
    const panel = await open();
    await waitFor(() => expect(row(panel, "Whole: stop → transcript")).toContain("median 3.1 s"));
    expect(row(panel, "Whole: stop → transcript")).toContain("p95 7.5 s");
    expect(row(panel, "Recorder stop → audio ready")).toContain("median 40 ms");
    expect(row(panel, "…inside it, the server in all")).toContain("median 700 ms");
    expect(row(panel, "…of which Groq")).toContain("median 400 ms");
    expect(row(panel, "…of which checking the token")).toContain("median 201 ms");
    expect(row(panel, "…the rest is the network (request − server)")).toContain("median 2.3 s"); // 3040 - 700
    expect(row(panel, "Where /voice runs · where Groq answers from")).toContain("us-east-2 · Groq: us-east-1");
    expect(row(panel, "Where /voice runs · where Groq answers from")).toContain("audio 24 KB median (audio/webm;codecs=opus)");
    expect(panel.textContent).not.toContain("NaN");
  });

  it("an older server that sends no timing: the phone's own numbers show, the server lines say 'no samples yet', Groq 'not reported'", async () => {
    await recordVoiceTiming(db, { at: "2026-10-28T10:00:00.000Z", requestMs: 1500, totalMs: 1600, server: {}, region: "us-east-2", groqRegion: null });
    const panel = await open();
    await waitFor(() => expect(row(panel, "Request: send → first byte of the answer")).toContain("median 1.5 s"));
    expect(row(panel, "…of which Groq")).toContain("no samples yet");
    expect(row(panel, "Where /voice runs · where Groq answers from")).toContain("Groq: not reported");
  });
});

describe("KB-352 - where the app start goes", () => {
  const row = (panel: HTMLElement, label: string) => line(panel, label).textContent!;
  it("no starts yet: every step says 'no samples yet'", async () => {
    const panel = await open();
    expect(row(panel, "JS parsed and run")).toContain("no samples yet");
    expect(row(panel, "Mic enabled")).toContain("no samples yet");
    expect(row(panel, "Opened from the service worker")).toContain("no samples yet");
  });

  it("each step shows when it happened (median, p95) and how long it took after the step before it", async () => {
    await recordColdStart(db, 3400, "2026-10-28T10:00:00.000Z", { html: 300, js: 900, auth: 3100, db: 3200, shop: 3250, catalog: 3300, mic: 3400, sw: 1 });
    await recordColdStart(db, 2200, "2026-10-28T11:00:00.000Z", { html: 250, js: 800, auth: 1900, db: 2000, shop: 2050, catalog: 2100, mic: 2200, sw: 1 });
    await recordColdStart(db, 30_000, "2026-10-28T12:00:00.000Z", { html: 400, js: 1000, auth: 27_000, db: 27_100, shop: 27_150, catalog: 27_200, mic: 27_300, sw: 0 });
    const panel = await open();
    await waitFor(() => expect(row(panel, "Sign-in check answered")).toContain("at median 3.1 s"));
    expect(row(panel, "Sign-in check answered")).toContain("this step +2.2 s"); // 3100 - 900 and 1900 - 800 and 26000: the median step is 2.2 s
    expect(row(panel, "Sign-in check answered")).toContain("p95 27 s");
    expect(row(panel, "JS parsed and run")).toContain("at median 900 ms");
    expect(row(panel, "Opened from the service worker")).toContain("2 of 3 starts");
    expect(panel.textContent).not.toContain("NaN");
  });
});

describe("KB-352 - where the time goes after Bill Banao", () => {
  const row = (panel: HTMLElement, label: string) => line(panel, label).textContent!;
  it("no bills yet: every phase says 'no samples yet' - nothing invented", async () => {
    const panel = await open();
    for (const label of ["Waiting for the bill number", "The one local write", "Reading the receipt back", "Receipt painted (after it was read)", "After the receipt: learning", "After the receipt: catalog reload", "After the receipt: sync"]) {
      expect(row(panel, label)).toContain("no samples yet");
    }
  });

  it("each phase shows its median and p95 over this phone's bills; the three after the receipt are named as such", async () => {
    const data: Array<[number, number, number, number, number, number, number]> = [
      [170, 10, 4, 60, 40, 30, 800],
      [180, 12, 5, 70, 50, 35, 1200],
      [160, 11, 4, 65, 45, 33, 40_000], // a slow sync, after the receipt
    ];
    for (const [i, d] of data.entries()) await recordPhases(db, `b${i}`, { number: d[0], write: d[1], read: d[2], paint: d[3], learning: d[4], reload: d[5], sync: d[6] });
    const panel = await open();
    await waitFor(() => expect(row(panel, "Waiting for the bill number")).toContain("median 170 ms"));
    expect(row(panel, "Waiting for the bill number")).toContain("3 samples");
    expect(row(panel, "The one local write")).toContain("median 11 ms");
    expect(row(panel, "Receipt painted (after it was read)")).toContain("median 65 ms");
    expect(row(panel, "After the receipt: learning")).toContain("median 45 ms");
    expect(row(panel, "After the receipt: sync")).toContain("median 1.2 s");
    expect(row(panel, "After the receipt: sync")).toContain("p95 40 s");
    expect(panel.textContent).not.toContain("NaN");
  });
});

describe("the release gate lines", () => {
  it("nothing yet: says so and invents no number", async () => {
    const panel = await open();
    await within(panel).findByText("No eligible voice bills yet");
    expect(line(panel, "Median turns to bill").textContent).toContain("—");
    expect(line(panel, "Fast-path coverage").textContent).toContain("—");
  });

  it("the window is the last 20 eligible voice bills; each line shows its value, its target and plain words", async () => {
    for (let i = 0; i < 12; i++) await bill();
    await bill({ editedLines: 1 }); // not zero-edit
    await bill({ turns: 3 });
    await bill({}, "cancelled"); // excluded everywhere
    const panel = await open();
    await within(panel).findByText("14 voice bills in the window");
    expect(line(panel, "Median turns to bill").textContent).toContain("1");
    expect(line(panel, "Median turns to bill").textContent).toContain("target 1");
    expect(line(panel, "Median turns to bill").textContent).toContain("meets the target");
    expect(line(panel, "Fast-path coverage").textContent).toContain("100%");
    expect(line(panel, "Zero-edit bills").textContent).toContain("93%"); // 13 of 14: only the edited one is not zero-edit
    expect(line(panel, "Zero-edit bills").textContent).toContain("target 80%");
  });

  it("a number below target is said plainly - no alarm, no colour only", async () => {
    for (let i = 0; i < 5; i++) await bill({ turns: 3 });
    const panel = await open();
    await within(panel).findByText("5 voice bills in the window");
    expect(line(panel, "Median turns to bill").textContent).toContain("above the target");
  });

  it("voice vs typing: the plain 'only N hand-only bills' message below 10, with both medians and their counts", async () => {
    for (let i = 0; i < 12; i++) await bill({ secondsToBill: 10 });
    await typed(40);
    await typed(50);
    const panel = await open();
    const l = await within(panel).findByText("Voice vs typing");
    const text = l.closest("li")!.textContent!;
    expect(text).toContain("Voice 10 s (12 bills)");
    expect(text).toContain("Typing 45 s (2 bills)");
    expect(text).toContain("Only 2 hand-only bills so far (10 needed) - type a baseline set during the pilot");
  });

  it("voice vs typing with 10+ of each: the verdict from the medians", async () => {
    for (let i = 0; i < 10; i++) {
      await bill({ secondsToBill: 10 });
      await typed(40);
    }
    const panel = await open();
    expect((await within(panel).findByText("Voice vs typing")).closest("li")!.textContent).toContain("Voice is faster: 10 s against 40 s typing");
  });

  it("hand lines are out of fast-path and zero-edit and shown on their own line", async () => {
    for (let i = 0; i < 3; i++) await bill();
    await bill({ manualLines: 1, voiceLines: 1 });
    const panel = await open();
    await within(panel).findByText("4 voice bills in the window");
    expect(line(panel, "Bills with hand-added lines").textContent).toContain("1");
    expect(line(panel, "Zero-edit bills").textContent).toContain("100%");
  });

  it("escaped errors: a bill cancelled for a wrong price shows here, though cancelled bills are in no other line", async () => {
    const id = await bill();
    await db.billCancellations.add({ localId: crypto.randomUUID(), shopId, billLocalId: id, reason: "wrong_price", replacementLocalId: null, cancelledAt: new Date().toISOString(), deviceId: "dev", syncStatus: "synced", updatedAt: new Date().toISOString() });
    await db.bills.update(id, { status: "cancelled" });
    await bill();
    const panel = await open();
    await within(panel).findByText("1 voice bill in the window");
    expect(line(panel, "Escaped errors").textContent).toContain("1");
    expect(line(panel, "Escaped errors").textContent).toContain("target 0");
  });

  it("silent number errors are NOT measured by the app: it says so and points at the heard / billed pairs", async () => {
    const panel = await open();
    const l = await within(panel).findByText("Silent number errors");
    expect(l.closest("li")!.textContent).toContain("Not measured by the app");
    expect(l.closest("li")!.textContent).toContain("Review mode");
  });
});

describe("the four budgets", () => {
  it("each with its median, p95, count and the budget; cold start from this phone's samples", async () => {
    for (let i = 0; i < 3; i++) await bill({ utterances: [{ path: "fastpath", stopToTranscriptMs: 1000 + i * 100, transcriptToItemsMs: 100 + i * 50 }, { path: "voice", stopToTranscriptMs: 1200, transcriptToItemsMs: 2500 }] });
    await recordColdStart(db, 1500);
    await recordColdStart(db, 2500);
    const panel = await open();
    await within(panel).findByText("3 voice bills in the window");
    const row = (label: string) => line(panel, label).textContent!;
    expect(row("Stop → transcript")).toContain("budget < 1.5 s");
    expect(row("Stop → transcript")).toContain("median 1.2 s");
    expect(row("Stop → transcript")).toContain("6 samples");
    expect(row("Fast-path item on screen")).toContain("budget < 300 ms");
    expect(row("Fast-path item on screen")).toContain("median 150 ms");
    expect(row("LLM-path item on screen")).toContain("budget < 4 s");
    expect(row("LLM-path item on screen")).toContain("median 2.5 s");
    expect(row("Finalise → receipt")).toContain("budget < 500 ms");
    expect(row("Finalise → receipt")).toContain("median 200 ms");
    // KB-351: the bill-number round trip (only bills that got a server number), budget the owner's 300 ms
    expect(row("Bill number from the server (part of the line above)")).toContain("budget < 300 ms");
    expect(row("Bill number from the server (part of the line above)")).toContain("median 120 ms");
    expect(row("App cold start")).toContain("budget < 2 s");
    expect(row("App cold start")).toContain("2 samples");
  });

  it("KB-352: rows written before bill numbers were timed (no numberMs at all), or with a missing value, give 'no samples yet' - never NaN", async () => {
    for (let i = 0; i < 3; i++) await bill({ numberMs: undefined as never });
    await bill({ numberMs: Number.NaN as never });
    const panel = await open();
    const text = line(panel, "Bill number from the server (part of the line above)").textContent!;
    expect(text).toContain("no samples yet");
    expect(panel.textContent).not.toContain("NaN");
  });

  it("KB-352: one or two samples still show a real median and p95 - a number, never NaN", async () => {
    await bill({ numberMs: 173 });
    await bill({ numberMs: undefined as never });
    const panel = await open();
    const text = line(panel, "Bill number from the server (part of the line above)").textContent!;
    expect(text).toContain("median 173 ms");
    expect(text).toContain("p95 173 ms");
    expect(text).toContain("1 sample");
    expect(panel.textContent).not.toContain("NaN");
  });

  it("a budget with no samples says 'no samples yet' - never a made-up number", async () => {
    const panel = await open();
    expect(line(await within(panel).findByText("LLM-path item on screen"), "LLM-path item on screen").textContent).toContain("no samples yet");
  });
});

describe("no bill lost or corrupted", () => {
  it("'Check' asks the server through the injected check and lists every difference in words", async () => {
    const reconcile = vi.fn(async () => ({ checked: 3, asked: true, problems: [{ receiptNumber: "KB-000002", problems: ["total differs (9000 paise here, 9100 on the server)"] }] }));
    const panel = await open(reconcile);
    fireEvent.click(within(panel).getByRole("button", { name: "Check this phone's bills" }));
    await within(panel).findByText("3 bills checked: 1 with a problem");
    expect(within(panel).getByText(/KB-000002/).textContent).toMatch(/^Bill KB-000002: total differs/);
    expect(reconcile).toHaveBeenCalledOnce();
  });
  it("all fine: says so; the server could not be asked: claims nothing", async () => {
    const panel = await open(async () => ({ checked: 4, asked: true, problems: [] }));
    fireEvent.click(within(panel).getByRole("button", { name: "Check this phone's bills" }));
    await within(panel).findByText("4 bills checked: every one is on the server with the same number, total and item count");
    cleanup();
    const panel2 = await open(async () => ({ checked: 0, asked: false, problems: [] }));
    fireEvent.click(within(panel2).getByRole("button", { name: "Check this phone's bills" }));
    await within(panel2).findByText("Couldn't ask the server — nothing is claimed either way");
    cleanup();
    const panel3 = await open(async () => ({ checked: 0, asked: true, problems: [] }));
    fireEvent.click(within(panel3).getByRole("button", { name: "Check this phone's bills" }));
    await within(panel3).findByText("No bills made on this phone yet - nothing to check"); // never "every one is on the server" for zero bills
  });
  it("without a check wired (offline-session) there is no button", async () => {
    const panel = await open();
    expect(within(panel).queryByRole("button", { name: "Check this phone's bills" })).toBeNull();
  });
});

describe("Review mode (S2): device-only, off by default", () => {
  it("off at first; the switch turns it on and writes the shop's flag; no pair is listed", async () => {
    const panel = await open();
    const sw = within(panel).getByRole("switch", { name: "Review mode" }) as HTMLInputElement;
    expect(sw.checked).toBe(false);
    fireEvent.click(sw);
    await waitFor(async () => expect(await isReviewCaptureOn(db, shopId)).toBe(true));
    expect(within(panel).getByText("No heard / billed pairs yet")).toBeTruthy();
  });

  it("a switch write that ends after the database closed (a sign-out, a closed test) is not an unhandled rejection", async () => {
    const seen: unknown[] = [];
    const on = (e: unknown) => void seen.push(e);
    process.on("unhandledRejection", on);
    try {
      const panel = await open();
      fireEvent.click(within(panel).getByRole("switch", { name: "Review mode" }));
      db.close(); // the write is still in flight
      await new Promise((r) => setTimeout(r, 250));
    } finally {
      process.off("unhandledRejection", on);
    }
    expect(seen).toEqual([]);
  });

  it("says what it keeps and for how long, in plain words", async () => {
    const panel = await open();
    expect(within(panel).getByText(/kept on this phone only, never sent or backed up, deleted after 30 days and when you sign out/i)).toBeTruthy();
  });

  it("lists each pair - the heard words as plain text beside what was billed - and 'Clear now' empties it", async () => {
    const id = await bill();
    await db.reviewCapture.add({ shopId, billLocalId: id, capturedAt: new Date().toISOString(), transcript: "<b>do</b> kilo chini", path: "fastpath", lines: [{ name: "Chini", qty: 2, unit: "kg", rate: 4500, total: 9000 }] });
    await db.reviewCapture.add({ shopId, billLocalId: "unsaved", capturedAt: new Date(Date.now() - 1000).toISOString(), transcript: "kuch aur", path: "failed", lines: [] });
    const panel = await open();
    const list = await within(panel).findByRole("list", { name: "Heard and billed" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain("Heard: “<b>do</b> kilo chini”"); // text, not markup
    expect(list.querySelector("b")).toBeNull();
    expect(items[0]!.textContent).toContain("Billed: Chini 2 kg = ₹90");
    expect(items[0]!.textContent).toMatch(/^Bill KB-0000\d+ · /); // KB-341: the number with its label
    expect(items[1]!.textContent).toContain("Billed: nothing added");
    expect(items[1]!.textContent).toContain("bill not saved");
    fireEvent.click(within(panel).getByRole("button", { name: "Clear now" }));
    await waitFor(async () => expect(await db.reviewCapture.count()).toBe(0));
    expect(await within(panel).findByText("No heard / billed pairs yet")).toBeTruthy();
  });
});
