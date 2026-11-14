import { useEffect, useRef, useState, type ReactNode } from "react";
import { render, type Language, type MessageId } from "@/domain/messages";
import { Button } from "./kit/Button";
import { Badge } from "./kit/Badge";
import { AddChip, ChoiceChip, FilterChip, RemovableChip } from "./kit/Chip";
import { ToggleRow } from "./kit/Toggle";
import { Segmented } from "./kit/Segmented";
import { Stepper } from "./kit/Stepper";
import { SearchField, TextField } from "./kit/TextField";
import { KB_ICONS } from "./kit/icons";

// DEV ONLY (KB-412, /__dev/kit): every kit part in every state.
//   ?view=compare - each part beside the SAME element cropped live from its docs/design/ screen (the file is named), at the same
//                   width, both with motion off (the owner's review sheet, D110 item 9).
//   default       - the kit alone at the window's width (screenshots at 360 / 390 / 430); ?scale=130 = the phone's bigger text;
//                   ?motion=reduce = reduced motion; ?lang=hi|hl = the catalog's real words for the parts that have them.

const params = new URLSearchParams(window.location.search);
const LANG = (["en", "hi", "hl"].includes(params.get("lang") ?? "") ? params.get("lang") : "en") as Language;
const t = (id: MessageId) => render(id, {}, LANG);

/** How to find the drawn element in a screen file: the element whose own text (or aria-label) is `text`, then `up` parents. */
type Find = { file: string; text: string; up?: number };

type Part = { name: string; find: Find; ours: () => ReactNode };

const noop = () => {};

function Stateful<T>({ start, children }: { start: T; children: (v: T, set: (v: T) => void) => ReactNode }) {
  const [v, set] = useState(start);
  return <>{children(v, set)}</>;
}

