import { EnhancementSettings, Point, Quad } from '../types/scanner';

/**
 * Renders the source image rotated by quarterTurns (90 deg steps) and fineAngleDeg.
 */
export function renderTransformedSource(
  source: HTMLImageElement | HTMLCanvasElement,
  quarterTurns: number,
  fineAngleDeg: number
): HTMLCanvasElement {
  const srcW =
    source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const srcH =
    source instanceof HTMLImageElement ? source.naturalHeight : source.height;

  const turns = ((quarterTurns % 4) + 4) % 4;
  const swap = turns === 1 || turns === 3;
  const outW = swap ? srcH : srcW;
  const outH = swap ? srcW : srcH;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, outW);
  canvas.height = Math.max(1, outH);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return canvas;

  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, 0, outW, outH);

  ctx.save();
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate(((turns * 90 + fineAngleDeg) * Math.PI) / 180);
  ctx.drawImage(source, -srcW / 2, -srcH / 2, srcW, srcH);
  ctx.restore();

  return canvas;
}

/**
 * Orders 4 arbitrary 2D points into [TopLeft, TopRight, BottomRight, BottomLeft].
 */
export function orderQuadPoints(pts: Point[]): Quad {
  const sortedByY = [...pts].sort((a, b) => a.y - b.y);
  const top = sortedByY.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottom = sortedByY.slice(2, 4).sort((a, b) => a.x - b.x);
  return [top[0], top[1], bottom[1], bottom[0]];
}

function quadArea(q: Quad): number {
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) * 0.5;
}

