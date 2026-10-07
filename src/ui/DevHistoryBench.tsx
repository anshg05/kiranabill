import { useState } from "react";
import { KiranaBillDB, type LocalBill, type LocalBillItem } from "@/data/db";
import { loadRecentRows, loadSearchIndex } from "@/data/history";
import { compileQuery, type SearchEntry } from "@/domain/billSearch";

// DEV ONLY (KB-310, owner): History's load and search times on REAL IndexedDB -
// the laptop, and a REAL phone like D51's type-ahead bench: open
// http://<laptop-ip>:5173/__dev/history from the phone (`npm run dev -- --host`);
// no sign-in. Seeds a SEPARATE throwaway database ("kb310-history-bench") with
// 40,000 bills x 5 items - 100 a day over 400 days, so the last 90 days hold
// 9,000 - measures, then deletes it. Behind import.meta.env.DEV in main.tsx:
// never in `npm run build` (VERIFY greps dist/ for the heading).

const DB_NAME = "kb310-history-bench";
const SHOP = "bench-shop";
const N = 40_000;
const PER_DAY = 100;
const NAMES = ["Chini", "Besan", "Toor Daal", "Parle-G", "Basmati Chawal Premium", "Namak", "Ajwain", "Atta", "Sarson Tel", "Maggi"];
const QUERIES = ["r", "ra", "ram", "ramesh", "ramesh 4/10", "chini", "112.50", "4/10", "142", "basmati chawal", "xyzq"];
const DAY = 86_400_000;

/** A v4 UUID from crypto.getRandomValues: the phone opens this page over plain
 * http://<laptop-ip>:5173 - not a secure context, so Chrome hides
 * crypto.randomUUID there (HTTPS / localhost only). Bench only - the app runs
 * on HTTPS. */
export function benchId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function seed(db: KiranaBillDB): Promise<void> {
  const now = Date.now();
  for (let start = 0; start < N; start += 5_000) {
    const bills: LocalBill[] = [];
    const items: LocalBillItem[] = [];
    for (let i = start; i < Math.min(N, start + 5_000); i++) {
      const at = new Date(now - (i / PER_DAY) * DAY).toISOString();
      const localId = benchId();
      bills.push({ localId, shopId: SHOP, status: "final", syncStatus: "synced", receiptNumber: `KB-${String(N - i).padStart(6, "0")}`, receiptNumberSource: "block", customerName: i % 7 ? "Cash" : `Ramesh ${i % 50}`, customerMobile: null, subtotalPaise: 0, totalPaise: 9000 + (i % 400) * 25, schemaVersion: 1, deviceId: "bench", createdAt: at, finalizedAt: at, syncedAt: at });
      for (let l = 1; l <= 5; l++) items.push({ billLocalId: localId, shopId: SHOP, lineNo: l, shopProductId: null, displayName: NAMES[(i + l) % NAMES.length]!, spokenName: null, qty: 1, unit: "kg", ratePaise: 100, rateUnit: "kg", totalPaise: 100, priceType: "rate", source: "fastpath", reviewFlags: [], wasEdited: false });
    }
    await db.bills.bulkPut(bills);
    await db.billItems.bulkAdd(items);
  }
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

async function time<T>(fn: () => Promise<T>, runs: number): Promise<{ ms: number[]; value: T }> {
  const ms: number[] = [];
  let value!: T;
  for (let r = 0; r < runs; r++) {
    const t0 = performance.now();
    value = await fn();
    ms.push(Math.round(performance.now() - t0));
  }
  return { ms, value };
}

function keystrokes(entries: SearchEntry[]): string {
  for (const q of QUERIES) entries.filter(compileQuery(q)); // warm-up (D35)
  const ms: number[] = [];
  for (let round = 0; round < 7; round++) {
    for (const q of QUERIES) {
      const t0 = performance.now();
      entries.filter(compileQuery(q));
      ms.push(performance.now() - t0);
    }
  }
  const s = [...ms].sort((a, b) => a - b);
  return `median ${median(ms).toFixed(1)} ms · p95 ${s[Math.floor(0.95 * s.length)]!.toFixed(1)} ms · max ${s[s.length - 1]!.toFixed(1)} ms (${ms.length} keystrokes)`;
}

export function DevHistoryBench() {
  const [lines, setLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const log = (l: string) => setLines((ls) => [...ls, l]);

  const run = async () => {
    setBusy(true);
    setLines([]);
    await new KiranaBillDB(DB_NAME).delete();
    const db = new KiranaBillDB(DB_NAME);
    try {
      const s0 = performance.now();
      await seed(db);
      log(`seeded ${N.toLocaleString()} bills x 5 items in ${Math.round(performance.now() - s0)} ms`);
      db.close();
      await db.open();
      const open = await time(() => loadRecentRows(db, SHOP, 200), 3);
      log(`open - newest 200 rows: ${open.ms.join(" / ")} ms`);
      const since = new Date(Date.now() - 90 * DAY).toISOString();
      const recent = await time(() => loadSearchIndex(db, SHOP, since), 3);
      log(`90-day load (${recent.value.length.toLocaleString()} bills): ${recent.ms.join(" / ")} ms`);
      log(`keystroke over ${recent.value.length.toLocaleString()}: ${keystrokes(recent.value)}`);
      const all = await time(() => loadSearchIndex(db, SHOP, null), 2);
      log(`"older" load - every bill (${all.value.length.toLocaleString()}): ${all.ms.join(" / ")} ms`);
      log(`keystroke over ${all.value.length.toLocaleString()}: ${keystrokes(all.value)}`);
    } catch (err) {
      log(`failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      db.close();
      await db.delete();
      log("bench database deleted");
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-[720px] p-4 text-[15px] text-ink">
      <h1 className="text-[20px] font-semibold">History bench (dev only)</h1>
      <p className="mt-1 text-[13px] text-ink-soft">{navigator.userAgent}</p>
      <button type="button" disabled={busy} onClick={() => void run()} className="mt-3 min-h-11 rounded-[6px] bg-ink px-4 font-semibold text-surface disabled:opacity-50">
        {busy ? "Running…" : `Run (${N.toLocaleString()} bills)`}
      </button>
      <pre className="mt-3 whitespace-pre-wrap font-mono text-[13px]">{lines.join("\n")}</pre>
    </main>
  );
}
