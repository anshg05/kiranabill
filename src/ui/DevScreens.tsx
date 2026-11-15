import { useEffect, useRef, useState } from "react";
import type { ParsedItem } from "@/domain/grammar";
import type { LocalVoiceRecording } from "@/data/db";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { setScreenLanguage } from "./screenLanguage";
import { useT } from "./useT";
import type { Language } from "@/domain/messages";
import { BillView } from "./BillingScreen";
import { OrderEntries, OrderRecorder } from "./VoiceOrderPanel";
import { RecordOverlay, RecordingBody, ReviewBody } from "./RecordScreens";
import type { ShownFlag } from "./useBillLines";
import { ContainmentCheck, TapAreaCheck } from "./DevKitGallery";

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
      onSignOut={noop}
      onEdit={() => null}
      onRemove={noop}
      onAcknowledge={noop}
      onFinalise={noop}
      catalog={SEED_PARSER_CATALOG}
      onAddByHand={noop}
      onChangeProduct={noop}
      onOpenHistory={noop}
      onOpenCatalog={noop}
      onOpenSettings={noop}
      customer={{ name: "Cash", mobile: null }}
      onCustomerName={() => null}
      onCustomerMobile={() => null}
      orderBar={(openAdd) => <OrderRecorder hasLines onGenerate={noop} onAddByHand={openAdd} />}
      orderEntries={(openAdd, part) => <OrderEntries orders={o} onAddByHand={openAdd} part={part} />}
    />
  );
}

function Screen09({ state }: { state: string }) {
  const { t } = useT();
  const [asking, setAsking] = useState(state === "discard");
  const paused = state === "paused" || state === "discard";
  return (
    <RecordOverlay screenKey="rec" title={t("rec.title")} asking={asking} onAsk={() => setAsking(true)} onKeep={() => setAsking(false)} onDiscard={noop}>
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
    <RecordOverlay screenKey="review" title={t("review.title")} asking={asking} onAsk={() => setAsking(true)} onKeep={() => setAsking(false)} onDiscard={noop}>
      <ReviewBody url={url} ms={state === "limit" ? 300_000 : 42_000} {...(state === "limit" ? { stopped: "limit" as const } : {})} onGenerate={noop} onRerecord={noop} onTypeInstead={noop} />
    </RecordOverlay>
  );
}

const FILES: Record<string, string> = { "09": "09-Recording.html", "10": "10-Review.html", "12": "12-BillReview.html" };

/** The frame: the screen alone, filling the window; the checks run on it, out of sight (the sheet reads them). */
function Frame() {
  const lang = params.get("lang");
  useEffect(() => {
    setScreenLanguage((lang ?? "en") as Language); // always set: the language is remembered between visits
    if (params.get("scale")) document.documentElement.style.fontSize = `${Number(params.get("scale"))}%`;
    document.documentElement.dataset.motion = "reduce"; // end states, like the design frame
  }, [lang]);
  return (
    <>
      <main>
        <div data-kit-part={`screen ${params.get("screen")}`}>
          {params.get("screen") === "09" ? <Screen09 state={params.get("state") ?? "recording"} />
            : params.get("screen") === "10" ? <Screen10 state={params.get("state") ?? "review"} />
            : <Screen12 state={params.get("state") ?? "design"} />}
        </div>
      </main>
      <div style={{ position: "fixed", left: -9999, top: 0, width: 600 }}>
        <TapAreaCheck />
        <ContainmentCheck />
      </div>
    </>
  );
}

function Sheet() {
  const screen = params.get("screen") ?? "12";
  const state = params.get("state") ?? "design";
  const w = Number(params.get("w") ?? 390);
  const scale = params.get("scale");
  const lang = params.get("lang");
  const ours = useRef<HTMLIFrameElement>(null);
  const [checks, setChecks] = useState("checking…");
  useEffect(() => {
    const id = window.setInterval(() => {
      const d = ours.current?.contentDocument;
      const tap = d?.querySelector("[data-tap-check]")?.textContent ?? "";
      const con = d?.querySelector("[data-contain-check]")?.textContent ?? "";
      if (tap && !tap.startsWith("checking") && con && !con.startsWith("checking")) {
        setChecks(`${con} · ${tap}`);
        window.clearInterval(id);
      }
    }, 300);
    return () => window.clearInterval(id);
  }, []);
  const q = new URLSearchParams({ frame: "1", screen, state, ...(scale ? { scale } : {}), ...(lang ? { lang } : {}) });
  const frame = { width: w, height: 844, border: "1px dashed #999", background: "white" } as const;
  return (
    <main style={{ padding: 16, font: "13px system-ui" }}>
      <h1 style={{ font: "700 16px system-ui", margin: "0 0 4px" }}>
        KB-413 screen {screen} - {state}
        {lang ? ` - ${lang}` : ""} - {w} px{scale ? `, text ${scale}%` : ""}
      </h1>
      <p style={{ margin: "0 0 10px", color: checks.includes("outside: 0") && checks.includes("overlapping pairs: 0") ? "#2a6" : "#b00", fontWeight: 600 }}>{checks}</p>
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
