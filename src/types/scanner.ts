export interface Point {
  x: number; // Normalized [0, 1] relative to transformed source canvas
  y: number;
}

// Ordered: Top-Left, Top-Right, Bottom-Right, Bottom-Left
export type Quad = [Point, Point, Point, Point];

export type PaperFormatChoice = 'auto' | 'a4' | 'a5';
export type OrientationChoice = 'auto' | 'portrait' | 'landscape';
export type DpiChoice = 150 | 300;
export type ScanMode = 'color-clean' | 'grayscale' | 'bw';
export type StageViewMode = 'crop' | 'output' | 'compare';

export interface EnhancementSettings {
  scanMode: ScanMode;
  shadowRemoval: number; // 0..100
  stampProtection: number; // 0..100
  contrast: number; // -50..100
  sharpness: number; // 0..100
  whitePoint: number; // 0..100
}

export const DEFAULT_ENHANCEMENT: EnhancementSettings = {
  scanMode: 'color-clean',
  shadowRemoval: 72,
  stampProtection: 80,
  contrast: 22,
  sharpness: 38,
  whitePoint: 45,
};

export interface DocumentSpec {
  paper: 'A4' | 'A5';
  orientation: 'portrait' | 'landscape';
  widthMm: number;
  heightMm: number;
  widthPx: number;
  heightPx: number;
  dpi: DpiChoice;
  aspectRatio: number;
  detectedFromQuad: boolean;
}

export interface OcrWordBox {
  text: string;
  confidence: number;
  bbox: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
}

export interface OcrResult {
  text: string;
  confidence: number;
  wordCount: number;
  lineCount: number;
  lang: string;
  durationMs: number;
  imageWidth: number;
  imageHeight: number;
  words: OcrWordBox[];
}

export interface OcrLanguageInfo {
  code: string;
  label: string;
  nativeLabel: string;
  bundled: boolean;
  cached: boolean;
  sizeBytes?: number;
}

export type SaveMode = 'overwrite' | 'clean-suffix' | 'pdf';

export type BatchItemStatus =
  | 'queued'
  | 'detecting'
  | 'cleaning'
  | 'ocr'
  | 'saving'
  | 'done'
  | 'error';

export interface BatchItem {
  id: string;
  filename: string;
  file: File;
  status: BatchItemStatus;
  statusDetail?: string;
  error?: string;
  savedFilename?: string;
  savedMethod?: 'fs-direct' | 'download';
  ocrConfidence?: number;
  ocrWordCount?: number;
  paperSummary?: string;
}

