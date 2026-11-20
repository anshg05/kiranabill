import { useEffect, useState } from "react";
import { buildReceipt, type BillLanguage, type Receipt } from "@/domain/receipt";
import type { Paise } from "@/domain/money";
import { loadPrinterSettings, preferClassic, savePrinterSettings, sortDevices, toPrintError, type PaperDots, type PrintFailure, type PrinterDevice, type PrinterSettings } from "@/data/printer";
import { bleTransport } from "@/data/printerBle";
import { classicTransport } from "@/data/printerClassic";
import { afterRefused, beforeAsking, openBluetoothSettings, scanAllowed } from "@/data/appShell";
import { InnerPage } from "./InnerPage";
import { PrintStatus } from "./PrintButton";
import { Receipt as ReceiptView } from "./Receipt";
import { PRINT_FAILURE_TEXT, usePrint } from "./usePrint";
import { useT } from "./useT";
import { Badge } from "./kit/Badge";
import { Button } from "./kit/Button";
import { Icon, KB_ICONS } from "./kit/icons";
import { GroupLabel, ListCard } from "./kit/ListRow";
import { ReceiptPaper } from "./kit/ReceiptPaper";
import { Segmented } from "./kit/Segmented";
import { ToggleRow } from "./kit/Toggle";

// KB-408 S5 (owner, 13 Nov 2026): the printer, inside the Android app only - choose the printer (the phone's paired ones; a BLE
// search), the paper width (58 / 80 mm), Test print. Stored on this phone only. Bluetooth permission is asked when Choose printer is
// tapped - never just by opening the page. KB-414 step 4 (owner + reviewer, 18 Nov 2026): More -> Printer, an inner page in 18's look.
// KB-416 (owner, 20 Nov 2026; D125): 18 and 22 as drawn - without Print after Bill Banao, Copies (SG-26) and Show shop phone (KB-422); the
// status line says "Bluetooth · Paired" / "Bluetooth LE", never "Connected"; the 60-line test is in Developer. More shows the row only
// in the app.

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

/** A sample bill for the previews (18 Printer, 21 Bill design) - two lines; the shop's own name, phone and receipt language. Never saved. */
export function sampleReceipt(shop: ShopForPrint): Receipt {
  const at = new Date().toISOString();
  return buildReceipt(
    { receiptNumber: "1", customerName: "Cash", totalPaise: 43_000 as Paise, finalizedAt: at, createdAt: at, status: "final" },
    [
      { displayName: "चीनी", qty: 2, unit: "kg", ratePaise: 4_500 as Paise, rateUnit: "kg", totalPaise: 9_000 as Paise },
      { displayName: "चावल", qty: 5, unit: "kg", ratePaise: 6_800 as Paise, rateUnit: "kg", totalPaise: 34_000 as Paise },
    ],
    { name: shop.name, phone: shop.phone, logoUrl: null, billLanguage: shop.billLanguage },
  );
}

/** The preview's paper on screen, in the printer's proportion (58 : 80). */
const PAPER_PX: Record<PaperDots, number> = { 384: 262, 576: 362 };

/** 18 Printer (KB-416, D125): the chosen printer, the paper, Compatible mode, a live preview, Test print. Choose printer is 22. */
export function PrinterSection({ shop }: { shop: ShopForPrint }) {
  const { t } = useT();
  const [settings, setSettings] = useState<PrinterSettings | null>(() => loadPrinterSettings());
  const [choosing, setChoosing] = useState(false);
  const test = usePrint();

  const save = (next: PrinterSettings) => {
    savePrinterSettings(next);
    setSettings(next);
  };
  // Not now on the Nearby devices card: Choose printer does not open (nothing would be listed)
  const openChoose = async () => {
    if (await beforeAsking("nearby")) setChoosing(true);
  };
  const setPaper = (dots: PaperDots) => settings && save({ ...settings, dots });
  const setCompat = (compat: boolean) => settings && save({ ...settings, compat });
  const printing = test.state.kind === "printing";
  const size = settings?.dots === 576 ? "80 mm" : "58 mm";

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex items-center gap-3 rounded-[16px] border border-kb-border bg-kb-card p-[14px]">
        <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[12px] bg-kb-primary-pale text-kb-primary">
          <Icon icon={KB_ICONS.Printer} size={20} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-kb-15 font-semibold">{settings ? settings.device.name : t("settings.printerNone")}</span>
          {/* the truth, not "Connected": the app connects only while it prints */}
          {settings && <span className="text-kb-13 text-kb-sub">{t(settings.device.kind === "ble" ? "printer.statusBle" : "printer.statusPaired")}</span>}
        </span>
        <Button variant={settings ? "secondary" : "primary"} height={46} fill={false} className="flex-none px-4" icon={settings ? undefined : KB_ICONS.Bluetooth} onClick={() => void openChoose()}>
          {settings ? t("printer.change") : t("settings.printerChoose")}
        </Button>
      </div>
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
          <figure aria-label={t("printer.preview", { size })} className="m-0 flex flex-col items-center gap-2 rounded-[18px] bg-kb-muted px-3 pt-4 pb-3 [overflow-wrap:normal]">
            <div data-paper-width={PAPER_PX[settings.dots]}>
              <ReceiptPaper width={PAPER_PX[settings.dots]} torn>
                <ReceiptView receipt={sampleReceipt(shop)} />
              </ReceiptPaper>
            </div>
            <figcaption className="text-center text-kb-13 text-kb-sub">{t("printer.preview", { size })}</figcaption>
          </figure>
          <Button variant="primary" icon={KB_ICONS.Printer} ariaDisabled={printing} onClick={() => void test.print(testReceipt(shop))}>
            {t("settings.testPrint")}
          </Button>
        </>
      )}
      <PrintStatus state={test.state} />
      {choosing && (
        <ChoosePrinter
          current={settings?.device ?? null}
          onClose={() => setChoosing(false)}
          onChosen={(device) => {
            save({ device, dots: settings?.dots ?? 384, compat: settings?.compat ?? false }); // a new printer keeps the paper and the mode
            setChoosing(false);
          }}
        />
      )}
    </div>
  );
}

