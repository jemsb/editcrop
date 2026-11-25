import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Copy,
  Download,
  Eye,
  FileCode2,
  FileText,
  FolderCheck,
  FolderOpen,
  HardDriveDownload,
  RotateCcw,
  RotateCw,
  Save,
  ScanText,
  SlidersHorizontal,
  Sparkles,
  Square,
  Upload,
  WifiOff,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { CameraModal } from './components/CameraModal';
import { DocumentStage } from './components/DocumentStage';
import { OfflineDataModal } from './components/OfflineDataModal';
import { PWAInstallButton } from './components/PWAInstallButton';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import {
  ensureReadWritePermission,
  FsDirectoryHandle,
  FsFileHandle,
  isFileSystemAccessAvailable,
  isSupportedImageFilename,
  mimeTypeForExt,
  pickDirectoryWithFsApi,
  pickSingleFileWithFsApi,
  splitFilename,
  triggerBrowserDownload,
  writeBlobIntoDirectory,
  writeBlobToFileHandle,
} from './lib/fileSystemAccess';
import {
  cleanDocumentImageData,
  detectDocumentCorners,
  imageDataToCanvas,
  renderTransformedSource,
  warpPerspectiveToImageData,
} from './lib/imageProcessing';
import { listAvailableLanguages, runLocalOcr } from './lib/offlineOcr';
import { resolveDocumentSpec } from './lib/paperFormats';
import { buildSinglePagePdfFromCanvas } from './lib/pdfExport';
import {
  createSampleInspectionA5,
  createSampleRegistrationA4,
} from './lib/sampleDocuments';
import {
  BatchItem,
  DEFAULT_ENHANCEMENT,
  DpiChoice,
  EnhancementSettings,
  OcrLanguageInfo,
  OcrResult,
  OrientationChoice,
  PaperFormatChoice,
  Quad,
  SaveMode,
  ScanMode,
  StageViewMode,
} from './types/scanner';

const DEFAULT_QUAD: Quad = [
  { x: 0.05, y: 0.05 },
  { x: 0.95, y: 0.05 },
  { x: 0.95, y: 0.95 },
  { x: 0.05, y: 0.95 },
];

function decodeImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Unable to decode ${file.name}`));
    };
    img.src = url;
  });
}

function canvasToBlobAsync(
  canvas: HTMLCanvasElement,
  mime: string,
  quality = 0.92
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to encode canvas output'));
      },
      mime,
      quality
    );
  });
}

export default function App() {
  const isOnline = useOnlineStatus();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderFallbackInputRef = useRef<HTMLInputElement | null>(null);

  // Active document & File System Access handles
  const [rawSource, setRawSource] = useState<
    HTMLImageElement | HTMLCanvasElement | null
  >(null);
  const [originalFilename, setOriginalFilename] =
    useState<string>('document.png');
  const [activeFileHandle, setActiveFileHandle] =
    useState<FsFileHandle | null>(null);
  const [activeDirHandle, setActiveDirHandle] =
    useState<FsDirectoryHandle | null>(null);
  const [folderName, setFolderName] = useState<string | null>(null);

  const [quarterTurns, setQuarterTurns] = useState<number>(0);
  const [fineAngleDeg, setFineAngleDeg] = useState<number>(0);
  const [quad, setQuad] = useState<Quad>(DEFAULT_QUAD);

  // Stage & modals
  const [viewMode, setViewMode] = useState<StageViewMode>('compare');
  const [zoomMode, setZoomMode] = useState<'fit' | 'actual'>('fit');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [offlineModalOpen, setOfflineModalOpen] = useState(false);
  const [showAdvancedTuning, setShowAdvancedTuning] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  // Save & Automation rules
  const [saveMode, setSaveMode] = useState<SaveMode>('clean-suffix');
  const [saveTxtAlongside, setSaveTxtAlongside] = useState<boolean>(true);
  const [saveJsonAlongside, setSaveJsonAlongside] = useState<boolean>(false);
  const [autoRunOcr, setAutoRunOcr] = useState<boolean>(true);
  const [savingBusy, setSavingBusy] = useState<boolean>(false);

  // Paper format & DPI
  const [paperChoice, setPaperChoice] = useState<PaperFormatChoice>('auto');
  const [orientationChoice, setOrientationChoice] =
    useState<OrientationChoice>('auto');
  const [dpi, setDpi] = useState<DpiChoice>(300);

  // Enhancement settings
  const [enhancement, setEnhancement] =
    useState<EnhancementSettings>(DEFAULT_ENHANCEMENT);

  // OCR state
  const [languages, setLanguages] = useState<OcrLanguageInfo[]>([]);
  const [selectedLang, setSelectedLang] = useState<string>('eng');
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState({ status: '', progress: 0 });
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [editedOcrText, setEditedOcrText] = useState('');
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [showOcrBoxes, setShowOcrBoxes] = useState(true);
  const [copiedText, setCopiedText] = useState(false);
  const ocrAbortRef = useRef<AbortController | null>(null);

  // Batch folder processing state
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const batchStopRef = useRef(false);
  const batchHandlesRef = useRef<Map<string, FsFileHandle>>(new Map());

  const fsSupported = useMemo(() => isFileSystemAccessAvailable(), []);

  // Load OCR language catalog
  const refreshLanguages = useCallback(async () => {
    try {
      const list = await listAvailableLanguages();
      setLanguages(list);
    } catch {
      setLanguages([
        {
          code: 'eng',
          label: 'English',
          nativeLabel: 'English (Bundled)',
          bundled: true,
          cached: true,
        },
      ]);
    }
  }, []);

  useEffect(() => {
    refreshLanguages();
  }, [refreshLanguages]);

  const flashNotice = useCallback((msg: string) => {
    setStatusNotice(msg);
  }, []);

  useEffect(() => {
    if (!statusNotice) return;
    const t = setTimeout(() => setStatusNotice(null), 3800);
    return () => clearTimeout(t);
  }, [statusNotice]);

  // Transformed source canvas (rotated by 90° steps + fine angle)
  const sourceCanvas = useMemo(() => {
    if (!rawSource) return null;
    return renderTransformedSource(rawSource, quarterTurns, fineAngleDeg);
  }, [rawSource, quarterTurns, fineAngleDeg]);

  // Resolved A4/A5 physical & pixel dimensions
  const docSpec = useMemo(() => {
    if (!sourceCanvas) return null;
    return resolveDocumentSpec(
      quad,
      sourceCanvas.width,
      sourceCanvas.height,
      paperChoice,
      orientationChoice,
      dpi
    );
  }, [sourceCanvas, quad, paperChoice, orientationChoice, dpi]);

  // Preview resolution (capped at 1240px long edge for snappy interactive slider feedback)
  const previewDims = useMemo(() => {
    if (!docSpec) return null;
    const maxPreview = 1240;
    const scale = Math.min(
      1,
      maxPreview / Math.max(docSpec.widthPx, docSpec.heightPx)
    );
    return {
      width: Math.max(120, Math.round(docSpec.widthPx * scale)),
      height: Math.max(120, Math.round(docSpec.heightPx * scale)),
    };
  }, [docSpec]);

  // Warped uncleaned ImageData at preview resolution
  const warpedPreviewData = useMemo(() => {
    if (!sourceCanvas || !previewDims) return null;
    return warpPerspectiveToImageData(
      sourceCanvas,
      quad,
      previewDims.width,
      previewDims.height
    );
  }, [sourceCanvas, quad, previewDims]);

  const warpedOriginalCanvas = useMemo(() => {
    if (!warpedPreviewData) return null;
    return imageDataToCanvas(warpedPreviewData);
  }, [warpedPreviewData]);

  // Cleaned preview Canvas
  const cleanedCanvas = useMemo(() => {
    if (!warpedPreviewData) return null;
    const cleaned = cleanDocumentImageData(warpedPreviewData, enhancement);
    return imageDataToCanvas(cleaned);
  }, [warpedPreviewData, enhancement]);

  // Full-DPI target canvas generator
  const renderFullResolutionCanvas = useCallback((): HTMLCanvasElement | null => {
    if (!sourceCanvas || !docSpec) return null;
    const warpedFull = warpPerspectiveToImageData(
      sourceCanvas,
      quad,
      docSpec.widthPx,
      docSpec.heightPx
    );
    const cleanedFull = cleanDocumentImageData(warpedFull, enhancement);
    return imageDataToCanvas(cleanedFull);
  }, [sourceCanvas, docSpec, quad, enhancement]);

  // Execute OCR on any full-res canvas
  const executeOcrOnCanvas = useCallback(
    async (canvas: HTMLCanvasElement, lang: string): Promise<OcrResult> => {
      ocrAbortRef.current?.abort();
      const controller = new AbortController();
      ocrAbortRef.current = controller;
      setOcrRunning(true);
      setOcrError(null);
      setOcrProgress({ status: 'Starting local OCR engine', progress: 0.05 });

      try {
        const result = await runLocalOcr(
          canvas,
          lang,
          setOcrProgress,
          controller.signal
        );
        setOcrResult(result);
        setEditedOcrText(result.text);
        return result;
      } finally {
        setOcrRunning(false);
        ocrAbortRef.current = null;
      }
    },
    []
  );

  // Load and automatically process a single File
  const loadAndAutoProcessFile = useCallback(
    async (
      file: File,
      options?: {
        fileHandle?: FsFileHandle | null;
        dirHandle?: FsDirectoryHandle | null;
        preserveFolder?: boolean;
      }
    ) => {
      try {
        const img = await decodeImageFile(file);
        setOriginalFilename(file.name || 'document.png');
        setActiveFileHandle(options?.fileHandle ?? null);
        if (!options?.preserveFolder) {
          setActiveDirHandle(options?.dirHandle ?? null);
          setFolderName(options?.dirHandle ? options.dirHandle.name : null);
        }

        setQuarterTurns(0);
        setFineAngleDeg(0);
        setRawSource(img);
        setOcrResult(null);
        setEditedOcrText('');
        setOcrError(null);

        const initialCanvas = renderTransformedSource(img, 0, 0);
        const detectedQuad = detectDocumentCorners(initialCanvas);
        setQuad(detectedQuad);
        setViewMode('compare');

        if (autoRunOcr) {
          const resolvedSpec = resolveDocumentSpec(
            detectedQuad,
            initialCanvas.width,
            initialCanvas.height,
            paperChoice,
            orientationChoice,
            dpi
          );
          const warpedFull = warpPerspectiveToImageData(
            initialCanvas,
            detectedQuad,
            resolvedSpec.widthPx,
            resolvedSpec.heightPx
          );
          const cleanedFull = cleanDocumentImageData(warpedFull, enhancement);
          const fullCanvas = imageDataToCanvas(cleanedFull);
          await executeOcrOnCanvas(fullCanvas, selectedLang);
          await refreshLanguages();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Processing failed';
        if (msg !== 'OCR cancelled') {
          setOcrError(msg);
          flashNotice(msg);
        }
      }
    },
    [
      autoRunOcr,
      dpi,
      enhancement,
      executeOcrOnCanvas,
      flashNotice,
      orientationChoice,
      paperChoice,
      refreshLanguages,
      selectedLang,
    ]
  );

  // Open single file via File System Access API (with <input type="file"> fallback)
  const handleOpenSingleFile = async () => {
    try {
      const picked = await pickSingleFileWithFsApi();
      if (!picked) return;
      setBatchItems([]);
      setSelectedBatchId(null);
      await loadAndAutoProcessFile(picked.file, {
        fileHandle: picked.handle,
        dirHandle: picked.dirHandle ?? null,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      // Unsupported or SecurityError inside iframe -> clean <input type="file"> fallback
      fileInputRef.current?.click();
    }
  };

  // Save a processed canvas + optional OCR files using SaveMode & File System Access API
  const saveProcessedOutput = useCallback(
    async (params: {
      fullCanvas: HTMLCanvasElement;
      origFilename: string;
      spec: NonNullable<typeof docSpec>;
      ocr: OcrResult | null;
      ocrText: string;
      fileHandle: FsFileHandle | null;
      dirHandle: FsDirectoryHandle | null;
    }): Promise<{ savedFilename: string; method: 'fs-direct' | 'download' }> => {
      const {
        fullCanvas,
        origFilename,
        spec,
        ocr,
        ocrText,
        fileHandle,
        dirHandle,
      } = params;
      const { stem, ext } = splitFilename(origFilename);
      const { mime, normalizedExt } = mimeTypeForExt(ext);

      let outFilename = origFilename;
      let outBlob: Blob;

      if (saveMode === 'pdf') {
        outFilename = `${stem}.pdf`;
        outBlob = buildSinglePagePdfFromCanvas(
          fullCanvas,
          spec.widthMm,
          spec.heightMm,
          0.92
        );
      } else if (saveMode === 'clean-suffix') {
        outFilename = `${stem}_clean.${normalizedExt}`;
        outBlob = await canvasToBlobAsync(fullCanvas, mime, 0.92);
      } else {
        // overwrite original
        outFilename = origFilename;
        outBlob = await canvasToBlobAsync(fullCanvas, mime, 0.92);
      }

      let usedMethod: 'fs-direct' | 'download' = 'download';

      if (dirHandle) {
        const ok = await ensureReadWritePermission(dirHandle);
        if (ok) {
          if (saveMode === 'overwrite' && fileHandle) {
            await writeBlobToFileHandle(fileHandle, outBlob);
          } else {
            await writeBlobIntoDirectory(dirHandle, outFilename, outBlob);
          }

          if (saveTxtAlongside && ocrText.trim()) {
            await writeBlobIntoDirectory(
              dirHandle,
              `${stem}.txt`,
              new Blob([ocrText], { type: 'text/plain;charset=utf-8' })
            );
          }
          if (saveJsonAlongside && ocr) {
            const payload = {
              document: origFilename,
              savedAs: outFilename,
              paper: spec.paper,
              orientation: spec.orientation,
              dpi: spec.dpi,
              language: ocr.lang,
              confidence: ocr.confidence,
              wordCount: ocr.wordCount,
              lineCount: ocr.lineCount,
              text: ocrText,
              words: ocr.words,
            };
            await writeBlobIntoDirectory(
              dirHandle,
              `${stem}.json`,
              new Blob([JSON.stringify(payload, null, 2)], {
                type: 'application/json;charset=utf-8',
              })
            );
          }
          usedMethod = 'fs-direct';
          return { savedFilename: outFilename, method: usedMethod };
        }
      } else if (saveMode === 'overwrite' && fileHandle) {
        const ok = await ensureReadWritePermission(fileHandle);
        if (ok) {
          await writeBlobToFileHandle(fileHandle, outBlob);
          usedMethod = 'fs-direct';
          // Note: companion .txt/.json still fall back to browser download if only a single file handle was picked
          if (saveTxtAlongside && ocrText.trim()) {
            triggerBrowserDownload(
              new Blob([ocrText], { type: 'text/plain;charset=utf-8' }),
              `${stem}.txt`
            );
          }
          if (saveJsonAlongside && ocr) {
            triggerBrowserDownload(
              new Blob(
                [
                  JSON.stringify(
                    {
                      document: origFilename,
                      text: ocrText,
                      confidence: ocr.confidence,
                      words: ocr.words,
                    },
                    null,
                    2
                  ),
                ],
                { type: 'application/json;charset=utf-8' }
              ),
              `${stem}.json`
            );
          }
          return { savedFilename: outFilename, method: usedMethod };
        }
      }

      // Browser download fallback
      triggerBrowserDownload(outBlob, outFilename);
      if (saveTxtAlongside && ocrText.trim()) {
        triggerBrowserDownload(
          new Blob([ocrText], { type: 'text/plain;charset=utf-8' }),
          `${stem}.txt`
        );
      }
      if (saveJsonAlongside && ocr) {
        triggerBrowserDownload(
          new Blob(
            [
              JSON.stringify(
                {
                  document: origFilename,
                  savedAs: outFilename,
                  paper: spec.paper,
                  orientation: spec.orientation,
                  dpi: spec.dpi,
                  language: ocr.lang,
                  confidence: ocr.confidence,
                  wordCount: ocr.wordCount,
                  lineCount: ocr.lineCount,
                  text: ocrText,
                  words: ocr.words,
                },
                null,
                2
              ),
            ],
            { type: 'application/json;charset=utf-8' }
          ),
          `${stem}.json`
        );
      }
      return { savedFilename: outFilename, method: 'download' };
    },
    [saveJsonAlongside, saveMode, saveTxtAlongside]
  );

  // Batch folder runner
  const runBatchEntries = useCallback(
    async (
      entries: Array<{ file: File; fileHandle?: FsFileHandle }>,
      dirHandle: FsDirectoryHandle | null,
      pickedFolderLabel: string
    ) => {
      if (entries.length === 0) {
        flashNotice('No supported images (JPG, PNG, WEBP, BMP) found in folder.');
        return;
      }

      batchStopRef.current = false;
      setActiveDirHandle(dirHandle);
      setFolderName(pickedFolderLabel);
      setBatchRunning(true);

      const handlesMap = new Map<string, FsFileHandle>();
      const initialItems: BatchItem[] = entries.map((e, idx) => {
        const id = `${idx}-${e.file.name}`;
        if (e.fileHandle) handlesMap.set(id, e.fileHandle);
        return {
          id,
          filename: e.file.name,
          file: e.file,
          status: 'queued',
        };
      });
      batchHandlesRef.current = handlesMap;
      setBatchItems(initialItems);

      const updateItem = (id: string, patch: Partial<BatchItem>) => {
        setBatchItems((prev) =>
          prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
        );
      };

      for (const item of initialItems) {
        if (batchStopRef.current) break;

        setSelectedBatchId(item.id);
        const fHandle = handlesMap.get(item.id) ?? null;

        try {
          updateItem(item.id, {
            status: 'detecting',
            statusDetail: 'Detecting edges & warping',
          });

          const img = await decodeImageFile(item.file);
          const transformed = renderTransformedSource(img, 0, 0);
          const detectedQuad = detectDocumentCorners(transformed);
          const resolvedSpec = resolveDocumentSpec(
            detectedQuad,
            transformed.width,
            transformed.height,
            paperChoice,
            orientationChoice,
            dpi
          );

          // Update live preview stage
          setOriginalFilename(item.file.name);
          setActiveFileHandle(fHandle);
          setQuarterTurns(0);
          setFineAngleDeg(0);
          setRawSource(img);
          setQuad(detectedQuad);
          setViewMode('compare');

          updateItem(item.id, {
            status: 'cleaning',
            statusDetail: `Cleaning ${resolvedSpec.paper} @ ${resolvedSpec.dpi} DPI`,
            paperSummary: `${resolvedSpec.paper} ${resolvedSpec.orientation === 'portrait' ? 'Port' : 'Land'}`,
          });

          const warpedFull = warpPerspectiveToImageData(
            transformed,
            detectedQuad,
            resolvedSpec.widthPx,
            resolvedSpec.heightPx
          );
          const cleanedFull = cleanDocumentImageData(warpedFull, enhancement);
          const fullCanvas = imageDataToCanvas(cleanedFull);

          let ocr: OcrResult | null = null;
          if (autoRunOcr) {
            updateItem(item.id, {
              status: 'ocr',
              statusDetail: `OCR (${selectedLang})`,
            });
            ocr = await executeOcrOnCanvas(fullCanvas, selectedLang);
          }

          updateItem(item.id, {
            status: 'saving',
            statusDetail: dirHandle ? 'Writing to folder' : 'Downloading',
          });

          const saved = await saveProcessedOutput({
            fullCanvas,
            origFilename: item.file.name,
            spec: resolvedSpec,
            ocr,
            ocrText: ocr?.text || '',
            fileHandle: fHandle,
            dirHandle,
          });

          updateItem(item.id, {
            status: 'done',
            statusDetail: saved.method === 'fs-direct' ? 'Saved in folder' : 'Downloaded',
            savedFilename: saved.savedFilename,
            savedMethod: saved.method,
            ocrConfidence: ocr?.confidence,
            ocrWordCount: ocr?.wordCount,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed';
          updateItem(item.id, {
            status: 'error',
            error: msg,
            statusDetail: 'Error',
          });
        }
      }

      setBatchRunning(false);
      await refreshLanguages();
      flashNotice(
        dirHandle
          ? `Batch complete — files written directly to "${pickedFolderLabel}".`
          : `Batch complete — processed ${entries.length} document(s).`
      );
    },
    [
      autoRunOcr,
      dpi,
      enhancement,
      executeOcrOnCanvas,
      flashNotice,
      orientationChoice,
      paperChoice,
      refreshLanguages,
      saveProcessedOutput,
      selectedLang,
    ]
  );

  // Open & Auto-Process Folder
  const handleOpenFolder = async () => {
    try {
      const picked = await pickDirectoryWithFsApi();
      if (!picked) return;
      await runBatchEntries(
        picked.entries,
        picked.dirHandle,
        picked.dirHandle.name
      );
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      // Fallback to <input webkitdirectory> if File System Access API is blocked/unsupported
      if (
        err instanceof Error &&
        (err.message === 'FS_UNSUPPORTED' || err.name === 'SecurityError')
      ) {
        flashNotice(
          'Direct folder write restricted here; using browser folder input + downloads.'
        );
      }
      folderFallbackInputRef.current?.click();
    }
  };

  // Global Ctrl/Cmd+V paste handler
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            e.preventDefault();
            setBatchItems([]);
            setSelectedBatchId(null);
            loadAndAutoProcessFile(
              new File([blob], 'pasted-document.png', { type: blob.type })
            );
            return;
          }
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [loadAndAutoProcessFile]);

  const handlePasteButton = async () => {
    try {
      if (!navigator.clipboard || !navigator.clipboard.read) {
        flashNotice('Press Ctrl+V (or Cmd+V) to paste an image from clipboard.');
        return;
      }
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imgType = item.types.find((t) => t.startsWith('image/'));
        if (imgType) {
          const blob = await item.getType(imgType);
          setBatchItems([]);
          setSelectedBatchId(null);
          await loadAndAutoProcessFile(
            new File([blob], 'pasted-document.png', { type: imgType })
          );
          return;
        }
      }
      flashNotice('No image found in clipboard.');
    } catch {
      flashNotice('Press Ctrl+V (or Cmd+V) to paste an image from clipboard.');
    }
  };

  const handleCameraCapture = async (canvas: HTMLCanvasElement) => {
    const blob = await canvasToBlobAsync(canvas, 'image/png');
    setBatchItems([]);
    setSelectedBatchId(null);
    await loadAndAutoProcessFile(new File([blob], 'camera-scan.png', { type: 'image/png' }));
  };

  const handleLoadSample = async (kind: 'a4' | 'a5') => {
    const sampleCanvas =
      kind === 'a4'
        ? createSampleRegistrationA4()
        : createSampleInspectionA5();
    const blob = await canvasToBlobAsync(sampleCanvas, 'image/png');
    const filename =
      kind === 'a4' ? 'sample-registration-a4.png' : 'sample-calibration-a5.png';
    setBatchItems([]);
    setSelectedBatchId(null);
    setPaperChoice(kind);
    setOrientationChoice('portrait');
    await loadAndAutoProcessFile(new File([blob], filename, { type: 'image/png' }));
  };

  const handleAutoDetectCorners = () => {
    if (!sourceCanvas) return;
    const detected = detectDocumentCorners(sourceCanvas);
    setQuad(detected);
    setViewMode('crop');
    flashNotice('Document corners re-estimated.');
  };

  const handleRunOcrManual = async () => {
    if (!sourceCanvas || !docSpec) return;
    if (ocrRunning) {
      ocrAbortRef.current?.abort();
      setOcrRunning(false);
      return;
    }
    try {
      const fullCanvas = renderFullResolutionCanvas();
      if (!fullCanvas) return;
      await executeOcrOnCanvas(fullCanvas, selectedLang);
      setShowOcrBoxes(true);
      await refreshLanguages();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'OCR failed';
      if (msg !== 'OCR cancelled') setOcrError(msg);
    }
  };

  // Save current document back to original folder/file or browser download
  const handleSaveCurrent = async () => {
    if (!docSpec) return;
    setSavingBusy(true);
    await new Promise((r) => setTimeout(r, 15));
    try {
      const fullCanvas = renderFullResolutionCanvas();
      if (!fullCanvas) return;

      const res = await saveProcessedOutput({
        fullCanvas,
        origFilename: originalFilename,
        spec: docSpec,
        ocr: ocrResult,
        ocrText: editedOcrText,
        fileHandle: activeFileHandle,
        dirHandle: activeDirHandle,
      });

      if (res.method === 'fs-direct') {
        flashNotice(`Saved "${res.savedFilename}" directly to original folder.`);
      } else {
        flashNotice(`Downloaded "${res.savedFilename}".`);
      }
    } catch (err) {
      flashNotice(err instanceof Error ? err.message : 'Failed to save file');
    } finally {
      setSavingBusy(false);
    }
  };

  const handleQuickDownload = async (format: 'png' | 'jpeg' | 'pdf') => {
    if (!docSpec) return;
    setSavingBusy(true);
    await new Promise((r) => setTimeout(r, 15));
    try {
      const fullCanvas = renderFullResolutionCanvas();
      if (!fullCanvas) return;
      const { stem } = splitFilename(originalFilename);
      if (format === 'png') {
        const blob = await canvasToBlobAsync(fullCanvas, 'image/png');
        triggerBrowserDownload(blob, `${stem}_clean.png`);
      } else if (format === 'jpeg') {
        const blob = await canvasToBlobAsync(fullCanvas, 'image/jpeg', 0.92);
        triggerBrowserDownload(blob, `${stem}_clean.jpg`);
      } else {
        const pdf = buildSinglePagePdfFromCanvas(
          fullCanvas,
          docSpec.widthMm,
          docSpec.heightMm,
          0.92
        );
        triggerBrowserDownload(pdf, `${stem}.pdf`);
      }
    } finally {
      setSavingBusy(false);
    }
  };

  const handleCopyOcrText = async () => {
    if (!editedOcrText) return;
    try {
      await navigator.clipboard.writeText(editedOcrText);
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 1800);
    } catch {
      flashNotice('Clipboard write blocked — select and copy text manually.');
    }
  };

  const handleDownloadOcrTxt = () => {
    if (!editedOcrText) return;
    const { stem } = splitFilename(originalFilename);
    triggerBrowserDownload(
      new Blob([editedOcrText], { type: 'text/plain;charset=utf-8' }),
      `${stem}.txt`
    );
  };

  const handleDownloadOcrJson = () => {
    if (!ocrResult) return;
    const { stem } = splitFilename(originalFilename);
    const payload = {
      document: originalFilename,
      paper: docSpec?.paper,
      orientation: docSpec?.orientation,
      dpi: docSpec?.dpi,
      language: ocrResult.lang,
      confidence: ocrResult.confidence,
      wordCount: ocrResult.wordCount,
      lineCount: ocrResult.lineCount,
      text: editedOcrText,
      words: ocrResult.words,
    };
    triggerBrowserDownload(
      new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json;charset=utf-8',
      }),
      `${stem}.json`
    );
  };

  const batchDoneCount = batchItems.filter(
    (b) => b.status === 'done' || b.status === 'error'
  ).length;

  const canDirectSaveInPlace = Boolean(
    activeDirHandle || (activeFileHandle && saveMode === 'overwrite')
  );

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      {/* Hidden standard file & fallback directory inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            setBatchItems([]);
            setSelectedBatchId(null);
            loadAndAutoProcessFile(f);
          }
          e.target.value = '';
        }}
      />
      <input
        ref={folderFallbackInputRef}
        type="file"
        multiple
        {...({
          webkitdirectory: '',
          directory: '',
        } as React.InputHTMLAttributes<HTMLInputElement>)}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []).filter((f) =>
            isSupportedImageFilename(f.name)
          );
          files.sort((a, b) => a.name.localeCompare(b.name));
          const firstRel = (files[0] as File & { webkitRelativePath?: string })
            ?.webkitRelativePath;
          const label = firstRel ? firstRel.split('/')[0] : 'Selected Folder';
          if (files.length > 0) {
            runBatchEntries(
              files.map((file) => ({ file })),
              null,
              label
            );
          } else {
            flashNotice('No supported images found in selected folder.');
          }
          e.target.value = '';
        }}
      />

      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="flex h-14 items-center justify-between gap-8 border-b border-slate-200 bg-white px-5 shrink-0">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="/"
          onClick={(e) => e.preventDefault()}
          className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          FolioScan
        </a>

        {/* Zone 2: Concise single-line navigation links */}
        <nav
          aria-label="Workspace views"
          className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600"
        >
          <button
            type="button"
            onClick={() => setViewMode('compare')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              viewMode === 'compare'
                ? 'text-slate-900 underline decoration-blue-700 decoration-2 underline-offset-4'
                : 'hover:text-slate-900'
            }`}
          >
            Before / After
          </button>
          <button
            type="button"
            onClick={() => setViewMode('output')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              viewMode === 'output'
                ? 'text-slate-900 underline decoration-blue-700 decoration-2 underline-offset-4'
                : 'hover:text-slate-900'
            }`}
          >
            Cleaned Output
          </button>
          <button
            type="button"
            onClick={() => setViewMode('crop')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              viewMode === 'crop'
                ? 'text-slate-900 underline decoration-blue-700 decoration-2 underline-offset-4'
                : 'hover:text-slate-900'
            }`}
          >
            Manual Adjust
          </button>
          <button
            type="button"
            onClick={() => setOfflineModalOpen(true)}
            className="py-1 text-slate-600 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            OCR Languages
          </button>
        </nav>

        {/* Zone 3: Primary action (+ PWA install button) */}
        <div className="flex items-center gap-2.5 shrink-0">
          <PWAInstallButton />
          <button
            type="button"
            disabled={batchRunning}
            onClick={handleOpenFolder}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Open &amp; Auto-Process Folder
          </button>
        </div>
      </header>

      {/* Secondary Workspace Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-2 shrink-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={batchRunning}
            onClick={handleOpenSingleFile}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Upload className="h-3.5 w-3.5 text-blue-700" />
            Open File
          </button>
          <button
            type="button"
            disabled={batchRunning}
            onClick={handlePasteButton}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ClipboardPaste className="h-3.5 w-3.5 text-slate-500" />
            Paste
          </button>
          <button
            type="button"
            disabled={batchRunning}
            onClick={() => setCameraOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Camera className="h-3.5 w-3.5 text-slate-500" />
            Camera
          </button>
          <span className="mx-1 h-4 w-px bg-slate-200" aria-hidden="true" />
          <button
            type="button"
            disabled={batchRunning}
            onClick={() => handleLoadSample('a4')}
            className="rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            Sample A4
          </button>
          <button
            type="button"
            disabled={batchRunning}
            onClick={() => handleLoadSample('a5')}
            className="rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            Sample A5
          </button>

          {/* Active file & folder indicator (unboxed clean metadata) */}
          {sourceCanvas && (
            <div className="hidden xl:flex items-center gap-1.5 pl-3 text-xs text-slate-500">
              <span aria-hidden="true">·</span>
              {folderName && (
                <>
                  <span className="font-medium text-slate-700">
                    {folderName} /
                  </span>
                </>
              )}
              <span className="max-w-[180px] truncate font-mono text-slate-800">
                {originalFilename}
              </span>
            </div>
          )}
        </div>

        {/* View switcher & manual fine-tune controls */}
        <div className="flex flex-wrap items-center gap-2">
          {sourceCanvas && (
            <>
              <div className="flex items-center rounded-lg bg-slate-100 p-0.5">
                {(
                  [
                    ['compare', 'Compare'],
                    ['output', 'Cleaned'],
                    ['crop', 'Adjust'],
                  ] as [StageViewMode, string][]
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setViewMode(mode)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      viewMode === mode
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <span className="h-4 w-px bg-slate-200" aria-hidden="true" />

              <button
                type="button"
                onClick={() => setQuarterTurns((t) => (t + 3) % 4)}
                aria-label="Rotate 90 degrees left"
                title="Rotate 90° Left"
                className="rounded-md border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setQuarterTurns((t) => (t + 1) % 4)}
                aria-label="Rotate 90 degrees right"
                title="Rotate 90° Right"
                className="rounded-md border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <RotateCw className="h-3.5 w-3.5" />
              </button>

              <div className="hidden sm:flex items-center gap-2 px-1">
                <label
                  htmlFor="fine-angle"
                  className="text-xs text-slate-500 whitespace-nowrap"
                >
                  Tilt
                </label>
                <input
                  id="fine-angle"
                  type="range"
                  min={-15}
                  max={15}
                  step={0.5}
                  value={fineAngleDeg}
                  onChange={(e) => setFineAngleDeg(Number(e.target.value))}
                  className="studio-slider w-20"
                />
                <button
                  type="button"
                  onClick={() => setFineAngleDeg(0)}
                  title="Reset fine angle"
                  className="w-11 text-right font-mono text-xs text-slate-700 hover:text-blue-700 cursor-pointer"
                >
                  {fineAngleDeg > 0 ? `+${fineAngleDeg}°` : `${fineAngleDeg}°`}
                </button>
              </div>

              <button
                type="button"
                onClick={handleAutoDetectCorners}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Sparkles className="h-3.5 w-3.5 text-blue-700" />
                Re-Detect
              </button>

              {viewMode !== 'compare' && (
                <button
                  type="button"
                  onClick={() =>
                    setZoomMode((z) => (z === 'fit' ? 'actual' : 'fit'))
                  }
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {zoomMode === 'fit' ? (
                    <>
                      <ZoomIn className="h-3.5 w-3.5" />
                      100%
                    </>
                  ) : (
                    <>
                      <ZoomOut className="h-3.5 w-3.5" />
                      Fit
                    </>
                  )}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Main Split Workspace */}
      <main className="flex flex-1 flex-col lg:flex-row min-h-0">
        {/* Left/Center Document Stage */}
        <DocumentStage
          sourceCanvas={sourceCanvas}
          warpedOriginalCanvas={warpedOriginalCanvas}
          cleanedCanvas={cleanedCanvas}
          quad={quad}
          onQuadChange={setQuad}
          viewMode={viewMode}
          zoomMode={zoomMode}
          docSpec={docSpec}
          ocrResult={ocrResult}
          showOcrBoxes={showOcrBoxes}
          onOpenFile={handleOpenSingleFile}
          onPasteImage={handlePasteButton}
          onOpenCamera={() => setCameraOpen(true)}
          onLoadSample={handleLoadSample}
          onDropFile={(file) => {
            setBatchItems([]);
            setSelectedBatchId(null);
            loadAndAutoProcessFile(file);
          }}
        />

        {/* Right Controls, Save Rules, Batch Queue & OCR Inspector */}
        <aside className="flex w-full lg:w-[400px] shrink-0 flex-col border-t lg:border-t-0 lg:border-l border-slate-200 bg-white lg:max-h-[calc(100vh-6.5rem)] lg:overflow-y-auto">
          {/* 01. Save Mode & Automation */}
          <section className="border-b border-slate-200 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold tracking-wide text-slate-900">
                01. Save Rule &amp; Auto-Pipeline
              </h2>
              <span className="text-[11px] text-slate-500">
                {canDirectSaveInPlace
                  ? 'Direct folder write'
                  : fsSupported
                    ? 'File System API ready'
                    : 'Download fallback'}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
              {(
                [
                  ['overwrite', 'Overwrite'],
                  ['clean-suffix', 'Save _clean'],
                  ['pdf', 'Save PDF'],
                ] as [SaveMode, string][]
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSaveMode(mode)}
                  className={`rounded-md py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    saveMode === mode
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-700">
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoRunOcr}
                  onChange={(e) => setAutoRunOcr(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-blue-700 focus:ring-blue-700"
                />
                <span>Auto OCR</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={saveTxtAlongside}
                  onChange={(e) => setSaveTxtAlongside(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-blue-700 focus:ring-blue-700"
                />
                <span>Save .txt</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={saveJsonAlongside}
                  onChange={(e) => setSaveJsonAlongside(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-blue-700 focus:ring-blue-700"
                />
                <span>Save .json</span>
              </label>
            </div>

            {sourceCanvas && (
              <div className="mt-3.5 flex items-center gap-2">
                <button
                  type="button"
                  disabled={savingBusy || batchRunning}
                  onClick={handleSaveCurrent}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-45 whitespace-nowrap cursor-pointer"
                >
                  {canDirectSaveInPlace ? (
                    <Save className="h-3.5 w-3.5" />
                  ) : (
                    <HardDriveDownload className="h-3.5 w-3.5" />
                  )}
                  {savingBusy
                    ? 'Saving...'
                    : canDirectSaveInPlace
                      ? 'Save Back to Folder'
                      : 'Download Processed File'}
                </button>
              </div>
            )}
          </section>

          {/* Batch Queue Panel (visible when a folder is opened) */}
          {batchItems.length > 0 && (
            <section className="border-b border-slate-200 p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FolderCheck className="h-4 w-4 text-blue-700" />
                  <h2 className="text-xs font-semibold tracking-wide text-slate-900">
                    Folder Batch Queue
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-slate-600">
                    {batchDoneCount}/{batchItems.length}
                  </span>
                  {batchRunning && (
                    <button
                      type="button"
                      onClick={() => {
                        batchStopRef.current = true;
                      }}
                      className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 hover:bg-red-100 cursor-pointer"
                    >
                      <Square className="h-2.5 w-2.5 fill-current" />
                      Stop
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  style={{
                    width: `${Math.round(
                      (batchDoneCount / Math.max(1, batchItems.length)) * 100
                    )}%`,
                  }}
                  className="h-full bg-blue-700 transition-all duration-150"
                />
              </div>

              <div className="mt-3 max-h-44 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200">
                {batchItems.map((item) => {
                  const isSel = selectedBatchId === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={batchRunning}
                      onClick={() => {
                        setSelectedBatchId(item.id);
                        loadAndAutoProcessFile(item.file, {
                          fileHandle: batchHandlesRef.current.get(item.id) ?? null,
                          preserveFolder: true,
                        });
                      }}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors cursor-pointer disabled:cursor-default ${
                        isSel ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-slate-900">
                          {item.filename}
                        </div>
                        <div className="truncate text-[11px] text-slate-500">
                          {item.error
                            ? item.error
                            : item.savedFilename
                              ? `${item.savedFilename}${
                                  item.ocrConfidence !== undefined
                                    ? ` · ${item.ocrConfidence}% OCR`
                                    : ''
                                }`
                              : item.statusDetail || 'Waiting in queue'}
                        </div>
                      </div>
                      <span
                        className={`font-mono text-[11px] shrink-0 ${
                          item.status === 'done'
                            ? 'text-emerald-700 font-semibold'
                            : item.status === 'error'
                              ? 'text-red-700 font-semibold'
                              : item.status === 'queued'
                                ? 'text-slate-400'
                                : 'text-blue-700 font-semibold'
                        }`}
                      >
                        {item.status === 'done'
                          ? 'Done'
                          : item.status === 'error'
                            ? 'Error'
                            : item.status === 'queued'
                              ? 'Queued'
                              : 'Running'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* 02. Paper Format & Scale */}
          <section className="border-b border-slate-200 p-5">
            <h2 className="text-xs font-semibold tracking-wide text-slate-900">
              02. Paper Format &amp; Scale
            </h2>

            <div className="mt-3 space-y-3">
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs text-slate-600">
                  <span>Target Size</span>
                  {docSpec && (
                    <span className="font-mono text-slate-900">
                      {docSpec.paper} ({docSpec.widthMm}×{docSpec.heightMm} mm)
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
                  {(
                    [
                      ['auto', 'Auto A4/A5'],
                      ['a4', 'A4'],
                      ['a5', 'A5'],
                    ] as [PaperFormatChoice, string][]
                  ).map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setPaperChoice(val)}
                      className={`rounded-md py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                        paperChoice === val
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="mb-1.5 text-xs text-slate-600">
                    Orientation
                  </div>
                  <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
                    {(
                      [
                        ['auto', 'Auto'],
                        ['portrait', 'Port.'],
                        ['landscape', 'Land.'],
                      ] as [OrientationChoice, string][]
                    ).map(([val, label]) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setOrientationChoice(val)}
                        className={`rounded-md py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                          orientationChoice === val
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 text-xs text-slate-600">
                    Output DPI
                  </div>
                  <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
                    {([150, 300] as DpiChoice[]).map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setDpi(val)}
                        className={`rounded-md py-1.5 font-mono text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                          dpi === val
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {val}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 03. Automatic Document Cleaning */}
          <section className="border-b border-slate-200 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold tracking-wide text-slate-900">
                03. Document Cleaning
              </h2>
              <button
                type="button"
                onClick={() => setShowAdvancedTuning((s) => !s)}
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                <SlidersHorizontal className="h-3 w-3" />
                Advanced
                {showAdvancedTuning ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </button>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
              {(
                [
                  ['color-clean', 'Auto Color'],
                  ['grayscale', 'Grayscale'],
                  ['bw', 'B&W Scan'],
                ] as [ScanMode, string][]
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() =>
                    setEnhancement((prev) => ({ ...prev, scanMode: mode }))
                  }
                  className={`rounded-md py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    enhancement.scanMode === mode
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {showAdvancedTuning && (
              <div className="mt-4 space-y-3 border-t border-slate-100 pt-3.5">
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setEnhancement(DEFAULT_ENHANCEMENT)}
                    className="text-xs font-medium text-blue-700 hover:text-blue-800 cursor-pointer"
                  >
                    Reset Presets
                  </button>
                </div>
                <SliderControl
                  id="shadow-removal"
                  label="Shadow & Grid Removal"
                  value={enhancement.shadowRemoval}
                  min={0}
                  max={100}
                  unit="%"
                  onChange={(v) =>
                    setEnhancement((p) => ({ ...p, shadowRemoval: v }))
                  }
                />
                <SliderControl
                  id="stamp-protection"
                  label="Stamp & Photo Protection"
                  value={enhancement.stampProtection}
                  min={0}
                  max={100}
                  unit="%"
                  onChange={(v) =>
                    setEnhancement((p) => ({ ...p, stampProtection: v }))
                  }
                />
                <SliderControl
                  id="white-point"
                  label="Paper White Cleanup"
                  value={enhancement.whitePoint}
                  min={0}
                  max={100}
                  unit="%"
                  onChange={(v) =>
                    setEnhancement((p) => ({ ...p, whitePoint: v }))
                  }
                />
                <SliderControl
                  id="contrast-ctrl"
                  label="Contrast"
                  value={enhancement.contrast}
                  min={-50}
                  max={100}
                  unit=""
                  onChange={(v) =>
                    setEnhancement((p) => ({ ...p, contrast: v }))
                  }
                />
                <SliderControl
                  id="sharpness-ctrl"
                  label="Sharpness"
                  value={enhancement.sharpness}
                  min={0}
                  max={100}
                  unit="%"
                  onChange={(v) =>
                    setEnhancement((p) => ({ ...p, sharpness: v }))
                  }
                />
              </div>
            )}
          </section>

          {/* 04. Offline OCR & Text Extraction */}
          <section className="border-b border-slate-200 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold tracking-wide text-slate-900">
                04. Offline OCR Text
              </h2>
              <button
                type="button"
                onClick={() => setOfflineModalOpen(true)}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800 cursor-pointer"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                Language Packs
              </button>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <select
                aria-label="OCR Language"
                value={selectedLang}
                onChange={(e) => setSelectedLang(e.target.value)}
                className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus-visible:outline-2 focus-visible:outline-blue-700"
              >
                {languages.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.label} —{' '}
                    {lang.bundled
                      ? 'Local Offline'
                      : lang.cached
                        ? 'Cached Offline'
                        : 'Downloadable'}
                  </option>
                ))}
              </select>

              <button
                type="button"
                disabled={!sourceCanvas || batchRunning}
                onClick={handleRunOcrManual}
                className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white whitespace-nowrap shrink-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 ${
                  ocrRunning
                    ? 'bg-slate-800 hover:bg-slate-900'
                    : 'bg-blue-700 hover:bg-blue-800'
                }`}
              >
                <ScanText className="h-3.5 w-3.5" />
                {ocrRunning ? 'Cancel' : 'Run OCR'}
              </button>
            </div>

            {ocrRunning && (
              <div className="mt-3 space-y-1.5">
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span className="truncate">{ocrProgress.status}</span>
                  <span className="font-mono">
                    {Math.round(ocrProgress.progress * 100)}%
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    style={{ width: `${Math.round(ocrProgress.progress * 100)}%` }}
                    className="h-full bg-blue-700 transition-all duration-150"
                  />
                </div>
              </div>
            )}

            {ocrError && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {ocrError}
              </div>
            )}

            {ocrResult && !ocrRunning && (
              <div className="mt-3 space-y-2.5">
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <div className="flex items-center gap-1.5 font-mono">
                    <span className="font-semibold text-slate-900">
                      {ocrResult.confidence}% conf
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{ocrResult.wordCount} words</span>
                    <span aria-hidden="true">·</span>
                    <span>{(ocrResult.durationMs / 1000).toFixed(1)}s</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowOcrBoxes((s) => !s);
                      setViewMode('output');
                    }}
                    className={`inline-flex items-center gap-1 text-xs font-medium cursor-pointer ${
                      showOcrBoxes ? 'text-blue-700' : 'text-slate-500'
                    }`}
                  >
                    <Eye className="h-3.5 w-3.5" />
                    {showOcrBoxes ? 'Boxes On' : 'Boxes Off'}
                  </button>
                </div>

                <textarea
                  aria-label="Extracted OCR Text"
                  value={editedOcrText}
                  onChange={(e) => setEditedOcrText(e.target.value)}
                  rows={7}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-800 focus:border-blue-700 focus:bg-white focus:outline-none"
                />

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyOcrText}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 cursor-pointer"
                  >
                    {copiedText ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5 text-slate-500" />
                    )}
                    {copiedText ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadOcrTxt}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 cursor-pointer"
                  >
                    <FileText className="h-3.5 w-3.5 text-slate-500" />
                    .TXT
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadOcrJson}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 cursor-pointer"
                  >
                    <FileCode2 className="h-3.5 w-3.5 text-slate-500" />
                    .JSON
                  </button>
                </div>
              </div>
            )}

            {!ocrResult && !ocrRunning && !ocrError && (
              <p className="mt-2.5 text-xs text-slate-500">
                {sourceCanvas
                  ? 'Click Run OCR to recognize text locally.'
                  : 'Open a file or folder to auto-clean and extract text.'}
              </p>
            )}
          </section>

          {/* 05. Quick Format Downloads */}
          <section className="p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold tracking-wide text-slate-900">
                05. Quick Export Copies
              </h2>
              {docSpec && (
                <span className="font-mono text-xs text-slate-500">
                  {docSpec.widthPx}×{docSpec.heightPx}
                </span>
              )}
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <button
                type="button"
                disabled={!sourceCanvas || savingBusy}
                onClick={() => handleQuickDownload('png')}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap cursor-pointer"
              >
                <Download className="h-3.5 w-3.5 text-slate-600" />
                PNG
              </button>
              <button
                type="button"
                disabled={!sourceCanvas || savingBusy}
                onClick={() => handleQuickDownload('jpeg')}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap cursor-pointer"
              >
                <Download className="h-3.5 w-3.5 text-slate-600" />
                JPEG
              </button>
              <button
                type="button"
                disabled={!sourceCanvas || savingBusy}
                onClick={() => handleQuickDownload('pdf')}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap cursor-pointer"
              >
                <Download className="h-3.5 w-3.5 text-slate-600" />
                PDF
              </button>
            </div>
          </section>
        </aside>
      </main>

      {/* Modals */}
      <CameraModal
        isOpen={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={handleCameraCapture}
      />

      <OfflineDataModal
        isOpen={offlineModalOpen}
        onClose={() => setOfflineModalOpen(false)}
        languages={languages}
        selectedLang={selectedLang}
        onSelectLang={setSelectedLang}
        onLanguagesChanged={refreshLanguages}
        isOnline={isOnline}
      />

      {/* Offline indicator */}
      {!isOnline && (
        <div className="fixed bottom-4 left-4 z-40 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-medium text-amber-900 shadow-md">
          <WifiOff className="h-3.5 w-3.5 text-amber-700" />
          <span>Offline Mode — Running locally with cached OCR assets</span>
        </div>
      )}

      {/* Action feedback toast */}
      {statusNotice && (
        <div className="fixed bottom-4 right-4 z-40 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white shadow-lg">
          {statusNotice}
        </div>
      )}
    </div>
  );
}

interface SliderControlProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (value: number) => void;
}

const SliderControl: React.FC<SliderControlProps> = ({
  id,
  label,
  value,
  min,
  max,
  unit,
  onChange,
}) => (
  <div>
    <div className="mb-1 flex items-center justify-between text-xs">
      <label htmlFor={id} className="text-slate-700">
        {label}
      </label>
      <span className="font-mono text-slate-900">
        {value > 0 && min < 0 ? `+${value}` : value}
        {unit}
      </span>
    </div>
    <input
      id={id}
      type="range"
      min={min}
      max={max}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="studio-slider w-full"
    />
  </div>
);
