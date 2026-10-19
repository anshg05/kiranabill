import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SyncChip, Unsynced } from "./syncChip";
import { useBackEntry } from "./useBackEntry";
import { useT } from "./useT";

// KB-313 (05 §7, 16 §2): the header chip, and the two inline confirmations (sign out with unsynced bills,
// Clear bill). A chip is a status - plain text, tappable only when amber - never a dialog in billing's way.

export const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const CHIP_STYLE: Record<SyncChip["kind"], string> = {
  offline: "border-line text-ink-soft",
  syncing: "border-line text-ink-soft",
  nosession: "border-warn text-warn",
  failing: "border-warn text-warn",
};

export function SyncChipView({ chip, detail }: { chip: SyncChip | null; detail?: { pending: number; conflict: number; lastAttemptAt: string | null } }) {
  const [open, setOpen] = useState(false);
  const { t, tx } = useT();
  if (!chip) return null;
  const style = `min-w-0 rounded-[6px] border px-2 py-0.5 text-[13px] leading-tight ${CHIP_STYLE[chip.kind]}`;
  if (chip.kind !== "failing") {
    return (
      <span data-testid="sync-chip" className={style}>
        {tx(chip.label)}
      </span>
    );
  }
  return (
    <>
      <button type="button" data-testid="sync-chip" aria-haspopup="dialog" onClick={() => setOpen(true)} className={`${style} min-h-11`}>
        {tx(chip.label)}
      </button>
      {open && (
        <Overlay label={t("sync.label")} role="dialog" onClose={() => setOpen(false)}>
          <div className="flex flex-col gap-2">
            {detail && detail.pending > 0 && (
              <p>{t(detail.pending === 1 ? "sync.pending.one" : "sync.pending.many", { n: detail.pending })}</p>
            )}
            {detail && detail.conflict > 0 && (
              <p>{t(detail.conflict === 1 ? "sync.conflict.one" : "sync.conflict.many", { n: detail.conflict })}</p>
            )}
            {detail?.lastAttemptAt && <p className="text-[13px] text-ink-soft">{t("sync.lastTried", { time: timeOf(detail.lastAttemptAt) })}</p>}
            <p className="font-medium">{t("sync.continues")}</p>
          </div>
          <div className="mt-3 flex justify-end">
            <button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-[6px] border border-line bg-paper px-4 font-medium">
              {t("common.close")}
            </button>
          </div>
        </Overlay>
      )}
    </>
  );
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/**
 * KB-342: a modal dialog that behaves like one - Android Back and Escape close it (useBackEntry, like every sheet), so does
 * a tap on the dim backdrop; focus moves inside (the first button - Cancel / Close, never the destructive one) and Tab
 * stays inside; aria-modal tells a screen reader the rest of the page is behind it.
 */
function Overlay({ label, role, onClose, children }: { label: string; role: "dialog" | "alertdialog"; onClose: () => void; children: ReactNode }) {
  useBackEntry("kbDialog", onClose);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>("button")?.focus();
    return () => previous?.focus?.();
  }, []);
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 px-4"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={box}
        role={role}
        aria-modal="true"
        aria-label={label}
        onKeyDown={(e) => {
          if (e.key !== "Tab") return;
          const buttons = [...(box.current?.querySelectorAll<HTMLElement>("button") ?? [])];
          const first = buttons[0];
          const last = buttons[buttons.length - 1];
          if (!first || !last) return;
          if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
          else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
        }}
        className="w-full max-w-sm rounded-[6px] border border-line bg-surface p-4 text-[15px] text-ink"
      >
        {children}
      </div>
    </div>
  );
}

export interface Confirmation {
  title: string;
  lines: string[];
}

/** 16 §2: before signing out with unsynced bills - the count, and a separate truthful line for bills that will never sync on their own. */
export function signOutWarning(unsynced: Unsynced, hasBillInProgress: boolean): Confirmation {
  const lines: string[] = [];
  const { pending, conflict } = unsynced;
  if (pending > 0) {
    lines.push(
      `${pending} ${plural(pending, "bill hasn't", "bills haven't")} reached the server yet — ${plural(pending, "it'll", "they'll")} stay on this phone and sync when you sign back in.`,
    );
  }
  if (conflict > 0) {
    lines.push(`${conflict} ${plural(conflict, "bill couldn't", "bills couldn't")} be saved to the server and won't sync on its own — ${plural(conflict, "it stays", "they stay")} on this phone.`);
  }
  if (hasBillInProgress) lines.push("Your bill in progress stays on this phone too.");
  return { title: "Sign out?", lines };
}

export function clearBillWarning(lineCount: number): Confirmation {
  return { title: "Clear this bill?", lines: [`${lineCount} ${plural(lineCount, "line", "lines")} will be removed — nothing is saved.`] };
}

export function ConfirmDialog({ title, lines, confirmLabel, onCancel, onConfirm }: Confirmation & { confirmLabel: string; onCancel: () => void; onConfirm: () => void }) {
  const { t, tx } = useT();
  return (
    <Overlay label={tx(title)} role="alertdialog" onClose={onCancel}>
      <h2 className="text-[17px] font-semibold">{tx(title)}</h2>
      <div className="mt-2 flex flex-col gap-2">
        {lines.map((l) => (
          <p key={l}>{tx(l)}</p>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className="min-h-11 rounded-[6px] border border-line bg-paper px-4 font-medium">
          {t("common.cancel")}
        </button>
        <button type="button" onClick={onConfirm} className="min-h-11 rounded-[6px] border border-danger px-4 font-medium text-danger">
          {confirmLabel}
        </button>
      </div>
    </Overlay>
  );
}