const PARTS: Part[] = [
  { name: "Button / primary 54, icon 20", find: { file: "18-Printer.html", text: "Test print" },
    ours: () => <Button variant="primary" icon={KB_ICONS.Printer} iconSize={20}>Test print</Button> },
  { name: "Button / primary 56, icon after", find: { file: "06-ShopSetup.html", text: "Continue" },
    ours: () => <Button variant="primary" height={56} icon={KB_ICONS.ArrowRight} iconSize={20} iconEnd>Continue</Button> },
  { name: "Button / secondary 58 + primary 58 (Pause / Stop)", find: { file: "09-Recording.html", text: "Stop", up: 1 },
    ours: () => (
      <div className="flex gap-3">
        <Button variant="secondary" height={58} icon={KB_ICONS.Pause} iconSize={20} className="flex-1">Pause</Button>
        <Button variant="primary" height={58} icon={KB_ICONS.Square} iconSize={20} className="flex-[1.4]">Stop</Button>
      </div>
    ) },
  { name: "Button / primary 54 (Sparkles)", find: { file: "10-Review.html", text: "Generate bill" },
    ours: () => <Button variant="primary" icon={KB_ICONS.Sparkles} iconSize={20}>Generate bill</Button> },
  { name: "Button / secondary 50 pair", find: { file: "10-Review.html", text: "Re-record", up: 1 },
    ours: () => (
      <div className="flex gap-[10px]">
        <Button variant="secondary" icon={KB_ICONS.RotateCcw} className="flex-1">Re-record</Button>
        <Button variant="secondary" icon={KB_ICONS.Keyboard} className="flex-1">Type instead</Button>
      </div>
    ) },
  { name: "Button / secondary 52 pair", find: { file: "22-PrinterSearch.html", text: "Search again", up: 1 },
    ours: () => (
      <div className="flex gap-[10px] pt-3 px-4 pb-6">
        <Button variant="secondary" height={52} icon={KB_ICONS.Bluetooth} className="flex-1">Bluetooth settings</Button>
        <Button variant="secondary" height={52} icon={KB_ICONS.RefreshCw} className="flex-1">Search again</Button>
      </div>
    ) },
  { name: "Button / secondary 56 (More) + locked (Bill Banao)", find: { file: "12-BillReview.html", text: "Bill Banao", up: 1 },
    ours: () => (
      <div className="flex gap-[10px]">
        <Button variant="secondary" height={56} icon={KB_ICONS.Mic} iconSize={19} fill={false} className="px-[18px]">More</Button>
        <Button variant="locked" className="flex-1">Bill Banao</Button>
      </div>
    ) },
  { name: "Button / tertiary", find: { file: "25-CancelBill.html", text: "Keep Bill 514" },
    ours: () => <Button variant="tertiary">Keep Bill 514</Button> },
  { name: "Button / destructive (fill)", find: { file: "25-CancelBill.html", text: "Cancel & make corrected bill" },
    ours: () => <Button variant="destructive" icon={KB_ICONS.RotateCcw} iconSize={20}>Cancel &amp; make corrected bill</Button> },
  { name: "Button / destructive (outline)", find: { file: "17-More.html", text: "Sign out" },
    ours: () => <Button variant="destructive-outline" icon={KB_ICONS.LogOut}>Sign out</Button> },
  { name: "Button / destructive (text)", find: { file: "15-BillDetail.html", text: "Cancel & make a corrected bill" },
    ours: () => <Button variant="destructive-text" icon={KB_ICONS.RotateCcw}>Cancel &amp; make a corrected bill</Button> },
  { name: "Badge / draft", find: { file: "12-BillReview.html", text: "Draft · not saved" }, ours: () => <Badge kind="draft">Draft · not saved</Badge> },
  { name: "Badge / saved", find: { file: "15-BillDetail.html", text: "Saved" }, ours: () => <Badge kind="saved">Saved</Badge> },
  { name: "Badge / almost done", find: { file: "06-ShopSetup.html", text: "Almost done" }, ours: () => <Badge kind="almost">Almost done</Badge> },
  { name: "Badge / recording", find: { file: "09-Recording.html", text: "Recording" }, ours: () => <Badge kind="recording">Recording</Badge> },
  { name: "Badge / small", find: { file: "07-Permissions.html", text: "Required" }, ours: () => <Badge kind="small">Required</Badge> },
  { name: "Filter chips", find: { file: "14-BillsList.html", text: "Today", up: 1 },
    ours: () => (
      <Stateful start="Today">
        {(v, set) => (
          <div className="flex gap-2 overflow-hidden pt-3 px-4 pb-1">
            {["Today", "Yesterday", "This week", "Pick dates"].map((c) => <FilterChip key={c} selected={v === c} onClick={() => set(c)}>{c}</FilterChip>)}
          </div>
        )}
      </Stateful>
    ) },
  { name: "Choice chips (the look only - the app keeps its 5 cancel reasons, D110 8.4)", find: { file: "25-CancelBill.html", text: "Wrong item", up: 1 },
    ours: () => (
      <Stateful start="Wrong item">
        {(v, set) => (
          <div className="flex flex-wrap gap-2">
            {["Wrong item", "Wrong price", "Customer returned", "Other"].map((c) => <ChoiceChip key={c} selected={v === c} onClick={() => set(c)}>{c}</ChoiceChip>)}
          </div>
        )}
      </Stateful>
    ) },
  { name: "Removable chips + add chip", find: { file: "19-AddItem.html", text: "Add name", up: 1 },
    ours: () => (
      <div className="flex flex-wrap gap-2">
        {["तुअर दाल", "toor dal", "अरहर"].map((c) => <RemovableChip key={c} removeLabel={`Remove ${c}`} onRemove={noop}>{c}</RemovableChip>)}
        <AddChip onClick={noop}>Add name</AddChip>
      </div>
    ) },
  { name: "Toggle row / off with a sub-line", find: { file: "18-Printer.html", text: "Print after Bill Banao", up: 2 },
    ours: () => <Stateful start={false}>{(v, set) => <ToggleRow label="Print after Bill Banao" sub="Prints by itself when the bill is saved" checked={v} onChange={set} divider />}</Stateful> },
  { name: "Toggle row / on", find: { file: "18-Printer.html", text: "Show shop phone", up: 2 },
    ours: () => <Stateful<boolean> start={true}>{(v, set) => <ToggleRow label="Show shop phone" checked={v} onChange={set} divider />}</Stateful> },
  { name: "Stepper (in its row)", find: { file: "18-Printer.html", text: "Copies", up: 1 },
    ours: () => (
      <Stateful start={1}>
        {(v, set) => (
          <div className="font-kb flex items-center gap-3 min-h-[58px] px-[14px]">
            <div className="flex-1 text-kb-15 font-semibold text-kb-ink">Copies</div>
            <Stepper value={v} min={1} max={5} onChange={set} decreaseLabel="Fewer copies" increaseLabel="More copies" />
          </div>
        )}
      </Stateful>
    ) },
  { name: "Segmented control", find: { file: "18-Printer.html", text: "58 mm · 2 inch", up: 1 },
    ours: () => (
      <Stateful start="58">
        {(v, set) => <Segmented label="Paper size" value={v} onChange={set} options={[{ value: "58", label: "58 mm · 2 inch" }, { value: "80", label: "80 mm · 3 inch" }]} />}
      </Stateful>
    ) },
  { name: "Text field / ₹ prefix + helper (19)", find: { file: "19-AddItem.html", text: "Price per kg", up: 1 },
    ours: () => <Stateful start="150">{(v, set) => <TextField label="Price per kg" prefix="₹" helper="Fills in when you don’t say a price." value={v} onChange={set} inputMode="decimal" />}</Stateful> },
  { name: "Text field / focused, leading icon (06)", find: { file: "06-ShopSetup.html", text: "Shop name", up: 1 },
    ours: () => <Stateful start="Gupta Kirana Store">{(v, set) => <TextField label="Shop name" icon={KB_ICONS.Store} height={54} value={v} onChange={set} />}</Stateful> },
  { name: "Text field / +91 prefix, note after the label (06)", find: { file: "06-ShopSetup.html", text: "+91", up: 2 },
    ours: () => <Stateful start="">{(v, set) => <TextField label="Phone" labelNote="· optional, printed on bills" prefix="+91" height={54} placeholder="98765 43210" value={v} onChange={set} inputMode="tel" />}</Stateful> },
  { name: "Search field", find: { file: "14-BillsList.html", text: "Search bill number, item or amount", up: 1 },
    ours: () => <Stateful start="">{(v, set) => <div className="pt-[6px] px-4"><SearchField label="Search bill number, item or amount" placeholder="Search bill number, item or amount" value={v} onChange={set} /></div>}</Stateful> },
];

