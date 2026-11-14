import { useState } from "react";
import { buildReceipt, type BillLanguage, type Receipt } from "@/domain/receipt";
import type { Paise } from "@/domain/money";
import { isNativeApp } from "@/data/nativeSignIn";
import { loadPrinterSettings, preferClassic, savePrinterSettings, toPrintError, type PaperDots, type PrintFailure, type PrinterDevice, type PrinterSettings } from "@/data/printer";
import { bleTransport } from "@/data/printerBle";
import { classicTransport } from "@/data/printerClassic";
import { PrintStatus } from "./PrintButton";
import { PRINT_FAILURE_TEXT, usePrint } from "./usePrint";
import { useT } from "./useT";

// KB-408 S5 (owner, 13 Nov 2026): Settings -> Printer, inside the Android app only - choose the printer (the phone's paired ones; a BLE
// search), the paper width (58 / 80 mm), Test print. Stored on this phone only. Bluetooth permission is asked when Choose printer is
// tapped - never just by opening Settings.

interface ShopForPrint {
  readonly name: string;
  readonly phone: string | null;
  readonly billLanguage: BillLanguage;
}

/** A small receipt with the shop's own header and the Devanagari that is hardest to print (ि ी ् ँ ं, क्ष, द्ध). */
export function testReceipt(shop: ShopForPrint, now = new Date()): Receipt {
  const at = now.toISOString();
  const r = buildReceipt(
    { receiptNumber: "TEST", customerName: "Cash", totalPaise: 4500 as Paise, finalizedAt: at, createdAt: at, status: "final" },
    [{ displayName: "शुद्ध घी क्षीर मूँगफली चिप्स", qty: 1, unit: "kg", ratePaise: 4500 as Paise, rateUnit: "kg", totalPaise: 4500 as Paise }],
    { name: shop.name, phone: shop.phone, logoUrl: null, billLanguage: shop.billLanguage },
  );
  return { ...r, reprint: "TEST PRINT" };
}

/**
 * Owner's S6 (14 Nov 2026): a long bill for the stress test - 60 lines numbered 1..60, each worth its own number (total 1,830), so on
 * paper a lost line, a shifted column or garbage is seen at a glance.
 */
export function longTestReceipt(shop: ShopForPrint, now = new Date()): Receipt {
  const at = now.toISOString();
  const items = Array.from({ length: 60 }, (_, i) => {
    const n = i + 1;
    return { displayName: `जाँच पंक्ति ${n}`, qty: n, unit: "piece", ratePaise: 100 as Paise, rateUnit: "piece", totalPaise: (n * 100) as Paise };
  });
  const r = buildReceipt(
    { receiptNumber: "TEST-60", customerName: "Cash", totalPaise: 183_000 as Paise, finalizedAt: at, createdAt: at, status: "final" },
    items,
    { name: shop.name, phone: shop.phone, logoUrl: null, billLanguage: shop.billLanguage },
  );
  return { ...r, reprint: "TEST PRINT" };
}

export function PrinterSection({ shop }: { shop: ShopForPrint }) {
  return isNativeApp() ? <PrinterSectionInApp shop={shop} /> : null;
}

const heading = "text-[13px] font-semibold uppercase tracking-[0.04em] text-ink-soft";
const btn = "min-h-11 rounded-[6px] border border-line bg-surface px-4 font-medium aria-disabled:opacity-50";

