import { useState } from "react";
import { buildReceipt, type BillLanguage, type Receipt } from "@/domain/receipt";
import type { Paise } from "@/domain/money";
import { loadPrinterSettings, preferClassic, savePrinterSettings, toPrintError, type PaperDots, type PrintFailure, type PrinterDevice, type PrinterSettings } from "@/data/printer";
import { bleTransport } from "@/data/printerBle";
import { classicTransport } from "@/data/printerClassic";
import { PrintStatus } from "./PrintButton";
import { PRINT_FAILURE_TEXT, usePrint } from "./usePrint";
import { useT } from "./useT";
import { Button } from "./kit/Button";
import { Icon, KB_ICONS } from "./kit/icons";
import { GroupLabel, ListCard } from "./kit/ListRow";
import { Segmented } from "./kit/Segmented";
import { ToggleRow } from "./kit/Toggle";

// KB-408 S5 (owner, 13 Nov 2026): the printer, inside the Android app only - choose the printer (the phone's paired ones; a BLE
// search), the paper width (58 / 80 mm), Test print. Stored on this phone only. Bluetooth permission is asked when Choose printer is
// tapped - never just by opening the page. KB-414 step 4 (owner + reviewer, 18 Nov 2026): More -> Printer, an inner page in 18's look
// with today's parts only (Print after Bill Banao, Copies, Show shop phone and the preview are KB-416); More shows the row only in the app.

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
      save({ device, dots: settings?.dots ?? 384, compat: settings?.compat ?? false }); // a new printer keeps the paper and the mode
      setDevices(null);
    } finally {
      setChecking(false);
    }
  };
  const setPaper = (dots: PaperDots) => settings && save({ ...settings, dots });
  const setCompat = (compat: boolean) => settings && save({ ...settings, compat });
  const printing = test.state.kind === "printing";

  return (
    <div className="flex flex-col gap-[14px]">
      <p className="text-kb-13 text-kb-sub">{t("settings.printerHelp")}</p>
      <div className="flex flex-col gap-3 rounded-[16px] border border-kb-border bg-kb-card p-[14px]">
        <div className="flex items-center gap-3">
          <span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[11px] bg-kb-primary-pale text-kb-primary">
            <Icon icon={KB_ICONS.Printer} size={19} />
          </span>
          <span className="min-w-0 flex-1 text-kb-15 font-semibold">{settings ? settings.device.name : t("settings.printerNone")}</span>
        </div>
        <Button variant="secondary" height={46} icon={KB_ICONS.Bluetooth} onClick={() => void find("classic")}>
          {t("settings.printerChoose")}
        </Button>
      </div>
      {failure && (
        <p role="alert" className="text-kb-13 text-kb-err">
          {t(PRINT_FAILURE_TEXT[failure])}
        </p>
      )}
      {checking && (
        <p role="status" className="text-kb-13 text-kb-sub">
          {t("settings.printerChecking")}
        </p>
      )}
      {devices && (
        <div className="flex flex-col gap-2">
          <GroupLabel>{t("settings.printerPaired")}</GroupLabel>
          {devices.length === 0 && <p className="text-kb-13">{t("settings.printerNoneFound")}</p>}
          {devices.length > 0 && (
            <ListCard>
              <ul>
                {devices.map((d) => (
                  <li key={`${d.kind}:${d.id}`}>
                    <button type="button" aria-disabled={checking} onClick={() => void pick(d)} className="kb-hit flex min-h-[58px] w-full items-center border-b border-kb-border px-[14px] text-left text-kb-15 font-semibold">
                      {d.name || d.id}
                    </button>
                  </li>
                ))}
              </ul>
            </ListCard>
          )}
          <Button variant="secondary" height={46} ariaDisabled={searching} onClick={searching ? undefined : () => void find("ble")}>
            {searching ? t("settings.printerSearching") : t("settings.printerSearch")}
          </Button>
        </div>
      )}
      {settings && (
        <>
          <div className="mt-1">
            <GroupLabel>{t("settings.paper")}</GroupLabel>
          </div>
          <Segmented
            label={t("settings.paper")}
            options={[{ value: "384", label: t("settings.paper58") }, { value: "576", label: t("settings.paper80") }]}
            value={String(settings.dots)}
            onChange={(v) => setPaper(v === "576" ? 576 : 384)}
          />
          {/* Owner, 14 Nov 2026: for printers that print garbage for GS v 0 - the same image as ESC * bit image. */}
          <ListCard>
            <ToggleRow label={t("settings.compatMode")} sub={t("settings.compatHint")} checked={settings.compat} onChange={setCompat} />
          </ListCard>
          <Button variant="primary" icon={KB_ICONS.Printer} ariaDisabled={printing} onClick={() => void test.print(testReceipt(shop))}>
            {t("settings.testPrint")}
          </Button>
          <Button variant="secondary" ariaDisabled={printing} onClick={() => void test.print(longTestReceipt(shop))}>
            {t("settings.longTestPrint")}
          </Button>
        </>
      )}
      <PrintStatus state={test.state} />
    </div>
  );
}
