import { useEffect, useRef, useState } from "react";
import type { ParsedItem } from "@/domain/grammar";
import type { LocalVoiceRecording } from "@/data/db";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { getScreenLanguage, setScreenLanguage } from "./screenLanguage";
import { useT } from "./useT";
import { render as say, type Language } from "@/domain/messages";
import { BillView } from "./BillingScreen";
import { OrderEntries, OrderRecorder } from "./VoiceOrderPanel";
import { RecordOverlay, RecordingBody, ReviewBody } from "./RecordScreens";
import type { ShownFlag } from "./useBillLines";
import { ContainmentCheck, TapAreaCheck } from "./DevKitGallery";
import { Capacitor } from "@capacitor/core";
import Dexie from "dexie";
import { KiranaBillDB } from "@/data/db";
import { finaliseBill } from "@/data/finalise";
import { cancelBillLocal } from "@/data/cancelBill";
import { buildReceipt, type ReceiptItem } from "@/domain/receipt";
import type { FinalLine } from "@/domain/finalBill";
import type { Paise } from "@/domain/money";
import { DEV_PRINT_BILLS } from "./devPrintBills";
import { BillSavedScreen } from "./BillSavedScreen";
import { HistoryScreen } from "./HistoryScreen";
import { renderReceiptFiles } from "./receiptImage";
import type { ReceiptShare } from "./useReceiptShare";
import { HomeScreen } from "./HomeScreen";
import { TabFrame } from "./AppTabs";

// DEV ONLY (KB-413, /__dev/screens): each rebuilt screen, the REAL component with sample data, full-size beside its whole approved
// screen file (docs/design/screens/NN-*.html) - the owner's review of a full screen (D110 item 9).
//   ?frame=1&screen=12&state=…   the screen alone, filling the window (what the frames show); the containment and tap-area checks run
//                                 inside it and are read by the sheet
//   default                       the sheet: our frame beside the design file's frame, 390 x 844 (or ?w= and ?scale=)
//   screen 12, state: design (the file's own sample content) | checks (HIGH, BLOCK, MEDIUM / LOW) | edit (a line's edit sheet open)
//                     | micdenied (the browser refuses the mic: a real Record tap, the real error row)
//   screen 09, state: recording (00:42 as drawn) | paused | warning (4:36 - the 4:30 line) | discard (Back pressed: the question)
//   screen 10, state: review (0:42 as drawn) | playing (half-way: the played part and the time) | limit (stopped at 5:00) | discard
//   The bars on 09 are the still bars (no mic here): the drawn heights, as the file shows them under reduced motion.
//   screen 11, state: generating (the first recording of an empty bill, 12 s in) - &motion=reduce for the reduced-motion sheet (the shot
//                     script also runs the browser with reduced motion, so the design file's frame stops too)
//   screen 23, state: failed (the connection: "upload") | busy | session | limit | again (Record again pressed: the question)
//   screen 24, state: offline (the drawn bill: one typed line, the waiting recording, the strip)
//   screen 08, state: home (08's Recent bills: Bill 514, 38 items, 1:02 pm, ₹2,216; Bill 513, 7 items, 12:40 pm, ₹1,215 - "Good morning")
//                     | offline (the same, offline: the ink strip on top) | empty (no bills yet: no Recent bills) - KB-414 step 1
//   screen 13, state: saved (the file's Bill 515: 4 items, ₹610) | long (the owner's real Bill 514, 38 lines) - the frame shows "Print bill"
//                     as the Android app does (the web has no printer); &t= freezes both frames at that many ms (default 600)
//   screen 15, state: history | cancelled - TODAY's History bill detail (its own redesign is a later step) with the receipt in 13's look:
//                     the real HistoryScreen on a dev database (the bill saved by the real finaliseBill, cancelled by the real cancelBillLocal)

const params = new URLSearchParams(window.location.search);
const noop = () => {};

