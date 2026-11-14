import { useEffect, useState } from "react";
import { PRINT_BAND_ROWS, decodeEscPos, encodeReceiptImage, type MonoBitmap } from "@/domain/escpos";
import type { Receipt } from "@/domain/receipt";
import { DEV_PRINT_BILLS, WIDE_NUMBERS_BILL } from "./devPrintBills";
import { longTestReceipt, testReceipt } from "./PrinterSection";
import { renderReceiptForPrint } from "./receiptPrint";

// DEV ONLY (KB-408 S3, /__dev/print): renders the print previews in the real browser engine - the same canvas the Android web view uses -
// encodes them, DECODES the printer bytes back and saves both pictures to eval/print-preview/ (git-ignored) through the dev server.

const TEST_SHOP = { name: "Gupta Kirana Store", phone: null, billLanguage: "en" as const };
const TEST_AT = new Date("2026-11-14T06:30:00.000Z");

const JOBS: readonly { name: string; receipt: Receipt; dots: number; reprint?: boolean }[] = [
  { name: "bill514-576", receipt: DEV_PRINT_BILLS.bill514, dots: 576 },
  { name: "bill514-384", receipt: DEV_PRINT_BILLS.bill514, dots: 384 },
  { name: "three-576", receipt: DEV_PRINT_BILLS.three, dots: 576 },
  { name: "three-384", receipt: DEV_PRINT_BILLS.three, dots: 384 },
  { name: "three-reprint-576", receipt: DEV_PRINT_BILLS.three, dots: 576, reprint: true },
  { name: "three-reprint-384", receipt: DEV_PRINT_BILLS.three, dots: 384, reprint: true },
  { name: "testprint-576", receipt: testReceipt(TEST_SHOP, TEST_AT), dots: 576 },
  { name: "testprint-384", receipt: testReceipt(TEST_SHOP, TEST_AT), dots: 384 },
  { name: "longtest-576", receipt: longTestReceipt(TEST_SHOP, TEST_AT), dots: 576 },
  { name: "longtest-384", receipt: longTestReceipt(TEST_SHOP, TEST_AT), dots: 384 },
  { name: "wide-576", receipt: WIDE_NUMBERS_BILL, dots: 576 },
  { name: "wide-384", receipt: WIDE_NUMBERS_BILL, dots: 384 },
];

/** Blank dot columns at each side of what the printer gets. */
function blankSides(m: MonoBitmap): { blankLeft: number; blankRight: number } {
  const inkAt = (x: number) => {
    for (let y = 0; y < m.height; y++) if (m.data[y * (m.width / 8) + (x >> 3)]! & (0x80 >> (x & 7))) return true;
    return false;
  };
  let blankLeft = 0;
  while (blankLeft < m.width && !inkAt(blankLeft)) blankLeft++;
  let blankRight = 0;
  while (blankRight < m.width && !inkAt(m.width - 1 - blankRight)) blankRight++;
  return { blankLeft, blankRight };
}

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
        // the grey renders the tests read (eval/print/fixtures): every 58 mm job, and Bill 514 on 80 mm
        if (job.dots === 384 || job.name === "bill514-576") {
          const grey = new Uint8Array(bitmap.width * bitmap.height);
          for (let i = 0; i < grey.length; i++) grey[i] = Math.round((299 * rgba[i * 4]! + 587 * rgba[i * 4 + 1]! + 114 * rgba[i * 4 + 2]!) / 1000);
          await save(`${job.name}.grey.gz`, await gzip(grey));
        }
        const row = { job: job.name, dots: bitmap.width, heightDots: bitmap.height, heightMm: +((bitmap.height / 8).toFixed(1)), rows: receipt.rows.length, ...blankSides(decoded), rasterBytes: raster.length, bitImageBytes: bitimage.length, bands: Math.ceil(bitmap.height / PRINT_BAND_ROWS), decodedMatches: same };
        stats.push(row);
        setLog((l) => [...l, JSON.stringify(row)]);
      }
      await save("stats.json", new TextEncoder().encode(JSON.stringify(stats, null, 2)));
      setLog((l) => [...l, "done"]);
    })().catch((e: unknown) => setLog((l) => [...l, `ERROR ${String(e)}`]));
  }, []);
  return <pre data-testid="dev-print-log">{log.join("\n")}</pre>;
}
