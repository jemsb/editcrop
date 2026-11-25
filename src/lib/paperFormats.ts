import {
  DocumentSpec,
  DpiChoice,
  OrientationChoice,
  PaperFormatChoice,
  Quad,
} from '../types/scanner';

// ISO 216 paper dimensions in millimeters
const PAPER_MM = {
  A4: { short: 210, long: 297 },
  A5: { short: 148, long: 210 },
} as const;

const MM_PER_INCH = 25.4;

export function mmToPixels(mm: number, dpi: DpiChoice): number {
  return Math.round((mm / MM_PER_INCH) * dpi);
}

/**
 * Estimates the unwarped physical aspect ratio (width / height) of a 4-point
 * quadrilateral in pixel coordinates using edge lengths.
 */
export function estimateQuadAspectRatio(
  quad: Quad,
  srcWidth: number,
  srcHeight: number
): { widthPx: number; heightPx: number; ratio: number } {
  const [tl, tr, br, bl] = quad.map((p) => ({
    x: p.x * srcWidth,
    y: p.y * srcHeight,
  }));

  const topLen = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const bottomLen = Math.hypot(br.x - bl.x, br.y - bl.y);
  const leftLen = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const rightLen = Math.hypot(br.x - tr.x, br.y - tr.y);

  const avgWidth = Math.max(1, (topLen + bottomLen) * 0.5);
  const avgHeight = Math.max(1, (leftLen + rightLen) * 0.5);

  return {
    widthPx: avgWidth,
    heightPx: avgHeight,
    ratio: avgWidth / avgHeight,
  };
}

/**
 * Resolves exact A4 or A5 pixel dimensions for the selected DPI and orientation.
 */
export function resolveDocumentSpec(
  quad: Quad,
  srcWidth: number,
  srcHeight: number,
  paperChoice: PaperFormatChoice,
  orientationChoice: OrientationChoice,
  dpi: DpiChoice
): DocumentSpec {
  const quadMetrics = estimateQuadAspectRatio(quad, srcWidth, srcHeight);

  const orientation: 'portrait' | 'landscape' =
    orientationChoice === 'auto'
      ? quadMetrics.widthPx > quadMetrics.heightPx * 1.03
        ? 'landscape'
        : 'portrait'
      : orientationChoice;

  // In Auto mode, infer A5 if the cropped region represents a compact sheet (< 1150px long edge)
  // or if explicitly chosen; otherwise default to standard A4.
  const longSideSrc = Math.max(quadMetrics.widthPx, quadMetrics.heightPx);
  const paper: 'A4' | 'A5' =
    paperChoice === 'auto'
      ? longSideSrc > 0 && longSideSrc < 1100
        ? 'A5'
        : 'A4'
      : paperChoice === 'a5'
        ? 'A5'
        : 'A4';

  const base = PAPER_MM[paper];
  const widthMm = orientation === 'portrait' ? base.short : base.long;
  const heightMm = orientation === 'portrait' ? base.long : base.short;

  const widthPx = mmToPixels(widthMm, dpi);
  const heightPx = mmToPixels(heightMm, dpi);

  return {
    paper,
    orientation,
    widthMm,
    heightMm,
    widthPx,
    heightPx,
    dpi,
    aspectRatio: widthMm / heightMm,
    detectedFromQuad: paperChoice === 'auto' || orientationChoice === 'auto',
  };
}