const item = (spokenName: string, over: Partial<ParsedItem> = {}): ParsedItem =>
  ({ spokenName, catalogId: null, isCustom: true, matchStatus: "none", qty: 2, unit: "kg", rate: 4500, rateUnit: "kg", total: 9000, priceType: "rate", ...over });
const row = (id: string, name: string, over: Partial<ParsedItem> = {}, filled?: "shop_price" | "repeat") =>
  ({ id, item: item(name, over), displayName: name, source: "voice" as const, ...(filled ? { filled } : {}) });
const flag = (lineId: string, severity: ShownFlag["severity"], message: string): ShownFlag =>
  ({ id: `${lineId}-${severity}`, code: "unusual_rate", severity, message, itemIndex: 0, lineId, utteranceId: 1, anchorLineId: lineId, transcript: "", key: `${lineId}-${severity}`, acknowledged: false }) as ShownFlag;

/** 12-BillReview's own sample: चीनी 2 kg × ₹45, चावल 5 kg ₹340, टाटा नमक 1 pc × ₹30 (a filled price), दाने 1 kg - Price needed. */
const DESIGN_LINES = [
  row("l1", "चीनी"),
  row("l2", "चावल", { qty: 5, rate: null, rateUnit: null, total: 34000, priceType: "total" }),
  row("l3", "टाटा नमक", { qty: 1, unit: "piece", rate: 3000, rateUnit: "piece", total: 3000, priceType: "default" }, "shop_price"),
  row("l4", "दाने", { qty: 1, rate: null, rateUnit: null, total: null, priceType: "default" }),
];
const CHECK_LINES = [
  row("c1", "चीनी", { rate: 500, total: 1000 }),
  row("c2", "बंसल तेल", { qty: 1, unit: "liter", rate: 1800000, rateUnit: "liter", total: 1800000 }),
  row("c3", "चावल", { qty: 5, rate: null, rateUnit: null, total: 34000, priceType: "total" }),
];
const CHECK_FLAGS = [
  flag("c1", "HIGH", "₹5 a kilo for चीनी is far below your price (₹45). Check?"),
  flag("c2", "BLOCK", "₹18,000 for 1 liter is far too high - change the price or the amount."),
  flag("c3", "MEDIUM", "Check this item - heard “चावल”, chose “चावल”."),
  flag("c3", "LOW", "A total was said, not a rate."),
];

const heard = (transcript: string): LocalVoiceRecording =>
  ({ recordingId: "r1", shopId: "s", billLocalId: "b", bytes: new ArrayBuffer(0), mime: "audio/webm", recordedMs: 42000, createdAt: new Date().toISOString(), state: "appended", transcript, items: [{}] }) as LocalVoiceRecording;
const orders = (transcript: string) => ({ recordings: [heard(transcript)], sending: new Set<string>(), offline: false, retry: async () => {}, remove: async () => {} });
const NO_ORDERS = { recordings: [], sending: new Set<string>(), offline: false, retry: async () => {}, remove: async () => {} };
/** the bill's first recording, as the voice queue holds it (11: being read; 23: failed; 24: waiting offline) */
const firstRec = (over: Partial<LocalVoiceRecording>): LocalVoiceRecording =>
  ({ recordingId: "r1", shopId: "s", billLocalId: "b", bytes: new ArrayBuffer(0), mime: "audio/webm", recordedMs: 42000, createdAt: new Date(Date.now() - 12_000).toISOString(), state: "queued", ...over }) as LocalVoiceRecording;

