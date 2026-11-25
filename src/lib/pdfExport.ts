/**
 * Pure client-side, zero-dependency single-page PDF 1.4 generator.
 * Embeds a JPEG-encoded scan at exact physical A4/A5 millimeter page dimensions.
 */
export function buildSinglePagePdfFromCanvas(
  canvas: HTMLCanvasElement,
  widthMm: number,
  heightMm: number,
  jpegQuality = 0.92
): Blob {
  const dataUrl = canvas.toDataURL('image/jpeg', jpegQuality);
  const base64 = dataUrl.split(',')[1] || '';
  const binaryStr = atob(base64);
  const jpegBytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    jpegBytes[i] = binaryStr.charCodeAt(i);
  }

  // Convert mm to PDF points (1 inch = 72 pt = 25.4 mm)
  const ptW = ((widthMm / 25.4) * 72).toFixed(2);
  const ptH = ((heightMm / 25.4) * 72).toFixed(2);

  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0]; // 1-indexed PDF xref table
  let bytePos = 0;

  const pushStr = (s: string) => {
    const b = enc.encode(s);
    chunks.push(b);
    bytePos += b.length;
  };

  const pushBytes = (b: Uint8Array) => {
    chunks.push(b);
    bytePos += b.length;
  };

  pushStr('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');

  // Obj 1: Catalog
  offsets.push(bytePos);
  pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // Obj 2: Pages
  offsets.push(bytePos);
  pushStr('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

  // Obj 3: Page
  offsets.push(bytePos);
  pushStr(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptW} ${ptH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`
  );

  // Obj 4: Image XObject
  offsets.push(bytePos);
  pushStr(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`
  );
  pushBytes(jpegBytes);
  pushStr('\nendstream\nendobj\n');

  // Obj 5: Content stream drawing image full-bleed into MediaBox
  const contentStream = `q\n${ptW} 0 0 ${ptH} 0 0 cm\n/Im0 Do\nQ\n`;
  offsets.push(bytePos);
  pushStr(
    `5 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}endstream\nendobj\n`
  );

  // Cross-reference table
  const xrefOffset = bytePos;
  pushStr(`xref\n0 ${offsets.length}\n`);
  pushStr('0000000000 65535 f \n');
  for (let i = 1; i < offsets.length; i++) {
    const off = String(offsets[i]).padStart(10, '0');
    pushStr(`${off} 00000 n \n`);
  }

  pushStr(
    `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  );

  const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
  const out = new Uint8Array(totalLen);
  let cursor = 0;
  for (const c of chunks) {
    out.set(c, cursor);
    cursor += c.length;
  }

  return new Blob([out], { type: 'application/pdf' });
}
