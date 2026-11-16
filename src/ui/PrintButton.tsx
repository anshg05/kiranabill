import { useState } from "react";
import { Button } from "./kit/Button";
import { KB_ICONS } from "./kit/icons";
import type { Receipt } from "@/domain/receipt";
import { isNativeApp } from "@/data/nativeSignIn";
import { PRINT_FAILURE_TEXT, usePrint, type PrintState } from "./usePrint";
import { useT } from "./useT";

// KB-408 S5 (owner, 13 Nov 2026): Print, next to Share on a saved bill and in History - inside the Android app only.
// A reprint is marked (owner, D110 item 8.10): after Bill Banao the first finished copy is the original, every later one says
// REPRINT; from History every copy does.

/** 13-BillSaved's "Print bill" (KB-413 step 4) and 15-BillDetail's "Reprint" (KB-414 step 2): the primary button, the printer icon. */
export function PrintButton(props: { receipt: Receipt; firstIsOriginal: boolean }) {
  return isNativeApp() ? <PrintButtonInApp {...props} /> : null;
}

function PrintButtonInApp({ receipt, firstIsOriginal }: { receipt: Receipt; firstIsOriginal: boolean }) {
  const { t } = useT();
  const { state, print } = usePrint();
  const [printedOnce, setPrintedOnce] = useState(false);
  const busy = state.kind === "printing";
  const onPrint = () => {
    if (busy) return;
    const reprint = !firstIsOriginal || printedOnce;
    void print(reprint ? { ...receipt, reprint: "REPRINT" } : receipt).then((ok) => {
      if (ok) setPrintedOnce(true);
    });
  };
  return (
    <div>
      <Button variant="primary" icon={KB_ICONS.Printer} iconSize={20} ariaDisabled={busy} onClick={onPrint}>
        {t(firstIsOriginal ? "print.bill" : "print.reprint")}
      </Button>
      <PrintStatus state={state} />
    </div>
  );
}

/** The print's progress, result or failure - shared with Settings' Test print. */
export function PrintStatus({ state }: { state: PrintState }) {
  const { t } = useT();
  if (state.kind === "printing")
    return (
      <div className="mt-2">
        <p role="status" className="text-center text-[13px] text-ink-soft tabular-nums">
          {t("print.printing", { percent: state.percent })}
        </p>
        <div className="mt-1 h-1 w-full overflow-hidden rounded bg-line" aria-hidden>
          <div className="h-full bg-ink" style={{ width: `${state.percent}%` }} />
        </div>
      </div>
    );
  if (state.kind === "done")
    return (
      <p role="status" className="mt-2 text-center text-[13px] text-ok">
        {t("print.done")}
      </p>
    );
  if (state.kind === "failed")
    return (
      <p role="alert" className="mt-2 text-center text-[13px] text-danger">
        {t(PRINT_FAILURE_TEXT[state.failure])}
      </p>
    );
  return null;
}
