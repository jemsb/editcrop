import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  ClipboardPaste,
  FileImage,
  MoveHorizontal,
  ScanLine,
  Upload,
} from 'lucide-react';
import {
  DocumentSpec,
  OcrResult,
  Quad,
  StageViewMode,
} from '../types/scanner';

interface DocumentStageProps {
  sourceCanvas: HTMLCanvasElement | null;
  warpedOriginalCanvas: HTMLCanvasElement | null;
  cleanedCanvas: HTMLCanvasElement | null;
  quad: Quad;
  onQuadChange: (next: Quad) => void;
  viewMode: StageViewMode;
  zoomMode: 'fit' | 'actual';
  docSpec: DocumentSpec | null;
  ocrResult: OcrResult | null;
  showOcrBoxes: boolean;
  onOpenFile: () => void;
  onPasteImage: () => void;
  onOpenCamera: () => void;
  onLoadSample: (kind: 'a4' | 'a5') => void;
  onDropFile: (file: File) => void;
}

const CORNER_LABELS = ['Top-Left', 'Top-Right', 'Bottom-Right', 'Bottom-Left'];

export const DocumentStage: React.FC<DocumentStageProps> = ({
  sourceCanvas,
  warpedOriginalCanvas,
  cleanedCanvas,
  quad,
  onQuadChange,
  viewMode,
  zoomMode,
  docSpec,
  ocrResult,
  showOcrBoxes,
  onOpenFile,
  onPasteImage,
  onOpenCamera,
  onLoadSample,
  onDropFile,
}) => {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const cropDisplayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const outputDisplayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const compareBeforeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const compareAfterCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const loupeCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  const [activeCorner, setActiveCorner] = useState<number | null>(null);
  const [splitPct, setSplitPct] = useState(50);
  const [draggingSplit, setDraggingSplit] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [hoveredWord, setHoveredWord] = useState<{
    text: string;
    confidence: number;
  } | null>(null);

  // Track stage viewport dimensions
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setStageSize({ width, height });
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Compute rendered canvas display size inside stage
  const activeCanvas =
    viewMode === 'crop'
      ? sourceCanvas
      : viewMode === 'output'
        ? cleanedCanvas
        : cleanedCanvas || warpedOriginalCanvas;

  const padding = 40;
  const availW = Math.max(200, stageSize.width - padding);
  const availH = Math.max(200, stageSize.height - padding);

  let displayW = 0;
  let displayH = 0;
  if (activeCanvas) {
    if (zoomMode === 'actual' && viewMode !== 'compare') {
      displayW = activeCanvas.width;
      displayH = activeCanvas.height;
    } else {
      const scale = Math.min(
        availW / activeCanvas.width,
        availH / activeCanvas.height
      );
      displayW = Math.max(120, Math.round(activeCanvas.width * scale));
      displayH = Math.max(120, Math.round(activeCanvas.height * scale));
    }
  }

  // Paint canvases onto display elements
  useEffect(() => {
    if (viewMode === 'crop' && sourceCanvas && cropDisplayCanvasRef.current) {
      const c = cropDisplayCanvasRef.current;
      c.width = sourceCanvas.width;
      c.height = sourceCanvas.height;
      const ctx = c.getContext('2d');
      ctx?.drawImage(sourceCanvas, 0, 0);
    }
  }, [viewMode, sourceCanvas]);

  useEffect(() => {
    if (viewMode === 'output' && cleanedCanvas && outputDisplayCanvasRef.current) {
      const c = outputDisplayCanvasRef.current;
      c.width = cleanedCanvas.width;
      c.height = cleanedCanvas.height;
      const ctx = c.getContext('2d');
      ctx?.drawImage(cleanedCanvas, 0, 0);
    }
  }, [viewMode, cleanedCanvas]);

  useEffect(() => {
    if (viewMode === 'compare') {
      if (warpedOriginalCanvas && compareBeforeCanvasRef.current) {
        const c = compareBeforeCanvasRef.current;
        c.width = warpedOriginalCanvas.width;
        c.height = warpedOriginalCanvas.height;
        c.getContext('2d')?.drawImage(warpedOriginalCanvas, 0, 0);
      }
      if (cleanedCanvas && compareAfterCanvasRef.current) {
        const c = compareAfterCanvasRef.current;
        c.width = cleanedCanvas.width;
        c.height = cleanedCanvas.height;
        c.getContext('2d')?.drawImage(cleanedCanvas, 0, 0);
      }
    }
  }, [viewMode, warpedOriginalCanvas, cleanedCanvas]);

  // Paint magnifier loupe while dragging a corner
  useEffect(() => {
    if (
      activeCorner === null ||
      !sourceCanvas ||
      !loupeCanvasRef.current
    ) {
      return;
    }
    const lc = loupeCanvasRef.current;
    const ctx = lc.getContext('2d');
    if (!ctx) return;

    const pt = quad[activeCorner];
    const cx = pt.x * sourceCanvas.width;
    const cy = pt.y * sourceCanvas.height;
    const patchRadius = Math.max(36, Math.round(Math.min(sourceCanvas.width, sourceCanvas.height) * 0.045));

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, lc.width, lc.height);
    ctx.drawImage(
      sourceCanvas,
      cx - patchRadius,
      cy - patchRadius,
      patchRadius * 2,
      patchRadius * 2,
      0,
      0,
      lc.width,
      lc.height
    );

    // Crosshair reticle
    const mid = lc.width / 2;
    ctx.strokeStyle = 'rgba(29, 78, 216, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(mid, 0);
    ctx.lineTo(mid, lc.height);
    ctx.moveTo(0, mid);
    ctx.lineTo(lc.width, mid);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(mid, mid, 5, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }, [activeCorner, quad, sourceCanvas]);

  const frameRef = useRef<HTMLDivElement | null>(null);

  const handleCornerPointerDown = (
    index: number,
    e: React.PointerEvent<HTMLButtonElement>
  ) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setActiveCorner(index);
  };

  const handleCornerPointerMove = (
    index: number,
    e: React.PointerEvent<HTMLButtonElement>
  ) => {
    if (activeCorner !== index || !frameRef.current) return;
    const rect = frameRef.current.getBoundingClientRect();
    const nx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const ny = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    const next: Quad = [
      { ...quad[0] },
      { ...quad[1] },
      { ...quad[2] },
      { ...quad[3] },
    ];
    next[index] = { x: nx, y: ny };
    onQuadChange(next);
  };

  const handleCornerPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setActiveCorner(null);
  };

  const handleSplitPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraggingSplit(true);
    updateSplit(e.clientX);
  };

  const updateSplit = (clientX: number) => {
    if (!frameRef.current) return;
    const rect = frameRef.current.getBoundingClientRect();
    const pct = Math.min(
      98,
      Math.max(2, ((clientX - rect.left) / rect.width) * 100)
    );
    setSplitPct(pct);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => setIsDragOver(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      onDropFile(file);
    }
  };

  if (!sourceCanvas) {
    return (
      <div
        ref={stageRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`stage-backdrop relative flex flex-1 flex-col items-center justify-center p-6 transition-colors ${
          isDragOver ? 'ring-2 ring-inset ring-blue-700 bg-blue-50/40' : ''
        }`}
      >
        <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700">
            <ScanLine className="h-6 w-6 text-blue-700" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-slate-900">
            Load a document photo or scan
          </h2>
          <p className="mt-1.5 text-sm text-slate-600">
            Drop JPEG, PNG, WEBP, or BMP files here, paste from clipboard, or capture with your camera. Everything runs locally in your browser.
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
            <button
              type="button"
              onClick={onOpenFile}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Upload className="h-4 w-4" />
              Choose Image
            </button>
            <button
              type="button"
              onClick={onPasteImage}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ClipboardPaste className="h-4 w-4 text-slate-600" />
              Paste (Ctrl+V)
            </button>
            <button
              type="button"
              onClick={onOpenCamera}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Camera className="h-4 w-4 text-slate-600" />
              Camera
            </button>
          </div>

          <div className="mt-6 border-t border-slate-100 pt-5">
            <div className="text-xs font-medium text-slate-500">
              Try built-in offline test sheets
            </div>
            <div className="mt-2.5 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => onLoadSample('a4')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap cursor-pointer"
              >
                <FileImage className="h-3.5 w-3.5 text-blue-700" />
                Sample A4 Certificate
              </button>
              <button
                type="button"
                onClick={() => onLoadSample('a5')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap cursor-pointer"
              >
                <FileImage className="h-3.5 w-3.5 text-blue-700" />
                Sample A5 Calibration Sheet
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={stageRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`stage-backdrop relative flex flex-1 flex-col overflow-auto ${
        isDragOver ? 'ring-2 ring-inset ring-blue-700' : ''
      }`}
    >
      <div className="flex flex-1 items-center justify-center p-5">
        <div
          ref={frameRef}
          style={{ width: displayW, height: displayH }}
          className="relative shrink-0 bg-slate-900/10 shadow-md ring-1 ring-slate-900/10 select-none"
        >
          {/* MODE 1: Interactive Corner Cropping */}
          {viewMode === 'crop' && (
            <>
              <canvas
                ref={cropDisplayCanvasRef}
                className="block h-full w-full"
              />
              <svg
                viewBox="0 0 1000 1000"
                preserveAspectRatio="none"
                className="pointer-events-none absolute inset-0 h-full w-full"
              >
                <defs>
                  <mask id="crop-mask">
                    <rect x="0" y="0" width="1000" height="1000" fill="white" />
                    <polygon
                      points={quad
                        .map((p) => `${p.x * 1000},${p.y * 1000}`)
                        .join(' ')}
                      fill="black"
                    />
                  </mask>
                </defs>
                <rect
                  x="0"
                  y="0"
                  width="1000"
                  height="1000"
                  fill="rgba(15, 23, 42, 0.45)"
                  mask="url(#crop-mask)"
                />
                <polygon
                  points={quad
                    .map((p) => `${p.x * 1000},${p.y * 1000}`)
                    .join(' ')}
                  fill="none"
                  stroke="#2563EB"
                  strokeWidth="2.5"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>

              {quad.map((pt, idx) => (
                <button
                  key={CORNER_LABELS[idx]}
                  type="button"
                  aria-label={`Drag ${CORNER_LABELS[idx]} corner`}
                  onPointerDown={(e) => handleCornerPointerDown(idx, e)}
                  onPointerMove={(e) => handleCornerPointerMove(idx, e)}
                  onPointerUp={handleCornerPointerUp}
                  onPointerCancel={handleCornerPointerUp}
                  style={{
                    left: `${pt.x * 100}%`,
                    top: `${pt.y * 100}%`,
                  }}
                  className="group absolute -translate-x-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center touch-none cursor-grab active:cursor-grabbing focus-visible:outline-none"
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full border-2 border-white shadow-md transition-transform ${
                      activeCorner === idx
                        ? 'scale-125 bg-blue-700'
                        : 'bg-blue-600 group-hover:scale-110'
                    }`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-white" />
                  </span>
                </button>
              ))}
            </>
          )}

          {/* MODE 2: Cleaned A4 / A5 Output (+ optional OCR word bounding boxes) */}
          {viewMode === 'output' && (
            <>
              <canvas
                ref={outputDisplayCanvasRef}
                className="block h-full w-full bg-white"
              />
              {showOcrBoxes && ocrResult && ocrResult.words.length > 0 && (
                <svg
                  viewBox={`0 0 ${ocrResult.imageWidth} ${ocrResult.imageHeight}`}
                  preserveAspectRatio="none"
                  className="absolute inset-0 h-full w-full"
                >
                  {ocrResult.words.map((w, i) => (
                    <rect
                      key={`${w.text}-${i}`}
                      x={w.bbox.x0}
                      y={w.bbox.y0}
                      width={Math.max(1, w.bbox.x1 - w.bbox.x0)}
                      height={Math.max(1, w.bbox.y1 - w.bbox.y0)}
                      fill="rgba(29, 78, 216, 0.10)"
                      stroke="rgba(29, 78, 216, 0.65)"
                      strokeWidth="1.5"
                      vectorEffect="non-scaling-stroke"
                      className="cursor-pointer hover:fill-blue-600/25"
                      onMouseEnter={() =>
                        setHoveredWord({
                          text: w.text,
                          confidence: Math.round(w.confidence),
                        })
                      }
                      onMouseLeave={() => setHoveredWord(null)}
                    />
                  ))}
                </svg>
              )}
            </>
          )}

          {/* MODE 3: Split Before / After Comparison */}
          {viewMode === 'compare' && (
            <div
              onPointerDown={handleSplitPointerDown}
              onPointerMove={(e) => {
                if (draggingSplit) updateSplit(e.clientX);
              }}
              onPointerUp={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                  e.currentTarget.releasePointerCapture(e.pointerId);
                }
                setDraggingSplit(false);
              }}
              className="relative h-full w-full cursor-ew-resize touch-none overflow-hidden"
            >
              <canvas
                ref={compareAfterCanvasRef}
                className="block h-full w-full bg-white"
              />
              <div
                style={{
                  clipPath: `inset(0 ${100 - splitPct}% 0 0)`,
                }}
                className="absolute inset-0 h-full w-full"
              >
                <canvas
                  ref={compareBeforeCanvasRef}
                  className="block h-full w-full"
                />
              </div>

              {/* Divider bar */}
              <div
                style={{ left: `${splitPct}%` }}
                className="pointer-events-none absolute inset-y-0 -translate-x-1/2 flex flex-col items-center justify-center"
              >
                <div className="h-full w-0.5 bg-blue-700 shadow-sm" />
                <div className="absolute flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-blue-700 text-white shadow-md">
                  <MoveHorizontal className="h-4 w-4" />
                </div>
              </div>

              {/* Scrimmed labels */}
              <div className="pointer-events-none absolute top-3 left-3 rounded-md bg-slate-900/80 px-2.5 py-1 text-xs font-medium text-white">
                Original Warped
              </div>
              <div className="pointer-events-none absolute top-3 right-3 rounded-md bg-slate-900/80 px-2.5 py-1 text-xs font-medium text-white">
                Cleaned {docSpec?.paper || 'Output'}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Magnifier Loupe overlay while dragging corner */}
      {activeCorner !== null && viewMode === 'crop' && (
        <div
          className={`pointer-events-none absolute top-4 z-20 overflow-hidden rounded-xl border-2 border-blue-700 bg-slate-900 shadow-xl ${
            quad[activeCorner].x < 0.5 ? 'right-4' : 'left-4'
          }`}
        >
          <canvas ref={loupeCanvasRef} width={120} height={120} />
          <div className="border-t border-slate-800 bg-slate-900/95 px-2.5 py-1 text-center font-mono text-[11px] text-slate-200">
            {CORNER_LABELS[activeCorner]}
          </div>
        </div>
      )}

      {/* Hovered OCR Word Tooltip */}
      {hoveredWord && viewMode === 'output' && (
        <div className="pointer-events-none absolute bottom-11 left-1/2 -translate-x-1/2 rounded-lg bg-slate-900 px-3 py-1.5 font-mono text-xs text-white shadow-lg">
          <span>{hoveredWord.text}</span>
          <span className="mx-2 text-slate-400">·</span>
          <span>{hoveredWord.confidence}% conf</span>
        </div>
      )}

      {/* Bottom stage dimension footer bar (unboxed clean metadata) */}
      {docSpec && (
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 bg-white px-5 py-2 text-xs text-slate-600">
          <div className="flex flex-wrap items-center gap-2 font-mono">
            <span className="font-semibold text-slate-900">
              {docSpec.paper} {docSpec.orientation === 'portrait' ? 'Portrait' : 'Landscape'}
            </span>
            <span aria-hidden="true" className="text-slate-400">
              ·
            </span>
            <span>
              {docSpec.widthMm} × {docSpec.heightMm} mm
            </span>
            <span aria-hidden="true" className="text-slate-400">
              ·
            </span>
            <span>
              {docSpec.widthPx} × {docSpec.heightPx} px
            </span>
            <span aria-hidden="true" className="text-slate-400">
              ·
            </span>
            <span>{docSpec.dpi} DPI</span>
          </div>
          <div className="text-slate-500">
            {viewMode === 'crop'
              ? 'Drag the 4 corner handles to align document edges'
              : viewMode === 'compare'
                ? 'Drag divider to compare original warp vs cleaned output'
                : showOcrBoxes && ocrResult
                  ? `${ocrResult.wordCount} OCR word boxes overlaid`
                  : 'Ready for OCR or exact-scale export'}
          </div>
        </div>
      )}
    </div>
  );
};
