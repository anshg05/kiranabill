import { useCallback, useEffect, useState } from "react";
import { listColdStarts, loadGateInputs, type ReconcileResult } from "@/data/billMetrics";
import type { LocalReviewCapture } from "@/data/db";
import { clearReviewCapture, isReviewCaptureOn, listReviewCapture, setReviewCapture } from "@/data/reviewCapture";
import type { KiranaBillDB } from "@/data/db";
import { WINDOW_BILLS, gateReport, median, percentile, type GateReport, type Spread } from "@/domain/billMetrics";
import { formatRupees } from "@/domain/money";

// KB-404 (docs/07-DECISIONS.md D80): the release gate's lines, the four budgets, "no bill lost or corrupted" and the review
// capture (S2), for the owner in Developer mode. Text, never alarming colours: it says plainly what meets a target, what does
// not and when it has too little to say. Read-only over the measurements - nothing here can change a bill.

const TARGET_TURNS = 1;
const TARGET_COVERAGE = 60;
const TARGET_ZERO_EDIT = 80;
const BUDGET_MS = { stop: 1500, fast: 300, llm: 4000, finalise: 500, cold: 2000, number: 300 } as const;

const ms = (v: number): string => {
  if (v < 1000) return `${Math.round(v)} ms`;
  const s = v / 1000;
  return Number.isInteger(s) ? `${s} s` : `${s.toFixed(1)} s`;
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const heading = "text-[13px] font-medium tracking-[0.02em] text-ink-soft";

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-0.5 [overflow-wrap:anywhere]">
      <span className="font-medium">{label}</span>
      <span className="text-ink-soft">{children}</span>
    </li>
  );
}

const meets = (ok: boolean | null) => (ok === null ? "no data yet" : ok ? "meets the target" : "above the target");
const budgetLine = (spread: Spread, budget: number) =>
  spread.n === 0 ? `budget < ${ms(budget)} · no samples yet` : `budget < ${ms(budget)} · median ${ms(spread.median!)} · p95 ${ms(spread.p95!)} · ${plural(spread.n, "sample", "samples")}`;

interface Props {
  localDb: KiranaBillDB;
  shopId: string;
  /** Asks the server about this phone's bills (needs a live session). Absent = no button. */
  reconcile?: () => Promise<ReconcileResult>;
}

