import { useEffect, useState } from "react";
import { decodeEscPos, encodeReceiptImage, type MonoBitmap } from "@/domain/escpos";
import type { Receipt } from "@/domain/receipt";
import { DEV_PRINT_BILLS } from "./devPrintBills";
import { renderReceiptForPrint } from "./receiptPrint";

// DEV ONLY (KB-408 S3, /__dev/print): renders the print previews in the real browser engine - the same canvas the Android web view uses -
// encodes them, DECODES the printer bytes back and saves both pictures to eval/print-preview/ (git-ignored) through the dev server.

const JOBS: readonly { name: string; receipt: Receipt; dots: number; reprint?: boolean }[] = [
  { name: "bill514-576", receipt: DEV_PRINT_BILLS.bill514, dots: 576 },
  { name: "bill514-384", receipt: DEV_PRINT_BILLS.bill514, dots: 384 },
  { name: "three-576", receipt: DEV_PRINT_BILLS.three, dots: 576 },
  { name: "three-384", receipt: DEV_PRINT_BILLS.three, dots: 384 },
  { name: "three-reprint-576", receipt: DEV_PRINT_BILLS.three, dots: 576, reprint: true },
  { name: "three-reprint-384", receipt: DEV_PRINT_BILLS.three, dots: 384, reprint: true },
];

async function save(name: string, bytes: Uint8Array): Promise<void> {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const res = await fetch("/__dev/save-print", { method: "POST", body: JSON.stringify({ name, base64: btoa(bin) }) });
  if (!res.ok) throw new Error(`save ${name}: ${res.status}`);
}

function pngOf(width: number, height: number, paint: (img: ImageData) => void): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(width, height);
  paint(img);
  ctx.putImageData(img, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? void b.arrayBuffer().then((a) => resolve(new Uint8Array(a))) : reject(new Error("toBlob"))), "image/png"),
  );
}

const monoPng = (m: MonoBitmap) =>
  pngOf(m.width, m.height, (img) => {
    for (let y = 0; y < m.height; y++)
      for (let x = 0; x < m.width; x++) {
        const v = m.data[y * (m.width / 8) + (x >> 3)]! & (0x80 >> (x & 7)) ? 0 : 255;
        img.data.set([v, v, v, 255], (y * m.width + x) * 4);
      }
  });

async function gzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function DevPrintPreview() {
  const [log, setLog] = useState<string[]>([]);
  useEffect(() => {
    void (async () => {
      const stats: Record<string, unknown>[] = [];
      for (const job of JOBS) {
        const receipt = job.reprint ? { ...job.receipt, reprint: "REPRINT" } : job.receipt;
        const { rgba, bitmap } = await renderReceiptForPrint(receipt, job.dots);
        const raster = encodeReceiptImage(bitmap);
        const bitimage = encodeReceiptImage(bitmap, { mode: "bitimage" });
        const decoded = decodeEscPos(raster);
        const same = decoded.width === bitmap.width && decoded.data.length === bitmap.data.length && decoded.data.every((b, i) => b === bitmap.data[i]);
        await save(`${job.name}-rendered.png`, await pngOf(bitmap.width, bitmap.height, (img) => img.data.set(rgba)));
        await save(`${job.name}-printer.png`, await monoPng(decoded));
        if (job.name.startsWith("bill514")) {
          const grey = new Uint8Array(bitmap.width * bitmap.height);
          for (let i = 0; i < grey.length; i++) grey[i] = Math.round((299 * rgba[i * 4]! + 587 * rgba[i * 4 + 1]! + 114 * rgba[i * 4 + 2]!) / 1000);
          await save(`${job.name}.grey.gz`, await gzip(grey));
        }
        const row = { job: job.name, dots: bitmap.width, heightDots: bitmap.height, heightMm: +((bitmap.height / 8).toFixed(1)), rows: receipt.rows.length, rasterBytes: raster.length, bitImageBytes: bitimage.length, bands: Math.ceil(bitmap.height / 64), decodedMatches: same };
        stats.push(row);
        setLog((l) => [...l, JSON.stringify(row)]);
      }
      await save("stats.json", new TextEncoder().encode(JSON.stringify(stats, null, 2)));
      setLog((l) => [...l, "done"]);
    })().catch((e: unknown) => setLog((l) => [...l, `ERROR ${String(e)}`]));
  }, []);
  return <pre data-testid="dev-print-log">{log.join("\n")}</pre>;
}
