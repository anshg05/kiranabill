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
import { BILL_514, DEV_PRINT_BILLS } from "./devPrintBills";
import { BillSavedScreen } from "./BillSavedScreen";
import { HistoryScreen } from "./HistoryScreen";
import { renderReceiptFiles } from "./receiptImage";
import type { ReceiptShare } from "./useReceiptShare";
import { HomeScreen } from "./HomeScreen";
import { TabFrame } from "./AppTabs";
import { CatalogScreen } from "./CatalogScreen";
import { MoreScreen } from "./MoreScreen";
import { SignedOutFlow } from "./WelcomeScreens";
import { PleaseUpdate } from "./PleaseUpdate";
import { VersionGateProvider } from "./VersionGate";
import { OnboardingScreen } from "./OnboardingScreen";
import { AuthProvider } from "@/providers/AuthProvider";
import { ShopProvider } from "@/providers/ShopProvider";
import { DeviceDB } from "@/data/device";
import type { MorePage } from "./MorePages";

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
    // KB-429: the Add item sheet (an old-look part), opened and searched as a tap and typing do
    if (state !== "additem" || opened.current) return;
    opened.current = true;
    window.setTimeout(() => {
      [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === say("add.title", {}, getScreenLanguage()))?.click();
      window.setTimeout(() => {
        const box = document.querySelector<HTMLInputElement>("input[type=search]");
        if (!box) return;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(box, "दाल");
        box.dispatchEvent(new Event("input", { bubbles: true }));
      }, 200);
    }, 50);
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
if (params.get("frame") && ["13", "15", "17", "18", "21", "01", "02", "03", "04", "05"].includes(params.get("screen") ?? "")) {
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
      // "long": the owner's real Bill 514 (38 lines) - the receipt scrolls above the footer (KB-414 step 2 phone check)
      const sample = state === "long" ? BILL_514.map(([name, qty, unit, rate, total, rateUnit]) => [name, qty, unit, rate, total, rateUnit ?? unit] as const) : SAMPLE_13.map(([name, qty, unit, rate, total]) => [name, qty, unit, rate, total, unit] as const);
      const lines = sample.map(([name, qty, unit, rate, total, rateUnit], i): FinalLine => {
        const it = item(name, { qty, unit: unit ?? undefined, rate: rate === null ? null : rate * 100, rateUnit: rate === null ? null : rateUnit, total: total * 100, priceType: rate === null ? "total" : "rate" });
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
  // KB-414 step 2 phone check (owner, 17 Nov 2026): inside the REAL tab frame, as the app draws it - the nav was missing here, so the
  // checks passed while the phone's nav covered 15's footer
  return db ? (
    <TabFrame tab="bills" onTab={noop} offline={params.get("offline") === "1"}>
      <HistoryScreen localDb={db} shopId="11111111-1111-4111-8111-111111111111" render={renderReceiptFiles} deviceId="22222222-2222-4222-8222-222222222222" onClose={noop} />
    </TabFrame>
  ) : null;
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

/** KB-414 step 3: 16-Items / 19-AddItem on a dev database (fake-indexeddb, as 14): 16's six items, as drawn (the app's units), inside
 *  the REAL tab frame. The states are reached as a tap reaches them:
 *  16: all | banner (with what the bills taught: 2 prices, 1 new name, 1 learned name) | learned | archived | undo (after Archive)
 *      | sheet (B: "+ Add") | bills (C: "From your bills")
 *  19: add (19's own sample: तूर दाल, its other names, kg, ₹150) | adderror (a name already used, no unit, no price) | edit (E) */
function Screen16({ state, onReady }: { state: string; onReady: () => void }) {
  const [db, setDb] = useState<KiranaBillDB | null>(null);
  const shopId = "11111111-1111-4111-8111-111111111111";
  useEffect(() => {
    void (async () => {
      const { IDBFactory, IDBKeyRange } = await import("fake-indexeddb");
      Dexie.dependencies.indexedDB = new IDBFactory();
      Dexie.dependencies.IDBKeyRange = IDBKeyRange;
      const d = new KiranaBillDB("kb-dev-sheet-16");
      const ITEMS = [
        ["sugar", "चीनी", ["Sugar", "शक्कर"], "kg", 4_500, "learned"], ["rice", "चावल", ["Rice"], "kg", 6_800, "base"],
        ["salt", "टाटा नमक", ["Tata Salt"], "piece", 3_000, "learned"], ["toor", "तूर दाल", ["Toor dal", "तुअर"], "kg", 15_000, "base"],
        ["dane", "दाने", ["Moongfali dana"], "kg", 15_000, "custom"], ["rin", "रिन साबुन", ["Rin soap", "रिन"], "piece", 1_000, "custom"],
        ["old", "पुराना साबुन", ["purana sabun"], "piece", 2_500, "custom"],
      ] as const;
      // 19's own sample adds तूर दाल - not in the list behind it then, or its name and "toor dal" would clash
      // learnedempty: no learned names and no item the app added from bills (टाटा नमक is one) - the Learned chip's empty text
      for (const [id, name, aliases, unit, price, source] of ITEMS.filter(([id]) => !(state === "add" && id === "toor") && !(state === "learnedempty" && id === "salt")))
        // learnednone: the owner's phone - no learned names AND no item the app added from bills
        await d.shopProducts.put({ id, shopId, baseProductId: null, displayName: name, category: null, unit, pricePaise: price, aliases: [...aliases], source: state === "learnednone" && source === "learned" ? "custom" : source, useCount: 0, sku: null, barcode: null, isActive: id !== "old" });
      // ready: the owner's ready catalog is ~370 items - 400 here (KB-414 step 3 phone check: every item, no cap)
      if (state === "ready")
        await d.baseProducts.bulkPut(Array.from({ length: 400 }, (_, i) => ({ id: `b${i}`, catalogVersion: 1, displayName: `${["चना", "मूंग", "उड़द", "मसूर", "राजमा", "पोहा", "सूजी", "मैदा"][i % 8]} ${Math.floor(i / 8) + 1}`, sourceCategory: "grain", guardCategory: "grain", defaultUnit: "kg", suggestedPricePaise: 5_000 + i * 10, aliases: [], isActive: true })));
      if (state === "banner" || state === "bills" || state === "learned") {
        const now = new Date().toISOString();
        for (const [p, paise] of [["sugar", 4_800], ["rice", 7_000]] as const)
          for (let i = 0; i < 3; i++) await d.priceObservations.put({ localId: crypto.randomUUID(), shopId, syncStatus: "synced", shopProductId: p, observedPricePaise: paise, occurredAt: now, updatedAt: now, deviceId: "d" });
        await d.provisionalProducts.put({ localId: crypto.randomUUID(), shopId, syncStatus: "synced", spokenName: "काजू", seenCount: 2, suggestedUnit: null, suggestedPricePaise: null, promotedAt: null, promotedShopProductId: null, updatedAt: now, deviceId: "d" });
        for (let i = 0; i < 3; i++)
          await d.learningEvents.add({ localId: `e${i}`, shopId, syncStatus: "synced", billLocalId: "", eventType: "alias_confirmed", payload: { alias: "cheeni", shop_product_id: "sugar", source_layer: "fastpath" }, createdAt: new Date(Date.now() - 1000 * (10 - i)).toISOString(), updatedAt: now, deviceId: "d" });
      }
      setDb(d);
    })();
  }, [state]);
  useEffect(() => {
    if (!db) return;
    const say16 = (id: Parameters<typeof say>[0], p: Record<string, string | number> = {}) => say(id, p, getScreenLanguage());
    const button = (re: RegExp | string) => [...document.querySelectorAll<HTMLElement>("button")].find((b) => (typeof re === "string" ? b.textContent?.trim() === re || b.getAttribute("aria-label") === re : re.test(b.textContent ?? "")));
    const set = (el: HTMLInputElement | null | undefined, v: string) => {
      if (!el) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const field = (label: string) => {
      const l = [...document.querySelectorAll("label")].find((x) => x.textContent?.trim() === label);
      return l ? (document.getElementById(l.htmlFor) as HTMLInputElement | null) : null;
    };
    const steps: (() => void)[] = [];
    const later = (f: () => void) => steps.push(f);
    if (state === "learned" || state === "learnedempty" || state === "learnednone") later(() => button(say16("catalog.learned"))?.click());
    if (state === "ready") {
      later(() => button(say16("common.add"))?.click());
      later(() => button(new RegExp(say16("catalog.addReady")))?.click());
    }
    if (state === "archived") later(() => button(say16("catalog.archived"))?.click());
    if (state === "sheet") later(() => button(say16("common.add"))?.click());
    // KB-429: the Import page (an old-look part)
    if (state === "import") {
      later(() => button(say16("common.add"))?.click());
      later(() => button(new RegExp(say16("catalog.import")))?.click());
    }
    if (state === "bills") later(() => button(new RegExp(say16("items.fromBills")))?.click());
    if (state === "undo") {
      later(() => button(say16("catalog.editLabel", { name: "रिन साबुन" }))?.click());
      later(() => button(say16("product.archiveLabel"))?.click());
    }
    if (state === "edit") later(() => button(say16("catalog.editLabel", { name: "तूर दाल" }))?.click());
    if (state === "add" || state === "adderror") {
      later(() => button(say16("common.add"))?.click());
      later(() => button(new RegExp(say16("items.newItem")))?.click());
      if (state === "add") {
        later(() => set(field(say16("product.name")), "तूर दाल"));
        for (const n of ["तुअर दाल", "toor dal", "अरहर"]) {
          later(() => button(say16("items.addName"))?.click());
          later(() => {
            const el = document.querySelector<HTMLInputElement>(`input[aria-label="${say16("items.otherName")}"]`);
            set(el, n);
            el?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
          });
        }
        later(() => [...document.querySelectorAll<HTMLElement>('[role="radio"]')].find((r) => r.textContent === "kg")?.click());
        later(() => set(field(say16("items.pricePer", { unit: "kg" })), "150"));
        later(() => (document.activeElement as HTMLElement | null)?.blur());
      } else {
        later(() => set(field(say16("product.name")), "चीनी"));
        later(() => button(say16("items.save"))?.click());
      }
    }
    let i = 0;
    let loaded = false;
    const id = window.setInterval(() => {
      // the list has loaded (once - a step may leave no card on screen: the Learned chip with nothing learned)
      if (!loaded && !document.querySelector("[data-testid=name]")) return;
      loaded = true;
      const step = steps[i++];
      if (step) return step();
      window.clearInterval(id);
      window.setTimeout(onReady, 900);
    }, 250);
    return () => window.clearInterval(id);
  }, [db]);
  const ok = async () => ({ ok: true }) as const;
  return db ? (
    <TabFrame tab="items" onTab={noop} offline={params.get("offline") === "1"}>
      <CatalogScreen
        localDb={db}
        shopId={shopId}
        save={ok}
        add={ok}
        importRows={async () => ({ added: 0, alreadyThere: 0, failed: [], notSent: 0, stopReason: null })}
        saveDetails={ok}
        setActive={async (id, active) => (await db.shopProducts.update(id, { isActive: active }), { ok: true })}
        create={ok}
        ignoreSuggestion={async () => {}}
        removeAlias={async () => {}}
        onChanged={noop}
        onClose={noop}
      />
    </TabFrame>
  ) : null;
}

/** KB-414 step 4: 17-More and its inner pages on a dev database (fake-indexeddb, as 16), inside the REAL tab frame, as the Android app
 *  shows them (the Printer row is there; a saved printer "BT-SRT-58"):
 *  17: more | signout (2 bills not on the server + a bill in progress: the warning) | shop (Edit shop details) | language | sync (failing:
 *      2 waiting, 1 stuck) | developer (learned names, a price suggestion, a said-not-in-items name)
 *  18: printer (the Printer page, 58 mm) · 21: bill (Bill design) */
function Screen17({ state, onReady }: { state: string; onReady: () => void }) {
  const [db, setDb] = useState<KiranaBillDB | null>(null);
  const shopId = "11111111-1111-4111-8111-111111111111";
  useEffect(() => {
    void (async () => {
      const { IDBFactory, IDBKeyRange } = await import("fake-indexeddb");
      Dexie.dependencies.indexedDB = new IDBFactory();
      Dexie.dependencies.IDBKeyRange = IDBKeyRange;
      try {
        localStorage.setItem("kb.printer.v1", JSON.stringify({ device: { id: "AA:BB", name: "BT-SRT-58", kind: "classic", printerLike: true }, dots: 384, compat: false }));
      } catch {
        // no storage: the Printer row says "No printer chosen"
      }
      const d = new KiranaBillDB("kb-dev-sheet-17");
      const now = new Date().toISOString();
      await d.shops.put({ id: shopId, syncStatus: "synced", name: "Gupta Kirana Store", phone: "9876543210", address: null, logoUrl: null, catalogMode: "base_imported", billLanguage: "en", receiptPrefix: "KB", updatedAt: now });
      for (const [id, name, unit, price] of [["sugar", "चीनी", "kg", 4_500], ["rice", "चावल", "kg", 6_800], ["salt", "टाटा नमक", "piece", 3_000]] as const)
        await d.shopProducts.put({ id, shopId, baseProductId: null, displayName: name, category: null, unit, pricePaise: price, aliases: [], source: "custom", useCount: 0, sku: null, barcode: null, isActive: true });
      for (let i = 0; i < 3; i++)
        await d.learningEvents.add({ localId: `e${i}`, shopId, syncStatus: "synced", billLocalId: "", eventType: "alias_confirmed", payload: { alias: "cheeni", shop_product_id: "sugar", source_layer: "fastpath" }, createdAt: new Date(Date.now() - 1000 * (10 - i)).toISOString(), updatedAt: now, deviceId: "d" });
      await d.learnedAliases.put({ localId: "la1", shopId, syncStatus: "synced", alias: "cheeni", shopProductId: "sugar", hitCount: 3, confidence: 0.9, source: "confirmation", updatedAt: now, deviceId: "d" });
      for (let i = 0; i < 3; i++) await d.priceObservations.put({ localId: `po${i}`, shopId, syncStatus: "synced", shopProductId: "rice", observedPricePaise: 7_000, occurredAt: now, updatedAt: now, deviceId: "d" });
      await d.provisionalProducts.put({ localId: "pp1", shopId, syncStatus: "synced", spokenName: "काजू", seenCount: 2, suggestedUnit: null, suggestedPricePaise: null, promotedAt: null, promotedShopProductId: null, updatedAt: now, deviceId: "d" });
      setDb(d);
    })();
  }, []);
  useEffect(() => {
    if (!db) return;
    let clicked = state !== "signout";
    const id = window.setInterval(() => {
      if (!document.querySelector("[data-scroll-page]")) return;
      if (!clicked) {
        clicked = true;
        [...document.querySelectorAll<HTMLElement>("button")].find((b) => b.textContent === say("menu.signout", {}, getScreenLanguage()))?.click();
        return;
      }
      window.clearInterval(id);
      window.setTimeout(onReady, 900);
    }, 250);
    return () => window.clearInterval(id);
  }, [db]);
  const page: MorePage | undefined = ({ shop: "shop", printer: "printer", bill: "billDesign", language: "language", sync: "sync", developer: "developer" } as const)[state as "shop"];
  const sync =
    state === "sync"
      ? { chip: { kind: "failing" as const, label: "Sync failing" }, unsynced: { pending: 2, conflict: 1 }, detail: { pending: 2, conflict: 1, lastAttemptAt: new Date().toISOString() } }
      : state === "signout"
        ? { chip: null, unsynced: { pending: 2, conflict: 0 }, detail: { pending: 2, conflict: 0, lastAttemptAt: null } }
        : { chip: null, unsynced: { pending: 0, conflict: 0 }, detail: { pending: 0, conflict: 0, lastAttemptAt: null } };
  return db ? (
    <TabFrame tab="more" onTab={noop} offline={params.get("offline") === "1"}>
      <MoreScreen localDb={db} shopId={shopId} deviceId="d" sync={sync} billInProgress={state === "signout"} onSignOut={noop} onItems={noop} onClose={noop} initialPage={page} />
    </TabFrame>
  ) : null;
}

/** Sign in needs the sign-in provider around it; the dev sheets keep their own device database */
const DEV_DEVICE_DB = new DeviceDB("kb-dev-sheet-auth");

/** KB-415: the first-time flow, as the Android app shows it (the printing chips are there). 01-04 the splash and onboarding pages, 05 Sign
 *  in, 06 Shop setup - setup (06's sample typed in: Gupta Kirana Store, 98765 43210) | error (a 5-digit phone, then Use ready catalog). */
function Screen06({ state, onReady }: { state: string; onReady: () => void }) {
  const deviceDb = DEV_DEVICE_DB;
  useEffect(() => {
    const set = (label: RegExp, v: string) => {
      const l = [...document.querySelectorAll("label")].find((x) => label.test(x.textContent ?? ""));
      const el = l ? (document.getElementById(l.htmlFor) as HTMLInputElement | null) : null;
      if (!el) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const say06 = (id: Parameters<typeof say>[0]) => say(id, {}, getScreenLanguage());
    const steps = [
      () => set(new RegExp(`^${say06("settings.shopName")}$`), "Gupta Kirana Store"),
      () => set(new RegExp(`^${say06("onboard.phoneLabel")}`), state === "error" ? "12345" : "98765 43210"),
      ...(state === "error" ? [() => [...document.querySelectorAll<HTMLElement>("button")].find((b) => b.textContent === say06("onboard.ready"))?.click()] : []),
      () => (document.activeElement as HTMLElement | null)?.blur(),
    ];
    let i = 0;
    const id = window.setInterval(() => {
      if (!document.querySelector("label")) return;
      const step = steps[i++];
      if (step) return step();
      window.clearInterval(id);
      window.setTimeout(onReady, 900);
    }, 250);
    return () => window.clearInterval(id);
  }, []);
  return (
    <AuthProvider deviceDb={deviceDb}>
      <ShopProvider userId={null} online={false} deviceDb={deviceDb}>
        <OnboardingScreen />
      </ShopProvider>
    </AuthProvider>
  );
}

/** green only when every count is zero and something was actually checked (0 tap areas = nothing seen = not a pass) */
const SHEET_OK = (c: string) =>
  /outside: 0\b/.test(c) && /clipped: 0\b/.test(c) && /overlapping pairs: 0\b/.test(c) && /by a gap: 0\b/.test(c) && !/Tap areas: 0\b/.test(c) && !/Containment: 0 parts/.test(c) &&
  /covered: 0\b/.test(c) && /unreachable: 0\b/.test(c) && !/Reach: 0 checked/.test(c);

/**
 * KB-414 step 2 phone check (owner + reviewer, 17 Nov 2026): the nav covered 15's "Cancel bill" on the phone while every check passed.
 * Every control and every piece of words on the screen must be REACHABLE and UNCOVERED: at its centre the topmost thing must be itself
 * (or inside it) - not the nav, a fixed footer, the offline strip or anything else. One that is off screen or covered right now is
 * scrolled into view (centred, as far as its scrolling boxes go) and looked at again; still covered = "covered", still off screen =
 * "unreachable". Scroll positions are put back after each. While a modal is open only what is inside the top one counts (the rest is
 * under it by design); inert, screen-reader-only and moving things are skipped.
 */
function ReachCheck() {
  const [text, setText] = useState("checking reach…");
  useEffect(() => {
    const id = window.setTimeout(() => {
      const modals = [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')];
      const modal = modals[modals.length - 1];
      // every box that clips: a finger scrolls only an auto / scroll one - scrollIntoView moves a hidden one too, and that is no reach
      const scrollers = [...document.querySelectorAll<HTMLElement>("*")].filter((e) => getComputedStyle(e).overflow !== "visible");
      const saved = () => ({ x: window.scrollX, y: window.scrollY, at: scrollers.map((e) => [e.scrollLeft, e.scrollTop] as const) });
      const restore = (p: ReturnType<typeof saved>) => {
        scrollers.forEach((e, i) => ((e.scrollLeft = p.at[i]![0]), (e.scrollTop = p.at[i]![1])));
        window.scrollTo(p.x, p.y);
      };
      const words = (e: Element) => [...e.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
      const cands = [...document.querySelectorAll<HTMLElement>("[data-kit-part] *")].filter((e) => {
        if (!(e instanceof HTMLElement) || e.closest("[inert], .sr-only, [aria-hidden='true'], [data-clip-ok]") || e.getAnimations().length) return false;
        if (modal && !modal.contains(e)) return false;
        const r = e.getBoundingClientRect();
        if (!r.width || !r.height || getComputedStyle(e).visibility === "hidden") return false;
        return e.matches("button, a[href], input, select, textarea, [role='button'], [role='radio'], label") || words(e);
      });
      const name = (e: Element) => `${e.tagName.toLowerCase()} "${(e.getAttribute("aria-label") ?? e.textContent ?? "").trim().slice(0, 20)}"`;
      // at the centre the topmost thing is the element, inside it, or holds it (an icon inside a button); a neighbour's tap area (its
      // ::before) reaching over it is the tap-area check's business, not cover
      const clear = (e: HTMLElement) => {
        const r = e.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return "off";
        // hidden by a clipping / scrolling box (outside it, or the box squeezed to nothing) is out of sight, whatever is on top there
        for (let c = e.parentElement; c && c !== document.body; c = c.parentElement) {
          if (getComputedStyle(c).overflow === "visible") continue;
          const k = c.getBoundingClientRect();
          if (x < k.left - 0.5 || x > k.right + 0.5 || y < k.top - 0.5 || y > k.bottom + 0.5) return "off";
        }
        const top = document.elementFromPoint(x, y);
        if (!top || e.contains(top) || top.contains(e)) return "ok";
        const t = top.getBoundingClientRect();
        if (x < t.left || x > t.right || y < t.top || y > t.bottom) return "ok";
        return `under ${name(top)}`;
      };
      const covered: string[] = [];
      const unreachable: string[] = [];
      for (const e of cands) {
        let seen = clear(e);
        if (seen === "ok") continue;
        const before = saved();
        e.scrollIntoView({ block: "center", inline: "nearest" });
        // reached only if every box that moved is one a finger can scroll that way
        const byHand = scrollers.every((c, i) => {
          const cs = getComputedStyle(c);
          return (c.scrollTop === before.at[i]![1] || /auto|scroll/.test(cs.overflowY)) && (c.scrollLeft === before.at[i]![0] || /auto|scroll/.test(cs.overflowX));
        });
        seen = byHand ? clear(e) : "off";
        restore(before);
        if (seen === "off") unreachable.push(name(e));
        else if (seen !== "ok") covered.push(`${name(e)} ${seen}`);
      }
      setText(`Reach: ${cands.length} checked · covered: ${covered.length}${covered.length ? " - " + covered.slice(0, 4).join("; ") : ""} · unreachable: ${unreachable.length}${unreachable.length ? " - " + unreachable.slice(0, 4).join("; ") : ""}`);
    }, 3200);
    return () => window.clearTimeout(id);
  }, []);
  return <p data-reach-check style={{ font: "600 12px system-ui" }}>{text}</p>;
}

const FILES: Record<string, string> = {
  "08": "08-Home.html", "14": "14-BillsList.html", "01": "01-Main.html", "02": "02-Onboarding.html", "03": "03-Onboarding.html", "04": "04-Onboarding.html", "05": "05-SignIn.html", "06": "06-ShopSetup.html",
  "16": "16-Items.html", "17": "17-More.html", "18": "18-Printer.html", "19": "19-AddItem.html", "21": "21-BillDesign.html", "25": "25-CancelBill.html", "09": "09-Recording.html", "10": "10-Review.html", "11": "11-Generating.html", "12": "12-BillReview.html", "13": "13-BillSaved.html", "15": "15-BillDetail.html",
  "23": "23-ReadFailed.html", "24": "24-Offline.html",
};

/** The frame: the screen alone, filling the window; the checks run on it, out of sight (the sheet reads them). */
function Frame() {
  const lang = params.get("lang");
  // screen 15 builds its dev database and opens the bill first - the checks look only once the detail is on screen
  const [ready, setReady] = useState(!["15", "08", "14", "25", "16", "19", "17", "18", "21", "06"].includes(params.get("screen") ?? ""));
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
        <div data-kit-part={`screen ${params.get("screen")}`} style={["15", "08", "14", "25", "16", "19", "17", "18", "21", "01", "02", "03", "04", "05", "06"].includes(params.get("screen") ?? "") ? { minHeight: "100dvh" } : undefined}>
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
            : params.get("screen") === "16" ? <Screen16 state={params.get("state") ?? "all"} onReady={() => setReady(true)} />
            : params.get("screen") === "19" ? <Screen16 state={params.get("state") ?? "add"} onReady={() => setReady(true)} />
            : ["01", "02", "03", "04", "05"].includes(params.get("screen") ?? "") ? (
                <AuthProvider deviceDb={DEV_DEVICE_DB}>
                  <SignedOutFlow start={({ "01": 0, "02": 1, "03": 2, "04": 3, "05": 4 } as const)[params.get("screen") as "01"]} />
                </AuthProvider>
              )
            : params.get("screen") === "update" ? (
                // D116: "Please update" (state url = an Update address, ask = none yet); the waiting-bills line needs a shop's database
                <VersionGateProvider applies appVersionCode={1} fetcher={() => Promise.resolve({ minVersionCode: 2, updateUrl: params.get("state") === "ask" ? null : "https://play.google.com/store/apps/details?id=com.kiranavoicebill.app" })}>
                  <PleaseUpdate localDb={null} />
                </VersionGateProvider>
              )
            : params.get("screen") === "06" ? <Screen06 state={params.get("state") ?? "setup"} onReady={() => setReady(true)} />
            : ["17", "18", "21"].includes(params.get("screen") ?? "") ? <Screen17 state={params.get("state") ?? "more"} onReady={() => setReady(true)} />
            : <Screen12 state={params.get("state") ?? "design"} />}
        </div>
      </main>
      {ready && (
        <div style={{ position: "fixed", left: -9999, top: 0, width: 600 }}>
          <TapAreaCheck />
          <ContainmentCheck />
          <ReachCheck />
        </div>
      )}
    </>
  );
}

function Sheet() {
  const screen = params.get("screen") ?? "12";
  const state = params.get("state") ?? "design";
  const w = Number(params.get("w") ?? 390);
  // KB-414 (owner, 17 Nov 2026): the page's height - in the app the page is the screen minus the status bar and the system bar
  const h = Number(params.get("h") ?? 844);
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
      const reach = d?.querySelector("[data-reach-check]")?.textContent ?? "";
      if (tap && !tap.startsWith("checking") && con && !con.startsWith("checking") && reach && !reach.startsWith("checking")) {
        setChecks(`${con} · ${tap} · ${reach}`);
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
  const offline = params.get("offline");
  const q = new URLSearchParams({ frame: "1", screen, state, ...(scale ? { scale } : {}), ...(lang ? { lang } : {}), ...(motion ? { motion } : {}), ...(offline ? { offline } : {}) });
  const frame = { width: w, height: h, border: "1px dashed #999", background: "white" } as const;
  return (
    <main style={{ padding: 16, font: "13px system-ui" }}>
      <h1 style={{ font: "700 16px system-ui", margin: "0 0 4px" }}>
        {["01", "02", "03", "04", "05", "06"].includes(screen) ? "KB-415" : ["08", "14", "15", "16", "17", "18", "19", "21", "25"].includes(screen) ? "KB-414" : "KB-413"} screen {screen} - {state}
        {lang ? ` - ${lang}` : ""} - {w} x {h} px{scale ? `, text ${scale}%` : ""}{motion === "reduce" ? " - reduced motion" : ""}
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