function isQuadConvex(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const p0 = q[i];
    const p1 = q[(i + 1) % 4];
    const p2 = q[(i + 2) % 4];
    const cross =
      (p1.x - p0.x) * (p2.y - p1.y) - (p1.y - p0.y) * (p2.x - p1.x);
    if (Math.abs(cross) < 1e-6) return false;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/**
 * Computes Andrew's monotone chain convex hull of 2D points.
 */
function convexHull(points: Point[]): Point[] {
  if (points.length <= 3) return points;
  const sorted = [...points].sort((a, b) =>
    a.x === b.x ? a.y - b.y : a.x - b.x
  );
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Point[] = [];
  for (const p of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Point[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function pointToSegmentDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq)
  );
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Simplifies a closed convex hull polygon toward a 4-vertex quadrilateral
 * using iterative minimum-triangle-area / Ramer-Douglas-Peucker vertex pruning.
 */
function approximateQuadFromHull(hull: Point[]): Point[] | null {
  if (hull.length < 4) return null;
  const poly = [...hull];

  // Iteratively remove the vertex contributing the smallest triangle area
  // until 4 vertices remain (Visvalingam-Whyatt / quad simplification)
  while (poly.length > 4) {
    let minArea = Infinity;
    let minIdx = 0;
    const len = poly.length;
    for (let i = 0; i < len; i++) {
      const prev = poly[(i - 1 + len) % len];
      const curr = poly[i];
      const next = poly[(i + 1) % len];
      const area = Math.abs(
        0.5 *
          (prev.x * (curr.y - next.y) +
            curr.x * (next.y - prev.y) +
            next.x * (prev.y - curr.y))
      );
      if (area < minArea) {
        minArea = area;
        minIdx = i;
      }
    }
    poly.splice(minIdx, 1);
  }

  return poly.length === 4 ? poly : null;
}

/**
 * Automatically estimates 4 document corner points using:
 * 1) Grayscale conversion + 5x5 Gaussian blur
 * 2) Sobel gradients + Non-Maximum Suppression + Hysteresis (Canny edges)
 * 3) Border-contrast foreground paper segmentation + largest component contour
 * 4) Convex hull + quadrilateral approximation + bounding-box fallback
 */
export function detectDocumentCorners(canvas: HTMLCanvasElement): Quad {
  const fallback: Quad = [
    { x: 0.05, y: 0.05 },
    { x: 0.95, y: 0.05 },
    { x: 0.95, y: 0.95 },
    { x: 0.05, y: 0.95 },
  ];

  const maxDim = 320;
  const scale = Math.min(1, maxDim / Math.max(canvas.width, canvas.height));
  const w = Math.max(32, Math.round(canvas.width * scale));
  const h = Math.max(32, Math.round(canvas.height * scale));

  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  const sctx = small.getContext('2d', { willReadFrequently: true });
  if (!sctx) return fallback;
  sctx.drawImage(canvas, 0, 0, w, h);

  const d = sctx.getImageData(0, 0, w, h).data;
  const n = w * h;
  const lum = new Float32Array(n);
  const sat = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const r = d[i * 4];
    const g = d[i * 4 + 1];
    const b = d[i * 4 + 2];
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    sat[i] = Math.max(r, g, b) - Math.min(r, g, b);
  }

  // 1. 5x5 Gaussian blur (separable [1, 4, 6, 4, 1] / 16)
  const tmpBlur = new Float32Array(n);
  const blur = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const xm2 = x >= 2 ? x - 2 : 0;
      const xm1 = x >= 1 ? x - 1 : 0;
      const xp1 = x + 1 < w ? x + 1 : w - 1;
      const xp2 = x + 2 < w ? x + 2 : w - 1;
      tmpBlur[row + x] =
        (lum[row + xm2] +
          4 * lum[row + xm1] +
          6 * lum[row + x] +
          4 * lum[row + xp1] +
          lum[row + xp2]) /
        16;
    }
  }
  for (let y = 0; y < h; y++) {
    const ym2 = y >= 2 ? y - 2 : 0;
    const ym1 = y >= 1 ? y - 1 : 0;
    const yp1 = y + 1 < h ? y + 1 : h - 1;
    const yp2 = y + 2 < h ? y + 2 : h - 1;
    for (let x = 0; x < w; x++) {
      blur[y * w + x] =
        (tmpBlur[ym2 * w + x] +
          4 * tmpBlur[ym1 * w + x] +
          6 * tmpBlur[y * w + x] +
          4 * tmpBlur[yp1 * w + x] +
          tmpBlur[yp2 * w + x]) /
        16;
    }
  }

  // 2. Sobel gradients + Canny Non-Maximum Suppression & Hysteresis
  const gradMag = new Float32Array(n);
  const gradDir = new Uint8Array(n); // 0: horiz, 1: diag45, 2: vert, 3: diag135
  let maxGrad = 0;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const gx =
        -blur[(y - 1) * w + (x - 1)] +
        blur[(y - 1) * w + (x + 1)] -
        2 * blur[y * w + (x - 1)] +
        2 * blur[y * w + (x + 1)] -
        blur[(y + 1) * w + (x - 1)] +
        blur[(y + 1) * w + (x + 1)];
      const gy =
        -blur[(y - 1) * w + (x - 1)] -
        2 * blur[(y - 1) * w + x] -
        blur[(y - 1) * w + (x + 1)] +
        blur[(y + 1) * w + (x - 1)] +
        2 * blur[(y + 1) * w + x] +
        blur[(y + 1) * w + (x + 1)];

      const mag = Math.hypot(gx, gy);
      gradMag[idx] = mag;
      if (mag > maxGrad) maxGrad = mag;

      let angle = (Math.atan2(gy, gx) * 180) / Math.PI;
      if (angle < 0) angle += 180;
      if (angle < 22.5 || angle >= 157.5) gradDir[idx] = 0;
      else if (angle < 67.5) gradDir[idx] = 1;
      else if (angle < 112.5) gradDir[idx] = 2;
      else gradDir[idx] = 3;
    }
  }

  const canny = new Uint8Array(n);
  const highThresh = Math.max(28, maxGrad * 0.16);
  const lowThresh = highThresh * 0.45;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const m = gradMag[idx];
      if (m < lowThresh) continue;

      let m1 = 0;
      let m2 = 0;
      const dir = gradDir[idx];
      if (dir === 0) {
        m1 = gradMag[idx - 1];
        m2 = gradMag[idx + 1];
      } else if (dir === 1) {
        m1 = gradMag[(y - 1) * w + (x + 1)];
        m2 = gradMag[(y + 1) * w + (x - 1)];
      } else if (dir === 2) {
        m1 = gradMag[(y - 1) * w + x];
        m2 = gradMag[(y + 1) * w + x];
      } else {
        m1 = gradMag[(y - 1) * w + (x - 1)];
        m2 = gradMag[(y + 1) * w + (x + 1)];
      }

      if (m >= m1 && m >= m2) {
        canny[idx] = m >= highThresh ? 2 : 1;
      }
    }
  }

  // Hysteresis pass: promote weak edges adjacent to strong edges
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      if (canny[idx] !== 1) continue;
      let connected = false;
      for (let dy = -1; dy <= 1 && !connected; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (canny[(y + dy) * w + (x + dx)] === 2) {
            connected = true;
            break;
          }
        }
      }
      canny[idx] = connected ? 2 : 0;
    }
  }

  // 3. Border-contrast foreground paper likelihood + Otsu segmentation
  let brSum = 0,
    bgSum = 0,
    bbSum = 0,
    bLumSum = 0,
    bCount = 0;
  const margin = Math.max(2, Math.round(Math.min(w, h) * 0.035));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < margin || x >= w - margin || y < margin || y >= h - margin) {
        const idx = y * w + x;
        brSum += d[idx * 4];
        bgSum += d[idx * 4 + 1];
        bbSum += d[idx * 4 + 2];
        bLumSum += blur[idx];
        bCount++;
      }
    }
  }

  const br = brSum / Math.max(1, bCount);
  const bg = bgSum / Math.max(1, bCount);
  const bb = bbSum / Math.max(1, bCount);
  const bLum = bLumSum / Math.max(1, bCount);

  const score = new Float32Array(n);
  let maxScore = 0;
  for (let i = 0; i < n; i++) {
    const r = d[i * 4];
    const g = d[i * 4 + 1];
    const b = d[i * 4 + 2];
    const colorDiff =
      Math.abs(r - br) * 0.35 +
      Math.abs(g - bg) * 0.4 +
      Math.abs(b - bb) * 0.25;
    const lumGain = Math.max(0, blur[i] - bLum * 0.92);
    const neutralBonus = sat[i] < 45 ? 18 : 0;
    const s = colorDiff * 0.65 + lumGain * 0.7 + neutralBonus;
    score[i] = s;
    if (s > maxScore) maxScore = s;
  }

  const hist = new Int32Array(256);
  const invMax = maxScore > 1 ? 255 / maxScore : 1;
  for (let i = 0; i < n; i++) {
    const bin = Math.min(255, Math.max(0, Math.round(score[i] * invMax)));
    hist[bin]++;
  }

  let totalMean = 0;
  for (let t = 0; t < 256; t++) totalMean += t * hist[t];
  let wB = 0,
    sumB = 0,
    maxVar = -1,
    bestT = 110;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = n - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (totalMean - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > maxVar) {
      maxVar = v;
      bestT = t;
    }
  }

  const thresh = (bestT / invMax) * 0.92;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    mask[i] = score[i] >= thresh ? 1 : 0;
  }

  // Morphological closing (3x3 dilate then erode)
  const closed = new Uint8Array(n);
  const temp = new Uint8Array(n);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let hit = 0;
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (mask[(y + dy) * w + (x + dx)]) {
            hit = 1;
            break;
          }
        }
      }
      temp[y * w + x] = hit;
    }
  }
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let all = 1;
      for (let dy = -1; dy <= 1 && all; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!temp[(y + dy) * w + (x + dx)]) {
            all = 0;
            break;
          }
        }
      }
      closed[y * w + x] = all;
    }
  }

  // Largest connected component via BFS
  const visited = new Uint8Array(n);
  const queue = new Int32Array(n);
  let bestComp: number[] = [];

  for (let i = 0; i < n; i++) {
    if (!closed[i] || visited[i]) continue;
    let head = 0,
      tail = 0;
    queue[tail++] = i;
    visited[i] = 1;
    const comp: number[] = [];

    while (head < tail) {
      const idx = queue[head++];
      comp.push(idx);
      const cx = idx % w;
      const cy = (idx / w) | 0;

      if (cx > 0 && closed[idx - 1] && !visited[idx - 1]) {
        visited[idx - 1] = 1;
        queue[tail++] = idx - 1;
      }
      if (cx < w - 1 && closed[idx + 1] && !visited[idx + 1]) {
        visited[idx + 1] = 1;
        queue[tail++] = idx + 1;
      }
      if (cy > 0 && closed[idx - w] && !visited[idx - w]) {
        visited[idx - w] = 1;
        queue[tail++] = idx - w;
      }
      if (cy < h - 1 && closed[idx + w] && !visited[idx + w]) {
        visited[idx + w] = 1;
        queue[tail++] = idx + w;
      }
    }

    if (comp.length > bestComp.length) {
      bestComp = comp;
    }
  }

  if (bestComp.length < n * 0.1) {
    return fallback;
  }

  // 4. Extract boundary contour points of largest component & compute convex hull
  const compSet = new Uint8Array(n);
  let minBx = w,
    maxBx = 0,
    minBy = h,
    maxBy = 0;

  for (let k = 0; k < bestComp.length; k++) {
    const idx = bestComp[k];
    compSet[idx] = 1;
    const x = idx % w;
    const y = (idx / w) | 0;
    if (x < minBx) minBx = x;
    if (x > maxBx) maxBx = x;
    if (y < minBy) minBy = y;
    if (y > maxBy) maxBy = y;
  }

  const boundaryPts: Point[] = [];
  for (let k = 0; k < bestComp.length; k++) {
    const idx = bestComp[k];
    const x = idx % w;
    const y = (idx / w) | 0;
    const isBorder =
      x === 0 ||
      x === w - 1 ||
      y === 0 ||
      y === h - 1 ||
      !compSet[idx - 1] ||
      !compSet[idx + 1] ||
      !compSet[idx - w] ||
      !compSet[idx + w];

    if (isBorder) {
      // Snap slightly toward nearby strong Canny edge pixel within 2px if present
      let bestX = x;
      let bestY = y;
      let bestScore = canny[idx] === 2 ? 1 : 0;
      if (bestScore === 0 && x > 1 && x < w - 2 && y > 1 && y < h - 2) {
        for (let dy = -2; dy <= 2 && bestScore === 0; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const ni = (y + dy) * w + (x + dx);
            if (canny[ni] === 2) {
              bestX = x + dx;
              bestY = y + dy;
              bestScore = 1;
              break;
            }
          }
        }
      }
      boundaryPts.push({ x: bestX / w, y: bestY / h });
    }
  }

  const hull = convexHull(boundaryPts);
  const quadPts = approximateQuadFromHull(hull);

  if (quadPts) {
    const ordered = orderQuadPoints(quadPts);
    const area = quadArea(ordered);
    // Validate convexity, area bounds, and non-degenerate edge alignment
    if (
      isQuadConvex(ordered) &&
      area >= 0.1 &&
      area <= 0.97 &&
      pointToSegmentDist(ordered[0], ordered[1], ordered[3]) > 0.08
    ) {
      return ordered;
    }
  }

  // Fallback to foreground bounding box if quad approximation wasn't clean
  const bboxQuad = orderQuadPoints([
    { x: minBx / w, y: minBy / h },
    { x: maxBx / w, y: minBy / h },
    { x: maxBx / w, y: maxBy / h },
    { x: minBx / w, y: maxBy / h },
  ]);
  const bboxArea = quadArea(bboxQuad);
  if (bboxArea >= 0.1 && bboxArea <= 0.97) {
    return bboxQuad;
  }

  return fallback;
}