/** The drawn element: own text (direct text nodes) or aria-label equals `text`, deepest first. */
function findIn(doc: Document, f: Find): HTMLElement | null {
  const all = [...doc.body.querySelectorAll<HTMLElement>("*")].reverse();
  const own = (el: HTMLElement) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
  let el = all.find((e) => own(e) === f.text) ?? all.find((e) => e.getAttribute("aria-label") === f.text) ?? null;
  for (let i = 0; el && i < (f.up ?? 0); i++) el = el.parentElement;
  return el;
}

function DesignCrop({ find, onWidth }: { find: Find; onWidth: (w: number) => void }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [missing, setMissing] = useState(false);
  const onLoad = async () => {
    const doc = ref.current?.contentDocument;
    if (!doc) return;
    const style = doc.createElement("style");
    style.textContent = "*{animation:none!important;transition:none!important}"; // the end states, like ours
    doc.head.appendChild(style);
    await doc.fonts.ready;
    const el = findIn(doc, find);
    if (!el) return setMissing(true);
    const r = el.getBoundingClientRect();
    setBox({ x: r.left, y: r.top, w: r.width, h: r.height });
    onWidth(r.width);
  };
  return (
    <div style={{ width: box?.w ?? 360, height: box?.h ?? 60, overflow: "hidden", position: "relative", outline: "1px dashed #999" }}>
      <iframe
        ref={ref}
        title={find.file}
        src={`/docs/design/screens/${find.file}`}
        onLoad={() => void onLoad()}
        style={{ position: "absolute", left: -(box?.x ?? 0), top: -(box?.y ?? 0), width: 438, height: 892, border: 0, pointerEvents: "none" }}
      />
      {missing && <p style={{ color: "red" }}>not found: {find.text}</p>}
    </div>
  );
}

