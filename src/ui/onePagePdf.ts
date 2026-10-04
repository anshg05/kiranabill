// KB-309 (owner, Q1 A): a one-page PDF holding one JPEG - our own ~40 lines,
// no dependency. The page is 58 mm wide (the thermal roll: 58 / 25.4 * 72 =
// 164.41 pt), its height in proportion to the image, which fills it. Pure
// bytes: the JPEG goes in as-is (DCTDecode), the rest is ASCII.

export const PAGE_WIDTH_PT = 164.41;

export function jpegPdf(jpeg: Uint8Array, widthPx: number, heightPx: number): Uint8Array<ArrayBuffer> {
  const w = PAGE_WIDTH_PT.toFixed(2);
  const h = ((PAGE_WIDTH_PT * heightPx) / widthPx).toFixed(2);
  const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
  const parts: (string | Uint8Array)[] = [];
  const offsets: number[] = [];
  let length = 0;
  const add = (p: string | Uint8Array) => {
    parts.push(p);
    length += typeof p === "string" ? p.length : p.length;
  };
  const obj = (body: string, stream?: Uint8Array | string) => {
    offsets.push(length);
    add(`${offsets.length} 0 obj\n${body}\n`);
    if (stream !== undefined) {
      add("stream\n");
      add(stream);
      add("\nendstream\n");
    }
    add("endobj\n");
  };

  add("%PDF-1.4\n");
  obj("<< /Type /Catalog /Pages 2 0 R >>");
  obj("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  obj(`<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
  obj(`<< /Length ${content.length} >>`, content);
  const xref = length;
  add(`xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`);
  add(`trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  // Every string part is ASCII, so one byte per character.
  const out = new Uint8Array(length);
  let at = 0;
  for (const p of parts) {
    if (typeof p === "string") for (let i = 0; i < p.length; i++) out[at++] = p.charCodeAt(i);
    else {
      out.set(p, at);
      at += p.length;
    }
  }
  return out;
}