function Screen12({ state }: { state: string }) {
  const lines = state === "checks" ? CHECK_LINES : DESIGN_LINES;
  const flags = state === "checks" ? CHECK_FLAGS : [];
  const pending = state === "checks" ? 2 : 1;
  const o = orders("2 किलो चीनी 45 रुपये किलो, चावल 5 किलो 340, एक टाटा नमक, एक किलो दाने…");
  const opened = useRef(false);
  useEffect(() => {
    if (state !== "micdenied" || opened.current) return;
    opened.current = true;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: () => Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" })) },
    });
    window.setTimeout(() => document.querySelector<HTMLButtonElement>("button[aria-label='Add more by voice'], button[aria-label='आवाज़ से और जोड़ें'], button[aria-label='Awaaz se aur jodein']")?.click(), 50);
  }, [state]);
  useEffect(() => {
    // the edit sheet, open on the first line (as a tap on its edit button opens it)
    if (state !== "edit" || opened.current) return;
    opened.current = true;
    // the first line's (चीनी) edit button, in any language
    window.setTimeout(() => [...document.querySelectorAll<HTMLButtonElement>("li button[aria-label]")].find((b) => b.getAttribute("aria-label")!.includes("चीनी"))?.click(), 50);
  }, [state]);
  return (
    <BillView
      shopName="Gupta Kirana Store"
      lines={lines}
      flags={flags}
      pending={pending}
      onEdit={() => null}
      onRemove={noop}
      onAcknowledge={noop}
      onFinalise={noop}
      catalog={SEED_PARSER_CATALOG}
      onAddByHand={noop}
      onChangeProduct={noop}
      onBack={noop}
      onClearBill={noop}
      customer={{ name: "Cash", mobile: null }}
      onCustomerName={() => null}
      onCustomerMobile={() => null}
      orderBar={(openAdd, noteSlot) => <OrderRecorder orders={NO_ORDERS} shopName="Gupta Kirana Store" hasLines onGenerate={noop} onAddByHand={openAdd} noteSlot={noteSlot} />}
      orderEntries={(openAdd, part) => <OrderEntries orders={o} onAddByHand={openAdd} part={part} />}
    />
  );
}

function Screen09({ state }: { state: string }) {
  const { t } = useT();
  const [asking, setAsking] = useState(state === "discard");
  const paused = state === "paused" || state === "discard";
  return (
    <RecordOverlay screenKey="rec" title={t("rec.title")} asking={asking} lostLine={t("rec.discardLine", { time: state === "warning" ? "4:36" : "0:42" })} onAsk={() => setAsking(true)} onKeep={() => setAsking(false)} onDiscard={noop}>
      <RecordingBody elapsedMs={state === "warning" ? 276_000 : 42_000} paused={paused} busy={false} scales={null} onPause={noop} onResume={noop} onStop={noop} />
    </RecordOverlay>
  );
}

function Screen10({ state }: { state: string }) {
  const { t } = useT();
  const [asking, setAsking] = useState(state === "discard");
  const [url] = useState(() => URL.createObjectURL(new Blob([], { type: "audio/webm" })));
  useEffect(() => {
    if (state !== "playing") return;
    // half-way through, playing: what the audio element reports while it plays (no sound in a frame)
    const id = window.setTimeout(() => {
      const a = document.querySelector("audio");
      if (!a) return;
      Object.defineProperty(a, "currentTime", { configurable: true, get: () => 21 });
      a.dispatchEvent(new Event("play"));
      a.dispatchEvent(new Event("timeupdate"));
    }, 100);
    return () => window.clearTimeout(id);
  }, [state]);
  return (
    <RecordOverlay screenKey="review" title={t("review.title")} asking={asking} lostLine={t("rec.discardLine", { time: state === "limit" ? "5:00" : "0:42" })} onAsk={() => setAsking(true)} onKeep={() => setAsking(false)} onDiscard={noop}>
      <ReviewBody url={url} saved ms={state === "limit" ? 300_000 : 42_000} {...(state === "limit" ? { stopped: "limit" as const } : {})} onGenerate={noop} onRerecord={noop} onTypeInstead={noop} />
    </RecordOverlay>
  );
}

function Screen11() {
  const [o] = useState(() => ({ ...NO_ORDERS, recordings: [firstRec({})], sending: new Set(["r1"]) }));
  return <OrderRecorder orders={o} shopName="Gupta Kirana Store" hasLines={false} onGenerate={noop} onAddByHand={noop} />;
}