/**
 * Solves an 8x8 linear system Ax = b via Gaussian elimination with partial pivoting.
 */
function solveLinear8(A: number[][], b: number[]): number[] | null {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxVal = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r][col]);
      if (v > maxVal) {
        maxVal = v;
        pivotRow = r;
      }
    }
    if (maxVal < 1e-10) return null;

    if (pivotRow !== col) {
      const tmp = M[col];
      M[col] = M[pivotRow];
      M[pivotRow] = tmp;
    }

    const pivot = M[col][col];
    for (let j = col; j <= n; j++) M[col][j] /= pivot;

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (factor === 0) continue;
      for (let j = col; j <= n; j++) {
        M[r][j] -= factor * M[col][j];
      }
    }
  }

  return M.map((row) => row[n]);
}

/**
 * Computes a 3x3 inverse homography mapping destination rectangle
 * (0,0)->(dstW,0)->(dstW,dstH)->(0,dstH) to the 4 source corner coordinates.
 */
function computeDstToSrcHomography(
  dstW: number,
  dstH: number,
  srcQuadPx: [Point, Point, Point, Point]
): Float64Array | null {
  const dstPts: Point[] = [
    { x: 0, y: 0 },
    { x: dstW, y: 0 },
    { x: dstW, y: dstH },
    { x: 0, y: dstH },
  ];

  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const u = dstPts[i].x;
    const v = dstPts[i].y;
    const x = srcQuadPx[i].x;
    const y = srcQuadPx[i].y;

    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
    b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
    b.push(y);
  }

  const h = solveLinear8(A, b);
  if (!h) return null;

  return new Float64Array([h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]);
}

