import { useEffect, useState } from "react";
import type { KiranaBillDB } from "@/data/db";
import type { Receipt } from "@/domain/receipt";
import { receiptText, smsLink, smsText, waLink } from "@/domain/receiptText";
import type { SavedBill } from "./useFinalise";

// KB-309 commit 3 (owner, 4 Oct 2026 - the legacy behaviour, D58):
// - Image and PDF always DOWNLOAD (no share sheet).
// - WhatsApp sends the IMAGE through the share sheet when files can be shared;
//   the files are rendered when the receipt is SHOWN, so the share call happens
//   inside the tap (navigator.share needs its activation - awaiting fonts /
//   canvas / toBlob first can lose it on Android). AbortError does nothing.
//   Without file sharing: wa.me with the text receipt and the STORED mobile.
// - SMS: text only, to a number the shopkeeper confirms - pre-filled from the
//   STORED bill when the sheet opens; never stored back (bills are immutable).
// The mobile is read from the stored bill at tap / open time - never from the
// draft or the receipt model - and is never rendered (D52).

export type RenderReceiptFiles = (receipt: Receipt) => Promise<{ png: Blob; pdf: Blob }>;

export interface ReceiptShare {
  /** The PNG and PDF are ready. */
  readonly ready: boolean;
  /** The SMS body (the preview shows exactly this). */
  readonly smsText: string;
  downloadImage(): void;
  downloadPdf(): void;
  whatsApp(): void;
  /** The stored bill's mobile, for the SMS field - read when the sheet opens. */
  storedMobile(): Promise<string | null>;
  /** Opens the SMS app; nothing unless `mobile` is a valid D52 number. */
  sendSms(mobile: string): void;
}

interface Files {
  readonly localId: string;
  readonly png: File;
  readonly pdf: File;
}

/** Clicks a temporary link - a download, or an sms: URL. */
function follow(href: string, download?: string): void {
  const a = document.createElement("a");
  a.href = href;
  if (download) a.download = download;
  a.click();
}

function download(file: File): void {
  const url = URL.createObjectURL(file);
  follow(url, file.name);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function useReceiptShare({ localDb, saved, render }: { localDb: KiranaBillDB | null; saved: SavedBill | null; render: RenderReceiptFiles }): ReceiptShare | null {
  const [files, setFiles] = useState<Files | null>(null);

  useEffect(() => {
    const receipt = saved?.receipt;
    if (!saved || !receipt) return;
    let live = true;
    render(receipt)
      .then(({ png, pdf }) => {
        if (!live) return;
        setFiles({
          localId: saved.localId,
          png: new File([png], `${receipt.receiptNumber}.png`, { type: "image/png" }),
          pdf: new File([pdf], `${receipt.receiptNumber}.pdf`, { type: "application/pdf" }),
        });
      })
      .catch((err: unknown) => console.warn("[share] render failed:", err instanceof Error ? err.message : err));
    return () => {
      live = false;
    };
  }, [saved, render]);

  if (!saved?.receipt) return null;
  const receipt = saved.receipt;
  const ready = files?.localId === saved.localId ? files : null;
  const storedMobile = async () => (localDb ? ((await localDb.bills.get(saved.localId))?.customerMobile ?? null) : null);
  const sms = smsText(receipt);

  return {
    ready: ready !== null,
    smsText: sms,
    downloadImage: () => {
      if (ready) download(ready.png);
    },
    downloadPdf: () => {
      if (ready) download(ready.pdf);
    },
    whatsApp: () => {
      const data = ready ? { files: [ready.png] } : null;
      if (data && typeof navigator.canShare === "function" && navigator.canShare(data)) {
        // In the tap, nothing awaited before it.
        navigator.share(data).catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return; // the share sheet was cancelled
          console.warn("[share] failed:", err instanceof Error ? err.name : err);
        });
        return;
      }
      void storedMobile().then((mobile) => window.open(waLink(receiptText(receipt), mobile), "_blank", "noopener"));
    },
    storedMobile,
    sendSms: (mobile) => {
      const link = smsLink(sms, mobile);
      if (link) follow(link);
    },
  };
}
