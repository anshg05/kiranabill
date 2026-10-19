import { useEffect, useRef, useState, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { useBackEntry } from "./useBackEntry";

// KB-342: the ≡ menu (Escape and Back come from useBackEntry). It was a native <details>, which closes only when ≡ is tapped again: it stayed open over the Add
// item panel, after the mic, the mobile field or any tap elsewhere. Now it closes on a tap outside, on choosing an item,
// on Escape and Android Back, and whenever something else opens (`closeWhen`: a panel, a sheet, a dialog, the mic).
// aria-expanded follows it; focus goes back to ≡ on Escape, Back and a choice - not on an outside tap, which must leave
// the focus where the shopkeeper tapped (a field, the mic).

export interface MenuItem {
  readonly key: string;
  readonly label: string;
  readonly onSelect: () => void;
}

/** The open menu: owns the outside-tap, Escape and Back listeners, so none are live while it is closed. */
function MenuList({ items, onChoose, onDismiss, containerRef }: { items: readonly MenuItem[]; onChoose: (item: MenuItem) => void; onDismiss: (refocus: boolean) => void; containerRef: React.RefObject<HTMLDivElement | null> }) {
  useBackEntry("kbMenu", () => onDismiss(true));
  useEffect(() => {
    const outside = (e: Event) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) onDismiss(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [containerRef, onDismiss]);
  return (
    <div id="header-menu-list" className="absolute right-0 z-10 mt-1 min-w-40 rounded-[6px] border border-line bg-surface py-1">
      {items.map((item) => (
        <button key={item.key} type="button" onClick={() => onChoose(item)} className="block min-h-11 w-full px-4 text-left">
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function HeaderMenu({ label, items, closeWhen }: { label: string; items: readonly MenuItem[]; closeWhen: boolean }): ReactNode {
  const [wanted, setOpen] = useState(false);
  const open = wanted && !closeWhen; // with a panel open (or the mic running) a tap on ≡ does nothing - never expanded, never stacked
  const container = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const dismiss = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };
  // Never open beside another panel: when one opens (or the mic starts) the menu goes.
  useEffect(() => {
    if (closeWhen) setOpen(false);
  }, [closeWhen]);
  return (
    <div ref={container} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? "header-menu-list" : undefined}
        onClick={() => !closeWhen && setOpen((o) => !o)}
        className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-ink-soft"
      >
        <Menu size={20} strokeWidth={1.5} aria-hidden />
      </button>
      {open && (
        <MenuList
          items={items}
          containerRef={container}
          onDismiss={dismiss}
          onChoose={(item) => {
            dismiss(true);
            item.onSelect();
          }}
        />
      )}
    </div>
  );
}