export function PilotNumbers({ localDb, shopId, reconcile }: Props) {
  const [report, setReport] = useState<GateReport | null>(null);
  const [cold, setCold] = useState<{ ms: number }[]>([]);
  const [pairs, setPairs] = useState<{ capture: LocalReviewCapture; receipt: string | null }[]>([]);
  const [reviewOn, setReviewOn] = useState(false);
  const [check, setCheck] = useState<ReconcileResult | "asking" | null>(null);

  const load = useCallback(async () => {
    const { inputs, cancellations } = await loadGateInputs(localDb, shopId);
    setReport(gateReport(inputs, cancellations));
    setCold(await listColdStarts(localDb));
    setReviewOn(await isReviewCaptureOn(localDb, shopId));
    const captures = await listReviewCapture(localDb, shopId);
    const bills = await localDb.bills.bulkGet(captures.map((c) => c.billLocalId));
    setPairs(captures.slice(0, 50).map((capture, i) => ({ capture, receipt: bills[i]?.receiptNumber ?? null })));
  }, [localDb, shopId]);

  useEffect(() => {
    load().catch((err: unknown) => console.warn("[pilot] load failed:", err instanceof Error ? err.name : "error"));
  }, [load]);

  const runCheck = async () => {
    if (!reconcile) return;
    setCheck("asking");
    try {
      setCheck(await reconcile());
    } catch {
      setCheck({ checked: 0, problems: [], asked: false });
    }
  };

  if (!report) return <section aria-label="Pilot numbers" />;
  const r = report;
  const coldSpread: Spread = { median: median(cold.map((c) => c.ms)), p95: percentile(cold.map((c) => c.ms), 95), n: cold.length };
  const voiceOf = (s: number) => (s === 0 ? "No eligible voice bills yet" : `${plural(s, "voice bill", "voice bills")} in the window`);

  return (
    <section aria-label="Pilot numbers" className="flex flex-col gap-4">
      <div>
        <h4 className={heading}>Pilot numbers</h4>
        <p className="mt-1 text-[13px] text-ink-soft">
          The last {WINDOW_BILLS} eligible voice bills of this shop, from every phone. Cancelled bills and their replacements are left out.
        </p>
        <p className="mt-1 font-medium">{voiceOf(r.voice.n)}</p>
      </div>

      <ul className="flex flex-col gap-3">
        <Line label="Median turns to bill">
          {r.turns.median === null ? "—" : r.turns.median} · target {TARGET_TURNS} · {meets(r.turns.median === null ? null : r.turns.median <= TARGET_TURNS)}
        </Line>
        <Line label="Fast-path coverage">
          {r.coverage.pct === null ? "—" : `${r.coverage.pct}%`} · {r.coverage.fastpath} fast of {r.coverage.fastpath + r.coverage.llm} read ({r.coverage.failed} failed, counted apart) · target {TARGET_COVERAGE}% ·{" "}
          {meets(r.coverage.pct === null ? null : r.coverage.pct >= TARGET_COVERAGE)}
        </Line>
        <Line label="Zero-edit bills">
          {r.zeroEdit.pct === null ? "—" : `${r.zeroEdit.pct}%`} ({r.zeroEdit.zero} of {r.zeroEdit.of}) · target {TARGET_ZERO_EDIT}% · {meets(r.zeroEdit.pct === null ? null : r.zeroEdit.pct >= TARGET_ZERO_EDIT)}
        </Line>
        <Line label="Bills with hand-added lines">{r.zeroEdit.needingHands} (not in the two lines above)</Line>
        <Line label="Voice vs typing">
          Voice {r.seconds.voice.median === null ? "—" : `${r.seconds.voice.median} s`} ({plural(r.seconds.voice.n, "bill", "bills")}) · Typing {r.seconds.typed.median === null ? "—" : `${r.seconds.typed.median} s`} ({plural(r.seconds.typed.n, "bill", "bills")}) ·{" "}
          {r.seconds.verdict}
        </Line>
        <Line label="Escaped errors">{r.escapedErrors} · target 0 (bills cancelled for a wrong item, price or quantity)</Line>
        <Line label="Silent number errors">Not measured by the app - read the Heard → Billed pairs below (turn on Review mode for the pilot).</Line>
      </ul>

      <div>
        <h4 className={heading}>Budgets</h4>
        <ul className="mt-1 flex flex-col gap-3">
          <Line label="Stop → transcript">{budgetLine(r.latency.stopToTranscript, BUDGET_MS.stop)}</Line>
          <Line label="Fast-path item on screen">{budgetLine(r.latency.fastpathToItems, BUDGET_MS.fast)}</Line>
          <Line label="LLM-path item on screen">{budgetLine(r.latency.llmToItems, BUDGET_MS.llm)}</Line>
          <Line label="Finalise → receipt">{budgetLine(r.finaliseToReceipt, BUDGET_MS.finalise)}</Line>
          <Line label="Bill number from the server (part of the line above)">{budgetLine(r.number, BUDGET_MS.number)} · only bills that got a server number</Line>
          <Line label="App cold start">{budgetLine(coldSpread, BUDGET_MS.cold)} (this phone)</Line>
        </ul>
      </div>

      <div>
        <h4 className={heading}>No bill lost or corrupted</h4>
        {reconcile ? (
          <>
            <button type="button" onClick={() => void runCheck()} disabled={check === "asking"} className="mt-1 min-h-11 rounded-[6px] border border-line bg-surface px-4 font-medium disabled:opacity-50">
              Check this phone&apos;s bills
            </button>
            {check === "asking" && <p className="mt-1 text-ink-soft">Asking the server…</p>}
            {check && check !== "asking" && !check.asked && <p className="mt-1">Couldn&apos;t ask the server — nothing is claimed either way</p>}
            {check && check !== "asking" && check.asked && (
              <>
                <p className="mt-1">
                  {check.checked === 0
                    ? "No bills made on this phone yet - nothing to check"
                    : check.problems.length === 0
                    ? `${plural(check.checked, "bill", "bills")} checked: every one is on the server with the same number, total and item count`
                    : `${plural(check.checked, "bill", "bills")} checked: ${check.problems.length} with a problem`}
                </p>
                {check.problems.length > 0 && (
                  <ul className="mt-1 flex flex-col gap-1">
                    {check.problems.map((p) => (
                      <li key={p.receiptNumber} className="[overflow-wrap:anywhere]">
                        Bill {p.receiptNumber}: {p.problems.join("; ")}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </>
        ) : (
          <p className="mt-1 text-ink-soft">Needs a live session.</p>
        )}
      </div>

      <div>
        <h4 className={heading}>Review mode</h4>
        <label className="mt-1 flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            role="switch"
            aria-label="Review mode"
            checked={reviewOn}
            onChange={(e) =>
              void setReviewCapture(localDb, shopId, e.target.checked)
                .then(load)
                .catch((err: unknown) => console.warn("[pilot] could not switch Review mode:", err instanceof Error ? err.name : "error"))
            }
            className="size-5"
          />
          <span>{reviewOn ? "On" : "Off"}</span>
        </label>
        <p className="text-[13px] text-ink-soft">
          While it is on, what you say and what is billed are kept on this phone only, never sent or backed up, deleted after 30 days and when you sign out. A badge shows on the billing screen.
        </p>
        <button type="button" onClick={() => void clearReviewCapture(localDb, shopId).then(load)} className="mt-1 min-h-11 rounded-[6px] border border-line bg-surface px-4 font-medium">
          Clear now
        </button>
        {pairs.length === 0 ? (
          <p className="mt-2 text-ink-soft">No heard / billed pairs yet</p>
        ) : (
          <ul aria-label="Heard and billed" className="mt-2 flex flex-col gap-2">
            {pairs.map(({ capture: c, receipt }) => (
              <li key={c.id} className="rounded-[6px] border border-line px-3 py-2 [overflow-wrap:anywhere]">
                <span className="text-[13px] text-ink-soft">{receipt === null ? "bill not saved" : `Bill ${receipt}`} · </span>
                Heard: “{c.transcript}” → Billed:{" "}
                {c.lines.length === 0 ? "nothing added" : c.lines.map((l) => `${l.name} ${l.qty ?? "—"}${l.unit ? ` ${l.unit}` : ""} = ${l.total === null ? "—" : formatRupees(l.total)}`).join("; ")}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
