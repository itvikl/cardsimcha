const MM_TO_PT = 72 / 25.4;

/**
 * A one-page PDF of the given size holding one JPEG, for sending to a print shop. Written by hand because
 * this is all it needs: the page, the picture filling it, and the table that says where each part is.
 */
export function jpegToPdf(jpeg: Uint8Array, pxWidth: number, pxHeight: number, widthMm: number, heightMm: number): Blob {
  const w = (widthMm * MM_TO_PT).toFixed(2);
  const h = (heightMm * MM_TO_PT).toFixed(2);
  const draw = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  let length = 0;
  const add = (p: string | Uint8Array) => {
    const bytes = typeof p === 'string' ? enc.encode(p) : p;
    parts.push(bytes);
    length += bytes.length;
  };
  const offsets: number[] = [];
  const object = (body: () => void) => {
    offsets.push(length);
    add(`${offsets.length} 0 obj\n`);
    body();
    add('\nendobj\n');
  };
  add('%PDF-1.4\n');
  object(() => add('<< /Type /Catalog /Pages 2 0 R >>'));
  object(() => add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
  object(() => add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`));
  object(() => {
    add(`<< /Type /XObject /Subtype /Image /Width ${pxWidth} /Height ${pxHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
    add(jpeg);
    add('\nendstream');
  });
  object(() => add(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`));
  const table = length;
  add(`xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`);
  for (const o of offsets) add(`${String(o).padStart(10, '0')} 00000 n \n`);
  add(`trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${table}\n%%EOF\n`);
  return new Blob(parts as BlobPart[], { type: 'application/pdf' });
}