const REASON_23: Record<string, string> = { failed: "upload", again: "upload", busy: "busy", session: "session", limit: "rate_limited" };
function Screen23({ state }: { state: string }) {
  const [o] = useState(() => ({ ...NO_ORDERS, recordings: [firstRec({ state: "failed", reason: REASON_23[state] ?? "upload" })] }));
  const opened = useRef(false);
  useEffect(() => {
    if (state !== "again" || opened.current) return;
    opened.current = true;
    // "Record again" - 23's buttons are Back, Retry, Type instead, Record again, Remove (in every language)
    window.setTimeout(() => document.querySelectorAll<HTMLButtonElement>("[role='dialog'] button")[3]?.click(), 50);
  }, [state]);
  return <OrderRecorder orders={o} shopName="Gupta Kirana Store" hasLines={false} onGenerate={noop} onAddByHand={noop} />;
}

/** 24-Offline as drawn: one typed line (टाटा नमक 1 × ₹30), the recording waiting to be sent, no internet */
function Screen24() {
  const [o] = useState(() => ({ ...NO_ORDERS, offline: true, recordings: [firstRec({ recordedMs: 65_000, emptyBill: true })] })); // the first recording of an empty bill (fix 1: its card first)
  return (
    <BillView
      shopName="Gupta Kirana Store"
      lines={[row("t1", "टाटा नमक", { qty: 1, unit: "piece", rate: 3000, rateUnit: "piece", total: 3000 })]}
      flags={[]}
      pending={1}
      waitingRecordings={1}
      syncChip={{ kind: "offline", label: "Offline" }}
      onEdit={() => null}
      onRemove={noop}
      onAcknowledge={noop}
      onFinalise={noop}
      catalog={SEED_PARSER_CATALOG}
      onAddByHand={noop}
      onChangeProduct={noop}
      onBack={noop}
      onClearBill={noop}
      customer={{ name: "Cash", mobile: null }}
      onCustomerName={() => null}
      onCustomerMobile={() => null}
      orderBar={(openAdd, noteSlot) => <OrderRecorder orders={NO_ORDERS} shopName="Gupta Kirana Store" hasLines onGenerate={noop} onAddByHand={openAdd} noteSlot={noteSlot} />}
      orderEntries={(openAdd, part) => <OrderEntries orders={o} onAddByHand={openAdd} part={part} />}
    />
  );
}

// 13 and History draw "Print bill" only inside the Android app - the sheet shows the app's screen (dev frame only; printing is never run)
if (params.get("frame") && ["13", "15"].includes(params.get("screen") ?? "")) {
  try {
    Object.defineProperty(Capacitor, "isNativePlatform", { value: () => true, configurable: true });
  } catch {
    // left as the web: the sheet then shows no Print button
  }
}

/** 13-BillSaved's own sample: Bill 515, चीनी 2 kg × ₹45, चावल 5 kg ₹340 (rate —), टाटा नमक 1 pc ₹30, दाने 1 kg ₹150 - ₹610, Cash, 1:18 pm */
const SAMPLE_13: readonly [string, number, string, number | null, number][] = [["चीनी", 2, "kg", 45, 90], ["चावल", 5, "kg", null, 340], ["टाटा नमक", 1, "piece", 30, 30], ["दाने", 1, "kg", 150, 150]];
const receipt13 = () => {
  const items = SAMPLE_13.map(([name, qty, unit, rate, total]): ReceiptItem => ({ displayName: name, qty, unit, ratePaise: rate === null ? null : ((rate * 100) as Paise), rateUnit: rate === null ? null : unit, totalPaise: (total * 100) as Paise }));
  const at = "2026-11-11T07:48:00.000Z";
  return buildReceipt({ receiptNumber: "515", customerName: "Cash", totalPaise: items.reduce((s, i) => s + i.totalPaise, 0) as Paise, finalizedAt: at, createdAt: at, status: "final" }, items, { name: "Gupta Kirana Store", phone: null, logoUrl: null, billLanguage: "en" });
};
const READY_SHARE: ReceiptShare = { ready: true, smsText: "", downloadImage: noop, shareImage: noop, downloadPdf: noop, whatsApp: noop, storedMobile: async () => null, sendSms: noop };

