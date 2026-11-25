/**
 * Generates realistic offline synthetic document photographs (with perspective tilt,
 * uneven desk shadows, punched holes, colored official stamps, and embedded portraits)
 * so every feature (corner detection, perspective warp, shadow removal, stamp protection,
 * A4/A5 scaling, and offline OCR) can be tested immediately without external files.
 */

function drawPaperWithPerspective(
  sheetCanvas: HTMLCanvasElement,
  outW: number,
  outH: number,
  deskColor: string,
  shadowType: 'diagonal' | 'corner'
): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext('2d');
  if (!ctx) return out;

  // Textured desk surface
  ctx.fillStyle = deskColor;
  ctx.fillRect(0, 0, outW, outH);
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  for (let y = 0; y < outH; y += 6) {
    ctx.fillRect(0, y, outW, 1);
  }

  // Simulate realistic perspective tilt by drawing horizontal strips with affine shear + scale
  const sw = sheetCanvas.width;
  const sh = sheetCanvas.height;

  const topScale = 0.78;
  const botScale = 0.88;
  const topY = outH * 0.085;
  const botY = outH * 0.915;
  const topOffsetX = outW * 0.13;
  const botOffsetX = outW * 0.06;

  // Drop shadow under paper
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.34)';
  ctx.beginPath();
  ctx.moveTo(topOffsetX + 10, topY + 14);
  ctx.lineTo(topOffsetX + sw * topScale * 0.88 + 10, topY + 26);
  ctx.lineTo(botOffsetX + sw * botScale * 0.88 + 14, botY + 14);
  ctx.lineTo(botOffsetX + 12, botY - 8);
  ctx.closePath();
  ctx.filter = 'blur(12px)';
  ctx.fill();
  ctx.restore();

  // Strip-wise perspective draw (300 strips gives smooth sub-pixel trapezoid)
  const strips = 320;
  for (let i = 0; i < strips; i++) {
    const t0 = i / strips;
    const t1 = (i + 1) / strips;
    const sy = t0 * sh;
    const sHeight = Math.max(1, (t1 - t0) * sh + 0.8);

    const curScale = topScale + (botScale - topScale) * t0;
    const leftX = topOffsetX + (botOffsetX - topOffsetX) * t0;
    const rightSkewY = (1 - t0) * 16 - t0 * 12;
    const curY = topY + (botY - topY) * t0;
    const nextY = topY + (botY - topY) * t1;
    const stripW = outW * 0.82 * curScale;

    ctx.save();
    ctx.translate(leftX, curY);
    ctx.transform(1, rightSkewY / stripW, 0, 1, 0, 0);
    ctx.drawImage(
      sheetCanvas,
      0,
      sy,
      sw,
      sHeight,
      0,
      0,
      stripW,
      Math.max(1, nextY - curY + 0.8)
    );
    ctx.restore();
  }

  // Cast realistic uneven lamp shadow across part of the document
  const grad =
    shadowType === 'diagonal'
      ? ctx.createLinearGradient(outW * 0.35, outH * 0.25, outW * 0.95, outH * 0.92)
      : ctx.createRadialGradient(
          outW * 0.85,
          outH * 0.82,
          outW * 0.05,
          outW * 0.72,
          outH * 0.7,
          outW * 0.65
        );
  grad.addColorStop(0, 'rgba(15, 23, 42, 0.42)');
  grad.addColorStop(0.55, 'rgba(15, 23, 42, 0.20)');
  grad.addColorStop(1, 'rgba(15, 23, 42, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, outW, outH);

  return out;
}

