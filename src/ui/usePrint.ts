import { useCallback, useRef, useState } from "react";
import { encodeReceiptImage } from "@/domain/escpos";
import type { MessageId } from "@/domain/messages";
import type { Receipt } from "@/domain/receipt";
import { loadPrinterSettings, sendToPrinter, toPrintError, type PrintFailure } from "@/data/printer";
import { bleTransport } from "@/data/printerBle";
import { classicTransport } from "@/data/printerClassic";
import { renderReceiptForPrint } from "./receiptPrint";

// KB-408 S5: printing a receipt to the printer chosen in Settings, at its paper width. One print at a time; progress as the bytes go
// (a long bill takes seconds); every failure ends in one sentence (printFailureText) - printing never blocks a bill.

export type PrintState =
  | { readonly kind: "idle" }
  | { readonly kind: "printing"; readonly percent: number }
  | { readonly kind: "done" }
  | { readonly kind: "failed"; readonly failure: PrintFailure | "no_printer" };

export const PRINT_FAILURE_TEXT: Record<PrintFailure | "no_printer", MessageId> = {
  no_printer: "print.noPrinter",
  unreachable: "print.unreachable",
  bluetooth_off: "print.bluetoothOff",
  permission: "print.permission",
  disconnected: "print.disconnected",
  no_bluetooth: "print.noBluetooth",
};

export function usePrint(): { state: PrintState; print: (receipt: Receipt) => Promise<boolean> } {
  const [state, setState] = useState<PrintState>({ kind: "idle" });
  const busy = useRef(false);
  const print = useCallback(async (receipt: Receipt) => {
    if (busy.current) return false;
    busy.current = true;
    try {
      const settings = loadPrinterSettings();
      if (!settings) {
        setState({ kind: "failed", failure: "no_printer" });
        return false;
      }
      setState({ kind: "printing", percent: 0 });
      const { bitmap } = await renderReceiptForPrint(receipt, settings.dots);
      const transport = settings.device.kind === "ble" ? bleTransport : classicTransport;
      await sendToPrinter(transport, settings.device.id, encodeReceiptImage(bitmap), (done) => setState({ kind: "printing", percent: Math.round(done * 100) }));
      setState({ kind: "done" });
      return true;
    } catch (err) {
      setState({ kind: "failed", failure: toPrintError(err).kind });
      return false;
    } finally {
      busy.current = false;
    }
  }, []);
  return { state, print };
}