/**
 * Warps the 4-corner quadrilateral from sourceCanvas into a crisp rectangular
 * ImageData of exact target dimensions (dstW x dstH).
 */
export function warpPerspectiveToImageData(
  sourceCanvas: HTMLCanvasElement,
  quad: Quad,
  dstW: number,
  dstH: number
): ImageData {
  const srcW = sourceCanvas.width;
  const srcH = sourceCanvas.height;
  const sctx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const out = new ImageData(dstW, dstH);
  if (!sctx) return out;

  const srcData = sctx.getImageData(0, 0, srcW, srcH).data;
  const dstData = out.data;

  const srcQuadPx: [Point, Point, Point, Point] = [
    { x: quad[0].x * srcW, y: quad[0].y * srcH },
    { x: quad[1].x * srcW, y: quad[1].y * srcH },
    { x: quad[2].x * srcW, y: quad[2].y * srcH },
    { x: quad[3].x * srcW, y: quad[3].y * srcH },
  ];

  const H = computeDstToSrcHomography(dstW, dstH, srcQuadPx);
  if (!H) {
    // Graceful fallback draw
    const tmp = document.createElement('canvas');
    tmp.width = dstW;
    tmp.height = dstH;
    const tctx = tmp.getContext('2d');
    if (tctx) {
      tctx.drawImage(sourceCanvas, 0, 0, dstW, dstH);
      return tctx.getImageData(0, 0, dstW, dstH);
    }
    return out;
  }

  const h0 = H[0],
    h1 = H[1],
    h2 = H[2];
  const h3 = H[3],
    h4 = H[4],
    h5 = H[5];
  const h6 = H[6],
    h7 = H[7];

  const maxSrcX = srcW - 1.001;
  const maxSrcY = srcH - 1.001;

  for (let v = 0; v < dstH; v++) {
    const vH1 = h1 * v + h2;
    const vH4 = h4 * v + h5;
    const vH7 = h7 * v + 1;
    const rowOff = v * dstW * 4;

    for (let u = 0; u < dstW; u++) {
      const denom = h6 * u + vH7;
      const sx = (h0 * u + vH1) / denom;
      const sy = (h3 * u + vH4) / denom;

      const cx = sx < 0 ? 0 : sx > maxSrcX ? maxSrcX : sx;
      const cy = sy < 0 ? 0 : sy > maxSrcY ? maxSrcY : sy;

      const x0 = cx | 0;
      const y0 = cy | 0;
      const fx = cx - x0;
      const fy = cy - y0;
      const fx1 = 1 - fx;
      const fy1 = 1 - fy;

      const w00 = fx1 * fy1;
      const w10 = fx * fy1;
      const w01 = fx1 * fy;
      const w11 = fx * fy;

      const i00 = (y0 * srcW + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + srcW * 4;
      const i11 = i01 + 4;

      const o = rowOff + u * 4;
      dstData[o] =
        srcData[i00] * w00 +
        srcData[i10] * w10 +
        srcData[i01] * w01 +
        srcData[i11] * w11;
      dstData[o + 1] =
        srcData[i00 + 1] * w00 +
        srcData[i10 + 1] * w10 +
        srcData[i01 + 1] * w01 +
        srcData[i11 + 1] * w11;
      dstData[o + 2] =
        srcData[i00 + 2] * w00 +
        srcData[i10 + 2] * w10 +
        srcData[i01 + 2] * w01 +
        srcData[i11 + 2] * w11;
      dstData[o + 3] = 255;
    }
  }

  return out;
}

/**
 * Cleans warped document ImageData:
 * - Local paper background illumination estimation (removes shadows, lamp falloff, faint grids)
 * - Chroma & continuous-tone photo protection (preserves red/blue official stamps & portraits)
 * - Scan Mode rendering (Color Clean, Grayscale Scan, High-Contrast B&W)
 * - White-point cleanup, contrast curve, and unsharp mask sharpening
 */
export function cleanDocumentImageData(
  warped: ImageData,
  settings: EnhancementSettings
): ImageData {
  const w = warped.width;
  const h = warped.height;
  const src = warped.data;
  const out = new ImageData(w, h);
  const dst = out.data;

  // 1. Coarse grid for local paper background illumination & continuous-tone photo detection
  const cell = Math.max(12, Math.round(Math.min(w, h) / 42));
  const gw = Math.max(2, Math.ceil(w / cell));
  const gh = Math.max(2, Math.ceil(h / cell));
  const gn = gw * gh;

  let bgR = new Float32Array(gn);
  let bgG = new Float32Array(gn);
  let bgB = new Float32Array(gn);
  const photoWeight = new Float32Array(gn);

  // Sample every 2nd pixel inside each block for fast bright neutral background estimation
  for (let gy = 0; gy < gh; gy++) {
    const yStart = gy * cell;
    const yEnd = Math.min(h, yStart + cell);
    for (let gx = 0; gx < gw; gx++) {
      const xStart = gx * cell;
      const xEnd = Math.min(w, xStart + cell);

      const samples: { lum: number; r: number; g: number; b: number; sat: number }[] = [];
      let midtoneCount = 0;
      let totalSampled = 0;

      for (let y = yStart; y < yEnd; y += 2) {
        for (let x = xStart; x < xEnd; x += 2) {
          const i = (y * w + x) * 4;
          const r = src[i];
          const g = src[i + 1];
          const b = src[i + 2];
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          const sat = Math.max(r, g, b) - Math.min(r, g, b);
          totalSampled++;
          if (lum > 55 && lum < 195 && sat < 45) {
            midtoneCount++;
          }
          samples.push({ lum, r, g, b, sat });
        }
      }

      // Prefer low-saturation pixels when finding paper background so stamps don't tint background
      const neutral = samples.filter((s) => s.sat < 42);
      const pool = neutral.length >= 4 ? neutral : samples;
      pool.sort((a, b) => a.lum - b.lum);

      // Top 20% brightest pixels in the block estimate local paper illumination
      const startIdx = Math.floor(pool.length * 0.78);
      let sr = 0,
        sg = 0,
        sb = 0,
        cnt = 0;
      for (let k = startIdx; k < pool.length; k++) {
        sr += pool[k].r;
        sg += pool[k].g;
        sb += pool[k].b;
        cnt++;
      }
      const gi = gy * gw + gx;
      bgR[gi] = cnt > 0 ? Math.max(40, sr / cnt) : 220;
      bgG[gi] = cnt > 0 ? Math.max(40, sg / cnt) : 220;
      bgB[gi] = cnt > 0 ? Math.max(40, sb / cnt) : 220;

      // Continuous-tone photo heuristic: high density of neutral midtones
      const midRatio = totalSampled > 0 ? midtoneCount / totalSampled : 0;
      photoWeight[gi] = midRatio > 0.35 ? Math.min(1, (midRatio - 0.35) / 0.35) : 0;
    }
  }

  // Smooth & dilate background grid slightly so dark objects don't pull down local illumination
  for (let pass = 0; pass < 2; pass++) {
    const nR = new Float32Array(gn);
    const nG = new Float32Array(gn);
    const nB = new Float32Array(gn);
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        let sumR = 0,
          sumG = 0,
          sumB = 0,
          wSum = 0;
        let maxR = 0,
          maxG = 0,
          maxB = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = Math.min(gh - 1, Math.max(0, gy + dy));
          for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.min(gw - 1, Math.max(0, gx + dx));
            const idx = yy * gw + xx;
            const wt = dx === 0 && dy === 0 ? 2 : 1;
            sumR += bgR[idx] * wt;
            sumG += bgG[idx] * wt;
            sumB += bgB[idx] * wt;
            wSum += wt;
            if (bgR[idx] > maxR) maxR = bgR[idx];
            if (bgG[idx] > maxG) maxG = bgG[idx];
            if (bgB[idx] > maxB) maxB = bgB[idx];
          }
        }
        const gi = gy * gw + gx;
        // Blend local smoothed average with bright neighbor envelope to ignore large dark regions
        nR[gi] = (sumR / wSum) * 0.65 + maxR * 0.35;
        nG[gi] = (sumG / wSum) * 0.65 + maxG * 0.35;
        nB[gi] = (sumB / wSum) * 0.65 + maxB * 0.35;
      }
    }
    bgR = nR;
    bgG = nG;
    bgB = nB;
  }

  const shadowMix = settings.shadowRemoval / 100;
  const protect = settings.stampProtection / 100;
  const whiteCut = 255 - (settings.whitePoint / 100) * 62;
  const contrastFactor =
    settings.contrast >= 0
      ? 1 + (settings.contrast / 100) * 1.45
      : 1 + (settings.contrast / 100) * 0.65;

  // Working luminance buffer for optional unsharp mask
  const workR = new Float32Array(w * h);
  const workG = new Float32Array(w * h);
  const workB = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    const gyf = (y + 0.5) / cell - 0.5;
    const gy0 = Math.max(0, Math.min(gh - 1, Math.floor(gyf)));
    const gy1 = Math.max(0, Math.min(gh - 1, gy0 + 1));
    const fy = Math.max(0, Math.min(1, gyf - gy0));

    for (let x = 0; x < w; x++) {
      const gxf = (x + 0.5) / cell - 0.5;
      const gx0 = Math.max(0, Math.min(gw - 1, Math.floor(gxf)));
      const gx1 = Math.max(0, Math.min(gw - 1, gx0 + 1));
      const fx = Math.max(0, Math.min(1, gxf - gx0));

      const i00 = gy0 * gw + gx0;
      const i10 = gy0 * gw + gx1;
      const i01 = gy1 * gw + gx0;
      const i11 = gy1 * gw + gx1;

      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;

      const localBgR =
        bgR[i00] * w00 + bgR[i10] * w10 + bgR[i01] * w01 + bgR[i11] * w11;
      const localBgG =
        bgG[i00] * w00 + bgG[i10] * w10 + bgG[i01] * w01 + bgG[i11] * w11;
      const localBgB =
        bgB[i00] * w00 + bgB[i10] * w10 + bgB[i01] * w01 + bgB[i11] * w11;
      const pWeight =
        photoWeight[i00] * w00 +
        photoWeight[i10] * w10 +
        photoWeight[i01] * w01 +
        photoWeight[i11] * w11;

      const pi = y * w + x;
      const i = pi * 4;
      const r0 = src[i];
      const g0 = src[i + 1];
      const b0 = src[i + 2];

      // Normalized relative to local paper illumination
      const nr = Math.min(255, (r0 / localBgR) * 255);
      const ng = Math.min(255, (g0 / localBgG) * 255);
      const nb = Math.min(255, (b0 / localBgB) * 255);

      let r = r0 * (1 - shadowMix) + nr * shadowMix;
      let g = g0 * (1 - shadowMix) + ng * shadowMix;
      let b = b0 * (1 - shadowMix) + nb * shadowMix;

      // Stamp & photo chroma protection
      const sat0 = Math.max(r0, g0, b0) - Math.min(r0, g0, b0);
      const stampMask = sat0 > 24 ? Math.min(1, (sat0 - 24) / 48) : 0;
      const preserveMask = Math.max(stampMask, pWeight * 0.85) * protect;

      // White-point paper cleanup (suppresses faint grids/paper grain without washing out stamps/photos)
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const effWhiteCut = whiteCut + preserveMask * (255 - whiteCut) * 0.85;
      if (lum > effWhiteCut && settings.whitePoint > 0) {
        const t = Math.min(1, (lum - effWhiteCut) / Math.max(8, 255 - effWhiteCut));
        const push = t * (1 - preserveMask * 0.85);
        r = r + (255 - r) * push;
        g = g + (255 - g) * push;
        b = b + (255 - b) * push;
      }

      // Contrast adjustment centered near upper-midtone (148) to keep ink crisp & paper clean
      const effContrast = 1 + (contrastFactor - 1) * (1 - pWeight * protect * 0.65);
      r = (r - 148) * effContrast + 148;
      g = (g - 148) * effContrast + 148;
      b = (b - 148) * effContrast + 148;

      // Restore stamp vividness if protected in color-clean mode
      if (settings.scanMode === 'color-clean' && stampMask > 0 && protect > 0) {
        const lumAfter = 0.299 * r + 0.587 * g + 0.114 * b;
        const lumOrig = 0.299 * r0 + 0.587 * g0 + 0.114 * b0;
        const dr = r0 - lumOrig;
        const dg = g0 - lumOrig;
        const db = b0 - lumOrig;
        const boost = 1 + 0.25 * protect;
        const sr = lumAfter + dr * boost;
        const sg = lumAfter + dg * boost;
        const sb = lumAfter + db * boost;
        const mix = stampMask * protect;
        r = r * (1 - mix) + sr * mix;
        g = g * (1 - mix) + sg * mix;
        b = b * (1 - mix) + sb * mix;
      }

      if (settings.scanMode === 'grayscale') {
        const gl = 0.299 * r + 0.587 * g + 0.114 * b;
        r = gl;
        g = gl;
        b = gl;
      } else if (settings.scanMode === 'bw') {
        const gl = 0.299 * r + 0.587 * g + 0.114 * b;
        // Adaptive B&W threshold; protected stamp/photo regions keep smooth tonal detail if stampProtection > 0
        const bwThresh = 168 - (settings.contrast / 100) * 28;
        const bin = gl < bwThresh ? 0 : 255;
        const keepTone = preserveMask * 0.72;
        const finalL = bin * (1 - keepTone) + gl * keepTone;
        r = finalL;
        g = finalL;
        b = finalL;
      }

      workR[pi] = r < 0 ? 0 : r > 255 ? 255 : r;
      workG[pi] = g < 0 ? 0 : g > 255 ? 255 : g;
      workB[pi] = b < 0 ? 0 : b > 255 ? 255 : b;
    }
  }

  // 2. Fast 3x3 Unsharp Mask sharpening
  const sharpAmt = (settings.sharpness / 100) * 0.85;
  if (sharpAmt > 0.01) {
    for (let y = 0; y < h; y++) {
      const ym = y > 0 ? y - 1 : 0;
      const yp = y < h - 1 ? y + 1 : h - 1;
      for (let x = 0; x < w; x++) {
        const xm = x > 0 ? x - 1 : 0;
        const xp = x < w - 1 ? x + 1 : w - 1;

        const c = y * w + x;
        const top = ym * w + x;
        const bot = yp * w + x;
        const lft = y * w + xm;
        const rgt = y * w + xp;

        const blurR =
          (workR[top] + workR[bot] + workR[lft] + workR[rgt] + workR[c] * 2) / 6;
        const blurG =
          (workG[top] + workG[bot] + workG[lft] + workG[rgt] + workG[c] * 2) / 6;
        const blurB =
          (workB[top] + workB[bot] + workB[lft] + workB[rgt] + workB[c] * 2) / 6;

        const rr = workR[c] + (workR[c] - blurR) * sharpAmt;
        const gg = workG[c] + (workG[c] - blurG) * sharpAmt;
        const bb = workB[c] + (workB[c] - blurB) * sharpAmt;

        const o = c * 4;
        dst[o] = rr < 0 ? 0 : rr > 255 ? 255 : rr;
        dst[o + 1] = gg < 0 ? 0 : gg > 255 ? 255 : gg;
        dst[o + 2] = bb < 0 ? 0 : bb > 255 ? 255 : bb;
        dst[o + 3] = 255;
      }
    }
  } else {
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      dst[o] = workR[i];
      dst[o + 1] = workG[i];
      dst[o + 2] = workB[i];
      dst[o + 3] = 255;
    }
  }

  return out;
}

export function imageDataToCanvas(imgData: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = imgData.width;
  canvas.height = imgData.height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.putImageData(imgData, 0, 0);
  }
  return canvas;
}
