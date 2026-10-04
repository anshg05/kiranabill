import { useEffect, useState } from "react";
import type { KiranaBillDB } from "@/data/db";
import type { Receipt } from "@/domain/receipt";
import { receiptText, waLink } from "@/domain/receiptText";
import type { SavedBill } from "./useFinalise";

// KB-309 (owner, 4 Oct 2026): share the saved receipt.
// - The PNG and PDF are rendered when the receipt is SHOWN, so a tap shares a
//   ready File: navigator.share() needs the tap's activation, and awaiting
//   fonts / canvas / toBlob first can lose it (NotAllowedError on Android).
// - canShare({ files }) picks share vs download; a cancelled share sheet
//   (AbortError) does nothing.
// - WhatsApp: the mobile is read from the STORED bill at tap time - never the
//   draft or the receipt model - and never put in the page (D52).

export type RenderReceiptFiles = (receipt: Receipt) => Promise<{ png: Blob; pdf: Blob }>;

export interface ReceiptShare {
  /** The PNG and PDF are ready to share. */
  readonly ready: boolean;
  shareImage(): void;
  sharePdf(): void;
  whatsApp(): Promise<void>;
}

interface Files {
  readonly localId: string;
  readonly png: File;
  readonly pdf: File;
}

function shareFile(file: File): void {
  const data = { files: [file] };
  if (typeof navigator.canShare === "function" && navigator.canShare(data)) {
    navigator.share(data).catch((err: unknown) => {
      if (err instanceof DOMException && err.name === "AbortError") return; // the share sheet was cancelled
      console.warn("[share] failed:", err instanceof Error ? err.name : err);
    });
    return;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
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
  return {
    ready: ready !== null,
    shareImage: () => {
      if (ready) shareFile(ready.png);
    },
    sharePdf: () => {
      if (ready) shareFile(ready.pdf);
    },
    whatsApp: async () => {
      const bill = localDb ? await localDb.bills.get(saved.localId) : undefined;
      window.open(waLink(receiptText(receipt), bill?.customerMobile ?? null), "_blank", "noopener");
    },
  };
}