export function createSampleRegistrationA4(): HTMLCanvasElement {
  const w = 1240;
  const h = 1754;
  const sheet = document.createElement('canvas');
  sheet.width = w;
  sheet.height = h;
  const ctx = sheet.getContext('2d')!;

  // Off-white archival paper
  ctx.fillStyle = '#f6f4ec';
  ctx.fillRect(0, 0, w, h);

  // Subtle binder punched holes on left margin
  ctx.fillStyle = '#334155';
  for (const py of [460, 877, 1294]) {
    ctx.beginPath();
    ctx.arc(48, py, 20, 0, Math.PI * 2);
    ctx.fill();
  }

  // Outer form frame
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 4;
  ctx.strokeRect(105, 95, w - 175, h - 190);

  // Header band
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 42px sans-serif';
  ctx.fillText('MUNICIPAL VEHICLE REGISTRATION CERTIFICATE', 145, 178);
  ctx.font = '600 24px monospace';
  ctx.fillStyle = '#334155';
  ctx.fillText('FORM REG-2026-A4   |   OFFICIAL RECORD COPY', 145, 222);

  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(145, 250);
  ctx.lineTo(w - 110, 250);
  ctx.stroke();

  // Embedded portrait / ID photo box (tests photo preservation)
  const px = 860,
    py = 290,
    pw = 220,
    ph = 270;
  const pGrad = ctx.createLinearGradient(px, py, px, py + ph);
  pGrad.addColorStop(0, '#cbd5e1');
  pGrad.addColorStop(1, '#64748b');
  ctx.fillStyle = pGrad;
  ctx.fillRect(px, py, pw, ph);
  // Silhouette portrait inside ID box
  ctx.fillStyle = '#334155';
  ctx.beginPath();
  ctx.arc(px + pw / 2, py + 95, 48, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(px + pw / 2, py + 235, 76, 68, 0, Math.PI, 0);
  ctx.fill();
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 3;
  ctx.strokeRect(px, py, pw, ph);

  // Form fields
  const fields: [string, string][] = [
    ['CERTIFICATE NO.', 'FS-2026-88419-DE'],
    ['REGISTERED OWNER', 'CLAIRE M. HENDERSON'],
    ['RESIDENTIAL ADDRESS', '418 OAKRIDGE AVENUE, SUITE 4B'],
    ['VEHICLE MAKE / MODEL', 'VOLVO V60 CROSS COUNTRY'],
    ['CHASSIS / VIN', 'YV1LF68ACJ1408921'],
    ['DATE OF FIRST ISSUE', '14 NOVEMBER 2026'],
    ['INSPECTION VALID UNTIL', '14 NOVEMBER 2028'],
  ];

  let y = 320;
  for (const [label, val] of fields) {
    ctx.fillStyle = '#475569';
    ctx.font = '600 20px sans-serif';
    ctx.fillText(label, 145, y);
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 30px monospace';
    ctx.fillText(val, 145, y + 40);
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(145, y + 58);
    ctx.lineTo(810, y + 58);
    ctx.stroke();
    y += 116;
  }

  // Printed body block
  ctx.fillStyle = '#1e293b';
  ctx.font = '26px sans-serif';
  const notes = [
    'DECLARATION: This certificate confirms compliance with roadworthiness',
    'and emissions inspection standards under Section 19(4). Keep this',
    'sheet flat and legible when presenting for municipal verification.',
  ];
  notes.forEach((line, idx) => {
    ctx.fillText(line, 145, 1185 + idx * 42);
  });

  // Circular blue official stamp (tests stamp preservation)
  ctx.save();
  ctx.translate(930, 1430);
  ctx.rotate(-0.14);
  ctx.strokeStyle = '#1d4ed8';
  ctx.fillStyle = '#1d4ed8';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(0, 0, 128, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(0, 0, 108, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('REGISTRY OFFICE', 0, -48);
  ctx.font = 'bold 30px monospace';
  ctx.fillText('APPROVED', 0, 8);
  ctx.font = '600 20px monospace';
  ctx.fillText('24 NOV 2026', 0, 52);
  ctx.restore();

  // Signature line
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(145, 1485);
  ctx.lineTo(540, 1485);
  ctx.stroke();
  ctx.fillStyle = '#334155';
  ctx.font = '22px sans-serif';
  ctx.fillText('Authorized Registrar Signature', 145, 1525);

  return drawPaperWithPerspective(sheet, 1400, 1900, '#2c3543', 'diagonal');
}

export function createSampleInspectionA5(): HTMLCanvasElement {
  const w = 1050;
  const h = 1485;
  const sheet = document.createElement('canvas');
  sheet.width = w;
  sheet.height = h;
  const ctx = sheet.getContext('2d')!;

  // Engineering grid paper (tests grid-background removal!)
  ctx.fillStyle = '#faf8f2';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(59, 130, 246, 0.22)';
  ctx.lineWidth = 1.5;
  for (let x = 40; x < w - 40; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 40);
    ctx.lineTo(x, h - 40);
    ctx.stroke();
  }
  for (let y = 40; y < h - 40; y += 32) {
    ctx.beginPath();
    ctx.moveTo(40, y);
    ctx.lineTo(w - 40, y);
    ctx.stroke();
  }

  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 4;
  ctx.strokeRect(75, 80, w - 150, h - 160);

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 38px sans-serif';
  ctx.fillText('LAB CALIBRATION SHEET (A5)', 115, 165);
  ctx.font = '24px monospace';
  ctx.fillStyle = '#334155';
  ctx.fillText('BATCH ID: CAL-0912   TEMP: 21.4 C', 115, 215);

  const rows: [string, string, string][] = [
    ['CHANNEL 01', '10.00 V', 'PASS'],
    ['CHANNEL 02', '24.98 V', 'PASS'],
    ['CHANNEL 03', '49.95 V', 'PASS'],
    ['ZERO DRIFT', '0.002 mV', 'NOMINAL'],
    ['LINEARITY', '99.98 %', 'NOMINAL'],
  ];

  let ry = 330;
  for (const [col1, col2, col3] of rows) {
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 28px monospace';
    ctx.fillText(col1, 120, ry);
    ctx.fillText(col2, 460, ry);
    ctx.fillText(col3, 730, ry);
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(115, ry + 26);
    ctx.lineTo(w - 115, ry + 26);
    ctx.stroke();
    ry += 110;
  }

  ctx.fillStyle = '#1e293b';
  ctx.font = '26px sans-serif';
  ctx.fillText('Technician: H. Lindqvist   Shift: Morning A', 115, 975);
  ctx.fillText('All sensors verified against reference standard.', 115, 1025);

  // Red rectangular verification stamp
  ctx.save();
  ctx.translate(690, 1210);
  ctx.rotate(0.09);
  ctx.strokeStyle = '#dc2626';
  ctx.fillStyle = '#dc2626';
  ctx.lineWidth = 6;
  ctx.strokeRect(-185, -62, 370, 124);
  ctx.font = 'bold 36px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('CALIBRATED', 0, -4);
  ctx.font = '600 22px monospace';
  ctx.fillText('ISO-216 A5 RECORD', 0, 38);
  ctx.restore();

  return drawPaperWithPerspective(sheet, 1220, 1650, '#3f362d', 'corner');
}