function PrinterSectionInApp({ shop }: { shop: ShopForPrint }) {
  const { t } = useT();
  const [settings, setSettings] = useState<PrinterSettings | null>(() => loadPrinterSettings());
  const [devices, setDevices] = useState<PrinterDevice[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [checking, setChecking] = useState(false);
  const [failure, setFailure] = useState<PrintFailure | null>(null);
  const test = usePrint();

  const save = (next: PrinterSettings) => {
    savePrinterSettings(next);
    setSettings(next);
  };
  const find = async (kind: "classic" | "ble") => {
    setFailure(null);
    const transport = kind === "ble" ? bleTransport : classicTransport;
    if (kind === "ble") setSearching(true);
    try {
      await transport.ready();
      const found = await transport.list();
      setDevices((cur) => (kind === "ble" ? [...(cur ?? []).filter((d) => d.kind === "classic"), ...found] : found));
    } catch (e) {
      setFailure(toPrintError(e).kind);
    } finally {
      setSearching(false);
    }
  };
  // Bluetooth Classic whenever the printer offers it (owner, 14 Nov 2026): a BLE-found printer is tried once on Classic before it is saved.
  const pick = async (found: PrinterDevice) => {
    if (checking) return;
    setChecking(true);
    try {
      const device = await preferClassic(found, classicTransport);
      save({ device, dots: settings?.dots ?? 384 });
      setDevices(null);
    } finally {
      setChecking(false);
    }
  };
  const setPaper = (dots: PaperDots) => settings && save({ ...settings, dots });

  return (
    <section aria-label={t("settings.printer")} className="mt-6">
      <h3 className={heading}>{t("settings.printer")}</h3>
      <p className="mt-1 text-[13px] text-ink-soft">{t("settings.printerHelp")}</p>
      <p className="mt-2 font-medium">{settings ? settings.device.name : t("settings.printerNone")}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => void find("classic")} className={btn}>
          {t("settings.printerChoose")}
        </button>
        {settings && (
          <>
            <button type="button" aria-disabled={test.state.kind === "printing"} onClick={() => void test.print(testReceipt(shop))} className={btn}>
              {t("settings.testPrint")}
            </button>
            <button type="button" aria-disabled={test.state.kind === "printing"} onClick={() => void test.print(longTestReceipt(shop))} className={btn}>
              {t("settings.longTestPrint")}
            </button>
          </>
        )}
      </div>
      {failure && (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {t(PRINT_FAILURE_TEXT[failure])}
        </p>
      )}
      {checking && (
        <p role="status" className="mt-2 text-[13px] text-ink-soft">
          {t("settings.printerChecking")}
        </p>
      )}
      {devices && (
        <div className="mt-3 rounded-[6px] border border-line bg-surface p-3">
          <p className="text-[13px] text-ink-soft">{t("settings.printerPaired")}</p>
          {devices.length === 0 && <p className="mt-1 text-[13px]">{t("settings.printerNoneFound")}</p>}
          <ul className="mt-1 flex flex-col gap-1">
            {devices.map((d) => (
              <li key={`${d.kind}:${d.id}`}>
                <button type="button" aria-disabled={checking} onClick={() => void pick(d)} className="flex min-h-11 w-full items-center rounded-[6px] px-2 text-left font-medium hover:bg-paper">
                  {d.name || d.id}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" aria-disabled={searching} onClick={searching ? undefined : () => void find("ble")} className={`${btn} mt-2 w-full`}>
            {searching ? t("settings.printerSearching") : t("settings.printerSearch")}
          </button>
        </div>
      )}
      {settings && (
        <>
          <p className={`${heading} mt-4`}>{t("settings.paper")}</p>
          <div role="radiogroup" aria-label={t("settings.paper")} className="mt-2 flex flex-wrap gap-2">
            {([384, 576] as const).map((dots) => (
              <label key={dots} className="flex min-h-11 cursor-pointer items-center rounded-[6px] border border-line px-4 has-checked:border-ink has-checked:bg-ink has-checked:text-paper">
                <input type="radio" name="paper" checked={settings.dots === dots} onChange={() => setPaper(dots)} aria-label={dots === 384 ? t("settings.paper58") : t("settings.paper80")} className="sr-only" />
                {dots === 384 ? t("settings.paper58") : t("settings.paper80")}
              </label>
            ))}
          </div>
        </>
      )}
      <PrintStatus state={test.state} />
    </section>
  );
}