function CompareRow({ part }: { part: Part }) {
  const [w, setW] = useState<number | null>(null);
  const oursRef = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState("");
  useEffect(() => {
    if (w === null) return;
    const id = window.setTimeout(() => {
      const o = oursRef.current?.firstElementChild?.getBoundingClientRect();
      const d = oursRef.current?.closest("section")?.querySelector("iframe")?.parentElement?.getBoundingClientRect();
      if (!o || !d) return;
      const same = Math.abs(o.width - d.width) < 0.6 && Math.abs(o.height - d.height) < 0.6;
      setSizes(`kit ${o.width.toFixed(1)} x ${o.height.toFixed(1)} · design ${d.width.toFixed(1)} x ${d.height.toFixed(1)} px · ${same ? "same size" : "DIFFERENT SIZE"}`);
    }, 800);
    return () => window.clearTimeout(id);
  }, [w]);
  return (
    <section style={{ padding: "14px 0", borderBottom: "1px solid #ccc" }}>
      <h2 style={{ font: "600 13px system-ui", margin: "0 0 8px" }}>
        {part.name} <span style={{ fontWeight: 400, color: "#555" }}>- docs/design/screens/{part.find.file}</span>
        <span style={{ display: "block", fontWeight: 400, color: sizes.includes("DIFFERENT") ? "#b00" : "#2a6" }}>{sizes}</span>
      </h2>
      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        <div>
          <div style={{ font: "11px system-ui", color: "#555", marginBottom: 4 }}>KB kit</div>
          <div ref={oursRef} style={{ width: w ?? 360, outline: "1px dashed #999" }}>{part.ours()}</div>
        </div>
        <div>
          <div style={{ font: "11px system-ui", color: "#555", marginBottom: 4 }}>Design (cropped, same size)</div>
          <DesignCrop find={part.find} onWidth={setW} />
        </div>
      </div>
    </section>
  );
}

/** The real catalog words in the chosen language, for the parts that have them today (Devanagari check). */
function LanguageSample() {
  return (
    <div className="flex flex-col gap-3">
      <Button variant="primary" icon={KB_ICONS.Printer} iconSize={20}>{t("settings.testPrint")}</Button>
      <Segmented label={t("settings.paper")} value="58" onChange={noop} options={[{ value: "58", label: t("settings.paper58") }, { value: "80", label: t("settings.paper80") }]} />
      <div className="flex gap-2 flex-wrap">
        <Badge kind="saved">{t("settings.saved")}</Badge>
        <Badge kind="draft">{t("order.paused")}</Badge>
        <Badge kind="small">{t("need.price")}</Badge>
      </div>
      <SearchField label={t("history.search")} placeholder={t("history.search")} value="" onChange={noop} />
      <Button variant="secondary" icon={KB_ICONS.Bluetooth}>{t("settings.printerChoose")}</Button>
      <div className="flex gap-2 flex-wrap">
        {["चीनी", "चावल", "टाटा नमक", "लाइज़ॉल"].map((c) => <RemovableChip key={c} removeLabel={c} onRemove={noop}>{c}</RemovableChip>)}
      </div>
    </div>
  );
}

export function DevKitGallery() {
  const compare = params.get("view") === "compare";
  useEffect(() => {
    if (params.get("scale")) document.documentElement.style.fontSize = `${Number(params.get("scale"))}%`;
    if (compare || params.get("motion") === "reduce") document.documentElement.dataset.motion = "reduce";
    document.body.style.background = "var(--color-kb-bg)";
    // 06-ShopSetup draws "Shop name" focused - show ours focused too
    const id = window.setTimeout(() => document.querySelector<HTMLInputElement>('input[value="Gupta Kirana Store"]')?.focus(), 300);
    return () => window.clearTimeout(id);
  }, [compare]);

  if (compare) {
    return (
      <main style={{ padding: 16, maxWidth: 820 }}>
        <h1 style={{ font: "700 16px system-ui" }}>KB-412 batch a - kit beside the approved design (D110 item 9)</h1>
        {PARTS.slice(Number(params.get("from") ?? 0), Number(params.get("to") ?? PARTS.length)).map((p) => <CompareRow key={p.name} part={p} />)}
      </main>
    );
  }
  return (
    // ?w= - the page width in px (headless Edge will not open a window narrower than about 500 px)
    <main className="font-kb text-kb-ink px-4 py-4 flex flex-col gap-5" style={params.get("w") ? { width: Number(params.get("w")), boxSizing: "border-box" } : undefined}>
      <h1 className="text-kb-18 font-bold">Kit - batch a ({LANG}{params.get("w") ? `, ${params.get("w")} px` : ""}{params.get("scale") ? `, text ${params.get("scale")}%` : ""}{params.get("motion") ? ", reduced motion" : ""})</h1>
      {PARTS.map((p) => (
        <section key={p.name} className="flex flex-col gap-2">
          <h2 className="text-kb-12 font-bold text-kb-sub uppercase tracking-[.5px]">{p.name}</h2>
          <div>{p.ours()}</div>
        </section>
      ))}
      <section className="flex flex-col gap-2">
        <h2 className="text-kb-12 font-bold text-kb-sub uppercase tracking-[.5px]">Catalog words ({LANG})</h2>
        <LanguageSample />
      </section>
    </main>
  );
}
