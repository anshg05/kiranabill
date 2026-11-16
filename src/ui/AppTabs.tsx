import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { BottomNav } from "./kit/BottomNav";
import { OfflineStrip } from "./kit/Banner";
import { KB_ICONS } from "./kit/icons";
import { useBackEntry } from "./useBackEntry";
import { useT } from "./useT";

// KB-414 step 1 (owner + reviewer, 16 Nov 2026; plan defaults): the bottom nav replaces the ≡ menu. Home, Bills, Items and More are
// screens over the bill (as History, Catalog and Settings were): the bill - and a recording on it - stays as it is under them. The bill
// (12) is reached from Home (record, Type items) and has its own Back arrow to Home; the nav is not on it (26 §6).

export type Tab = "home" | "bill" | "bills" | "items" | "more";

/**
 * Q1: where the app opens - Home, unless the bill found on the phone holds something (`resumed`): then that bill, as today, so 10 / 11 /
 * 23 / 24 come back after a full close. Chosen once, when the draft has been looked at; null until then.
 */
export function useStartTab(ready: boolean, resumed: boolean): [Tab | null, (tab: Tab) => void] {
  const [tab, setTab] = useState<Tab | null>(null);
  useEffect(() => {
    if (ready && tab === null) setTab(resumed ? "bill" : "home");
  }, [ready, resumed, tab]);
  return [tab, setTab];
}

/** On the bill (12): Android Back goes to Home - the bill is kept, as the Back arrow does. */
export function BillBack({ onBack }: { onBack: () => void }) {
  useBackEntry("kbBill", onBack);
  return null;
}

/** KB-414 step 2 phone check (owner, 17 Nov 2026): the frame counts the inner pages and sheets open over its tab screen. */
const NavCover = createContext<(delta: 1 | -1) => void>(() => {});

/**
 * An inner page or sheet over a tab screen (15, 25, Items' Add / Edit / Import / Ready catalog, a dialog): the nav is hidden while it is
 * open (26 §6 - inner pages have Back, no nav). It cannot simply sit above the nav: it is drawn inside its tab screen's fixed layer (z 20),
 * under the nav (z 25) whatever its own z - on the phone 15's "Cancel bill" was under the nav. A layout effect: the nav goes in the same
 * commit the page appears, never one painted frame over it. Outside a tab frame (the bill, 12) it does nothing.
 */
export function useHidesNav(): void {
  const cover = useContext(NavCover);
  useLayoutEffect(() => {
    cover(1);
    return () => cover(-1);
  }, [cover]);
}

/**
 * The tab screens' frame: the nav fixed at the bottom and, offline, 24's ink strip at the top (Q3), both z 25 - above the tab screens
 * (z 20) and below their inner screens and sheets (z 30 / 40). The screens keep clear of both through --kb-tab-top / --kb-tab-bottom,
 * measured (the phone's text size changes their height).
 */
export function TabFrame({ tab, onTab, offline, children }: { tab: Tab; onTab: (tab: Tab) => void; offline: boolean; children: ReactNode }) {
  const { t } = useT();
  const top = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const [inset, setInset] = useState({ top: 0, bottom: 0 });
  const [covers, setCovers] = useState(0);
  const cover = useCallback((delta: 1 | -1) => setCovers((n) => n + delta), []);
  const showNav = covers === 0;
  useLayoutEffect(() => {
    const measure = () => setInset({ top: top.current?.offsetHeight ?? 0, bottom: bottom.current?.offsetHeight ?? 0 });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    if (top.current) ro.observe(top.current);
    if (bottom.current) ro.observe(bottom.current);
    return () => ro.disconnect();
  }, [offline, showNav]);
  const item = (key: Exclude<Tab, "bill">, label: string, icon: (typeof KB_ICONS)[keyof typeof KB_ICONS]) => ({ key, label, icon, active: tab === key, onClick: () => onTab(key) });
  return (
    <div style={{ "--kb-tab-top": `${inset.top}px`, "--kb-tab-bottom": `${inset.bottom}px` } as CSSProperties}>
      <NavCover.Provider value={cover}>{children}</NavCover.Provider>
      {offline && (
        <div ref={top} className="fixed inset-x-0 top-0 z-[25] mx-auto max-w-[480px]">
          <OfflineStrip>{t("offline.strip")}</OfflineStrip>
        </div>
      )}
      {showNav && (
        <div ref={bottom} className="fixed inset-x-0 bottom-0 z-[25] mx-auto max-w-[480px]">
          <BottomNav
            label={t("nav.label")}
            items={[item("home", t("nav.home"), KB_ICONS.Home), item("bills", t("history.billsLabel"), KB_ICONS.ReceiptText), item("items", t("nav.items"), KB_ICONS.Package), item("more", t("order.more"), KB_ICONS.MoreHorizontal)]}
          />
        </div>
      )}
    </div>
  );
}