function Screen13({ state }: { state: string }) {
  const r = state === "long" ? DEV_PRINT_BILLS.bill514 : receipt13();
  return <BillSavedScreen receipt={r} receiptNumber={r.receiptNumber} share={READY_SHARE} onNewBill={noop} />;
}

/** TODAY's History bill detail on a dev database: Bill 515 saved by the real finaliseBill (and, for "cancelled", cancelled by the real
 *  cancelBillLocal); the list opens the bill as a tap does. */
function Screen15({ state, onReady, sheet25 = false }: { state: string; onReady: () => void; sheet25?: boolean }) {
  const [db, setDb] = useState<KiranaBillDB | null>(null);
  useEffect(() => {
    void (async () => {
      // the headless shot's virtual time does not wait for the browser's IndexedDB - this dev frame keeps its database in memory instead
      // (fake-indexeddb, the tests' own; a dev-only chunk)
      const { IDBFactory, IDBKeyRange } = await import("fake-indexeddb");
      Dexie.dependencies.indexedDB = new IDBFactory();
      Dexie.dependencies.IDBKeyRange = IDBKeyRange;
      const d = new KiranaBillDB("kb-dev-sheet-15");
      const shopId = "11111111-1111-4111-8111-111111111111";
      const deviceId = "22222222-2222-4222-8222-222222222222";
      await d.shops.put({ id: shopId, syncStatus: "synced", name: "Gupta Kirana Store", phone: null, address: null, logoUrl: null, catalogMode: "base_imported", billLanguage: "en", receiptPrefix: null, updatedAt: "2026-11-11T00:00:00.000Z" });
      const lines = SAMPLE_13.map(([name, qty, unit, rate, total], i): FinalLine => {
        const it = item(name, { qty, unit, rate: rate === null ? null : rate * 100, rateUnit: rate === null ? null : unit, total: total * 100, priceType: rate === null ? "total" : "rate" });
        return { id: `l${i}`, utteranceId: 1, item: it, original: it, displayName: name, source: "voice" };
      });
      const localId = crypto.randomUUID();
      await finaliseBill(d, { localId, shopId, deviceId, startedAt: "2026-11-11T07:47:00.000Z", customer: { name: "Cash", mobile: null }, lines, flags: [], serverNumber: "515", now: new Date("2026-11-11T07:48:00.000Z") });
      if (state === "cancelled") await cancelBillLocal(d, { shopId, billLocalId: localId, reason: "wrong_price", deviceId, replacementLocalId: null });
      // KB-414 step 2: a replaced bill - 515 cancelled for a corrected 516, which exists (the detail of 515 says "Replaced by Bill 516")
      if (state === "replaced") {
        const replacementLocalId = crypto.randomUUID();
        await cancelBillLocal(d, { shopId, billLocalId: localId, reason: "wrong_item", deviceId, replacementLocalId });
        await finaliseBill(d, { localId: replacementLocalId, shopId, deviceId, startedAt: "2026-11-11T07:50:00.000Z", customer: { name: "Cash", mobile: null }, lines: lines.slice(0, 2), flags: [], serverNumber: "516", now: new Date("2026-11-11T07:51:00.000Z") });
      }
      setDb(d);
    })();
  }, [state]);
  useEffect(() => {
    if (!db) return;
    const id = window.setInterval(() => {
      const row = [...document.querySelectorAll("button")].find((b) => /515/.test(b.textContent ?? "") && b.closest("li"));
      if (row) {
        row.click();
        window.clearInterval(id);
        // 25: the cancel sheet over the detail, as a tap on "Cancel bill" opens it
        if (sheet25) window.setTimeout(() => [...document.querySelectorAll("button")].find((b) => b.textContent === say("history.cancelButton", {}, getScreenLanguage()))?.click(), 1000);
        window.setTimeout(onReady, sheet25 ? 2200 : 1500); // the detail has loaded its receipt: now the checks may look
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [db]);
  return db ? <HistoryScreen localDb={db} shopId="11111111-1111-4111-8111-111111111111" render={renderReceiptFiles} deviceId="22222222-2222-4222-8222-222222222222" onClose={noop} /> : null;
}

/** KB-414 step 1: 08-Home on a dev database (fake-indexeddb, as 15): 08's two recent bills, today, with their item counts. */
function Screen08({ state, onReady }: { state: string; onReady: () => void }) {
  const [db, setDb] = useState<KiranaBillDB | null>(null);
  useEffect(() => {
    void (async () => {
      const { IDBFactory, IDBKeyRange } = await import("fake-indexeddb");
      Dexie.dependencies.indexedDB = new IDBFactory();
      Dexie.dependencies.IDBKeyRange = IDBKeyRange;
      const d = new KiranaBillDB("kb-dev-sheet-08");
      const shopId = "11111111-1111-4111-8111-111111111111";
      if (state !== "empty") {
        for (const [n, items, total, h, m] of [[514, 38, 221600, 13, 2], [513, 7, 121500, 12, 40]] as const) {
          const t = new Date();
          t.setHours(h, m, 0, 0);
          const localId = crypto.randomUUID();
          await d.bills.add({ localId, shopId, status: "final", syncStatus: "synced", receiptNumber: String(n), receiptNumberSource: "block", customerName: "Cash", customerMobile: null, subtotalPaise: total, totalPaise: total, schemaVersion: 1, deviceId: "d", createdAt: t.toISOString(), finalizedAt: t.toISOString(), syncedAt: null });
          for (let i = 0; i < items; i++) await d.billItems.add({ billLocalId: localId, shopId, lineNo: i + 1, shopProductId: null, displayName: `x${i}` } as never);
        }
      }
      setDb(d);
      window.setTimeout(onReady, 800);
    })();
  }, [state]);
  return db ? (
    <TabFrame tab="home" onTab={noop} offline={state === "offline"}>
      <HomeScreen localDb={db} shopId="11111111-1111-4111-8111-111111111111" shopName="Gupta Kirana Store" now={() => new Date(2026, 10, 16, 9, 30)} onRecord={noop} onType={noop} onOpenBill={noop} onSeeAll={noop} onProfile={noop} />
    </TabFrame>
  ) : null;
}

/** KB-414 step 2: 14-BillsList on a dev database (fake-indexeddb, as 08): 14's five bills today - 512 cancelled, 515 not yet synced. */
function Screen14({ state, onReady }: { state: string; onReady: () => void }) {
  const [db, setDb] = useState<KiranaBillDB | null>(null);
  useEffect(() => {
    void (async () => {
      const { IDBFactory, IDBKeyRange } = await import("fake-indexeddb");
      Dexie.dependencies.indexedDB = new IDBFactory();
      Dexie.dependencies.IDBKeyRange = IDBKeyRange;
      const d = new KiranaBillDB("kb-dev-sheet-14");
      const shopId = "11111111-1111-4111-8111-111111111111";
      await d.syncState.put({ tableName: `bills:${shopId}`, lastSyncedAt: null, cursor: JSON.stringify({ phase: "done", before: null }), pendingCount: 0 });
      const BILLS = [[515, 4, 61000, 13, 18, "pending", "final", "Cash"], [514, 38, 221600, 13, 2, "synced", "final", "Cash"], [513, 7, 121500, 12, 40, "synced", "final", "Ramesh Kumar"], [512, 3, 64000, 12, 5, "synced", "cancelled", "Cash"], [511, 5, 38600, 11, 48, "synced", "final", "Cash"]] as const;
      for (const [n, items, total, h, m, sync, status, customer] of BILLS) {
        const t = new Date();
        t.setHours(h, m, 0, 0);
        const localId = crypto.randomUUID();
        await d.bills.add({ localId, shopId, status, syncStatus: sync, receiptNumber: String(n), receiptNumberSource: "block", customerName: customer, customerMobile: null, subtotalPaise: total, totalPaise: total, schemaVersion: 1, deviceId: "d", createdAt: t.toISOString(), finalizedAt: t.toISOString(), syncedAt: null });
        for (let i = 0; i < items; i++) await d.billItems.add({ billLocalId: localId, shopId, lineNo: i + 1, shopProductId: null, displayName: `x${i}` } as never);
      }
      setDb(d);
      window.setTimeout(onReady, 1200);
    })();
  }, [state]);
  return db ? (
    <TabFrame tab="bills" onTab={noop} offline={false}>
      <HistoryScreen localDb={db} shopId="11111111-1111-4111-8111-111111111111" render={renderReceiptFiles} deviceId="d" onClose={noop} />
    </TabFrame>
  ) : null;
}

/** green only when every count is zero and something was actually checked (0 tap areas = nothing seen = not a pass) */
const SHEET_OK = (c: string) => /outside: 0\b/.test(c) && /clipped: 0\b/.test(c) && /overlapping pairs: 0\b/.test(c) && /by a gap: 0\b/.test(c) && !/Tap areas: 0\b/.test(c) && !/Containment: 0 parts/.test(c);

const FILES: Record<string, string> = {
  "08": "08-Home.html", "14": "14-BillsList.html", "25": "25-CancelBill.html", "09": "09-Recording.html", "10": "10-Review.html", "11": "11-Generating.html", "12": "12-BillReview.html", "13": "13-BillSaved.html", "15": "15-BillDetail.html",
  "23": "23-ReadFailed.html", "24": "24-Offline.html",
};

/** The frame: the screen alone, filling the window; the checks run on it, out of sight (the sheet reads them). */
function Frame() {
  const lang = params.get("lang");
  // screen 15 builds its dev database and opens the bill first - the checks look only once the detail is on screen
  const [ready, setReady] = useState(!["15", "08", "14", "25"].includes(params.get("screen") ?? ""));
  useEffect(() => {
    setScreenLanguage((lang ?? "en") as Language); // always set: the language is remembered between visits
    if (params.get("scale")) document.documentElement.style.fontSize = `${Number(params.get("scale"))}%`;
    // end states, like the design frame - except 09 (the ring mid-pulse) and 11 (the paper printing, the shimmer), which move with the
    // file's; &motion=reduce stops them (the reduced-motion sheet)
    if (!["09", "11", "13"].includes(params.get("screen") ?? "") || params.get("motion") === "reduce") document.documentElement.dataset.motion = "reduce";
    // 09 / 10 are full screens in a portal on <body>: the live checks must see them too
    const tag = window.setInterval(() => {
      for (const el of document.querySelectorAll<HTMLElement>("body > div:not(#root):not([data-kit-part])")) el.dataset.kitPart = `screen ${params.get("screen")}`;
    }, 100);
    window.setTimeout(() => window.clearInterval(tag), 2000);
  }, [lang]);
  return (
    <>
      <main>
        {/* History is a fixed full screen: the part takes the window's height so the checks see it */}
        <div data-kit-part={`screen ${params.get("screen")}`} style={["15", "08", "14", "25"].includes(params.get("screen") ?? "") ? { minHeight: "100dvh" } : undefined}>
          {params.get("screen") === "08" ? <Screen08 state={params.get("state") ?? "home"} onReady={() => setReady(true)} />
            : params.get("screen") === "09" ? <Screen09 state={params.get("state") ?? "recording"} />
            : params.get("screen") === "10" ? <Screen10 state={params.get("state") ?? "review"} />
            : params.get("screen") === "11" ? <Screen11 />
            : params.get("screen") === "23" ? <Screen23 state={params.get("state") ?? "failed"} />
            : params.get("screen") === "24" ? <Screen24 />
            : params.get("screen") === "13" ? <Screen13 state={params.get("state") ?? "saved"} />
            : params.get("screen") === "15" ? <Screen15 state={params.get("state") ?? "history"} onReady={() => setReady(true)} />
            : params.get("screen") === "25" ? <Screen15 state="history" sheet25 onReady={() => setReady(true)} />
            : params.get("screen") === "14" ? <Screen14 state={params.get("state") ?? "list"} onReady={() => setReady(true)} />
            : <Screen12 state={params.get("state") ?? "design"} />}
        </div>
      </main>
      {ready && (
        <div style={{ position: "fixed", left: -9999, top: 0, width: 600 }}>
          <TapAreaCheck />
          <ContainmentCheck />
        </div>
      )}
    </>
  );
}

function Sheet() {
  const screen = params.get("screen") ?? "12";
  const state = params.get("state") ?? "design";
  const w = Number(params.get("w") ?? 390);
  const scale = params.get("scale");
  const lang = params.get("lang");
  const motion = params.get("motion");
  const ours = useRef<HTMLIFrameElement>(null);
  const [checks, setChecks] = useState("checking…");
  useEffect(() => {
    const id = window.setInterval(() => {
      const d = ours.current?.contentDocument;
      const tap = d?.querySelector("[data-tap-check]")?.textContent ?? "";
      const con = d?.querySelector("[data-contain-check]")?.textContent ?? "";
      if (tap && !tap.startsWith("checking") && con && !con.startsWith("checking")) {
        setChecks(`${con} · ${tap}`);
        // both frames' animations stopped at the same moment (0.6 s in), so a pulse (09's ring) is compared like for like
        for (const f of document.querySelectorAll("iframe"))
          for (const a of f.contentDocument?.getAnimations() ?? []) {
            a.pause();
            a.currentTime = Number(params.get("t") ?? 600);
          }
        window.clearInterval(id);
      }
    }, 300);
    return () => window.clearInterval(id);
  }, []);
  const q = new URLSearchParams({ frame: "1", screen, state, ...(scale ? { scale } : {}), ...(lang ? { lang } : {}), ...(motion ? { motion } : {}) });
  const frame = { width: w, height: 844, border: "1px dashed #999", background: "white" } as const;
  return (
    <main style={{ padding: 16, font: "13px system-ui" }}>
      <h1 style={{ font: "700 16px system-ui", margin: "0 0 4px" }}>
        {["08", "14", "15", "16", "17", "19", "21", "25"].includes(screen) ? "KB-414" : "KB-413"} screen {screen} - {state}
        {lang ? ` - ${lang}` : ""} - {w} px{scale ? `, text ${scale}%` : ""}{motion === "reduce" ? " - reduced motion" : ""}
      </h1>
      <p data-sheet-checks style={{ margin: "0 0 10px", color: SHEET_OK(checks) ? "#2a6" : "#b00", fontWeight: 600 }}>{checks}</p>
      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        <div>
          <div style={{ color: "#555", marginBottom: 4 }}>The app (real screen, sample data)</div>
          <iframe ref={ours} title="ours" src={`/__dev/screens?${q}`} style={frame} />
        </div>
        <div>
          <div style={{ color: "#555", marginBottom: 4 }}>Design - docs/design/screens/{FILES[screen]}</div>
          <iframe title="design" src={`/docs/design/screens/${FILES[screen]}`} style={{ ...frame, width: 438, height: 892 }} />
        </div>
      </div>
    </main>
  );
}

export function DevScreens() {
  useEffect(() => {
    document.body.style.background = "var(--color-kb-bg)";
  }, []);
  return params.get("frame") ? <Frame /> : <Sheet />;
}