/**
 * 22 Choose printer (KB-416, D125). The paired printers at once; the search for NEW printers by itself only when Android already allows
 * it (owner, 20 Nov 2026: opening this never brings up a prompt by itself) - otherwise on "Search for new printers". A printer both
 * paired and found is listed once, as Paired. Connect tries Bluetooth Classic first (owner, 14 Nov 2026).
 */
function ChoosePrinter({ current, onChosen, onClose }: { current: PrinterDevice | null; onChosen: (d: PrinterDevice) => void; onClose: () => void }) {
  const { t } = useT();
  const [paired, setPaired] = useState<PrinterDevice[] | null>(null);
  const [found, setFound] = useState<PrinterDevice[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [checking, setChecking] = useState(false);
  const [failure, setFailure] = useState<PrintFailure | null>(null);

  const fail = (e: unknown) => {
    const failed = toPrintError(e).kind;
    setFailure(failed);
    if (failed === "permission") void afterRefused("nearby");
  };
  const search = async () => {
    setFailure(null);
    setSearching(true);
    try {
      await bleTransport.ready();
      setFound(await bleTransport.list());
      setSearched(true);
    } catch (e) {
      fail(e);
    } finally {
      setSearching(false);
    }
  };
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        await classicTransport.ready();
        const list = await classicTransport.list();
        if (live) setPaired(list);
      } catch (e) {
        if (live) {
          setPaired([]);
          fail(e);
        }
        return;
      }
      if (live && (await scanAllowed())) void search();
    })();
    return () => {
      live = false;
    };
    // once, when the page opens
  }, []);

  const pick = async (d: PrinterDevice) => {
    if (checking) return;
    setChecking(true);
    try {
      onChosen(await preferClassic(d, classicTransport));
    } finally {
      setChecking(false);
    }
  };
  const pairedIds = new Set((paired ?? []).map((d) => d.id));
  const devices = sortDevices([...(paired ?? []), ...found.filter((d) => !pairedIds.has(d.id))]);

  return (
    <InnerPage title={t("settings.printerChoose")} backKey="kbChoosePrinter" onClose={onClose}>
      {searching && (
        <div role="status" className="flex items-center gap-3 rounded-[16px] bg-kb-primary-pale p-[14px]">
          <Icon icon={KB_ICONS.Bluetooth} size={20} className="text-kb-primary" />
          <span className="flex flex-col">
            <span className="text-kb-15 font-semibold">{t("printer.looking")}</span>
            <span className="text-kb-13 text-kb-sub">{t("printer.lookingSub")}</span>
          </span>
        </div>
      )}
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
      <GroupLabel>{t("printer.found")}</GroupLabel>
      {paired && devices.length === 0 && !searching && <p className="text-kb-13">{t("printer.noneYet")}</p>}
      {devices.length > 0 && (
        <ListCard>
          <ul>
            {devices.map((d) => {
              const name = d.name || d.id;
              const chosen = current?.id === d.id;
              return (
                <li key={`${d.kind}:${d.id}`} className="flex min-h-[64px] items-center gap-3 border-b border-kb-border px-[14px] py-2 last:border-b-0">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-kb-15 font-semibold">{name}</span>
                    <span className="text-kb-13 text-kb-sub">{t(pairedIds.has(d.id) ? "printer.paired" : "printer.newDevice")}</span>
                  </span>
                  {chosen ? (
                    <Badge kind="saved">{t("printer.chosen")}</Badge>
                  ) : (
                    <Button variant="secondary" height={46} fill={false} className="flex-none px-4" ariaDisabled={checking} ariaLabel={t("printer.connectName", { name })} onClick={() => void pick(d)}>
                      {t("printer.connect")}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </ListCard>
      )}
      {!searching && (
        <Button variant="secondary" height={46} icon={KB_ICONS.RefreshCw} onClick={() => void search()}>
          {searched ? t("printer.searchAgain") : t("printer.searchNew")}
        </Button>
      )}
      <div className="flex flex-col gap-3 rounded-[16px] border border-kb-border bg-kb-card p-[14px]">
        <p className="text-kb-14 leading-[1.5] text-kb-sub">{t("printer.notListed")}</p>
        <Button variant="secondary" height={46} icon={KB_ICONS.Bluetooth} onClick={openBluetoothSettings}>
          {t("printer.btSettings")}
        </Button>
      </div>
    </InnerPage>
  );
}

/** KB-416 (owner, 20 Nov 2026): the 60-line stress test - in More -> Developer, for the chosen printer. */
export function LongTestPrint({ shop }: { shop: ShopForPrint }) {
  const { t } = useT();
  const test = usePrint();
  if (!loadPrinterSettings()) return null;
  return (
    <div className="flex flex-col gap-2">
      <Button variant="secondary" ariaDisabled={test.state.kind === "printing"} onClick={() => void test.print(longTestReceipt(shop))}>
        {t("settings.longTestPrint")}
      </Button>
      <PrintStatus state={test.state} />
    </div>
  );
}
