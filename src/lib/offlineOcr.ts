import { createWorker, OEM, PSM } from 'tesseract.js';
import { OcrLanguageInfo, OcrResult, OcrWordBox } from '../types/scanner';

// Metadata DB for installed/imported language packs
const META_DB_NAME = 'folioscan-ocr-meta';
const META_STORE = 'languages';

// Tesseract.js internal idb-keyval cache DB (`keyval-store` / `keyval`)
const TESS_CACHE_DB = 'keyval-store';
const TESS_CACHE_STORE = 'keyval';

const REMOTE_TESSDATA_BASE = 'https://tessdata.projectnaptha.com/4.0.0';

export const BUILTIN_LANGUAGES: Omit<OcrLanguageInfo, 'cached'>[] = [
  { code: 'eng', label: 'English', nativeLabel: 'English (Bundled)', bundled: true },
  { code: 'amh', label: 'Amharic', nativeLabel: 'አማርኛ', bundled: false },
  { code: 'deu', label: 'German', nativeLabel: 'Deutsch', bundled: false },
  { code: 'fra', label: 'French', nativeLabel: 'Français', bundled: false },
  { code: 'spa', label: 'Spanish', nativeLabel: 'Español', bundled: false },
  { code: 'ita', label: 'Italian', nativeLabel: 'Italiano', bundled: false },
  { code: 'por', label: 'Portuguese', nativeLabel: 'Português', bundled: false },
  { code: 'rus', label: 'Russian', nativeLabel: 'Русский', bundled: false },
  { code: 'ukr', label: 'Ukrainian', nativeLabel: 'Українська', bundled: false },
  { code: 'jpn', label: 'Japanese', nativeLabel: '日本語', bundled: false },
  { code: 'chi_sim', label: 'Chinese (Simplified)', nativeLabel: '简体中文', bundled: false },
];

interface LangMetaRecord {
  code: string;
  label: string;
  sizeBytes: number;
  updatedAt: number;
}

function openStore(
  dbName: string,
  storeName: string,
  keyPath?: string
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, keyPath ? { keyPath } : undefined);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putTesseractCache(code: string, data: Uint8Array): Promise<void> {
  const db = await openStore(TESS_CACHE_DB, TESS_CACHE_STORE);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TESS_CACHE_STORE, 'readwrite');
    tx.objectStore(TESS_CACHE_STORE).put(data, `./${code}.traineddata`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function hasTesseractCache(code: string): Promise<boolean> {
  const db = await openStore(TESS_CACHE_DB, TESS_CACHE_STORE);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TESS_CACHE_STORE, 'readonly');
    const req = tx.objectStore(TESS_CACHE_STORE).getKey(`./${code}.traineddata`);
    req.onsuccess = () => resolve(req.result !== undefined);
    req.onerror = () => reject(req.error);
  });
}

async function deleteTesseractCache(code: string): Promise<void> {
  const db = await openStore(TESS_CACHE_DB, TESS_CACHE_STORE);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TESS_CACHE_STORE, 'readwrite');
    tx.objectStore(TESS_CACHE_STORE).delete(`./${code}.traineddata`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function putLangMeta(rec: LangMetaRecord): Promise<void> {
  const db = await openStore(META_DB_NAME, META_STORE, 'code');
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readwrite');
    tx.objectStore(META_STORE).put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteLangMeta(code: string): Promise<void> {
  const db = await openStore(META_DB_NAME, META_STORE, 'code');
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readwrite');
    tx.objectStore(META_STORE).delete(code);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function removeCachedLanguage(code: string): Promise<void> {
  await Promise.all([deleteLangMeta(code), deleteTesseractCache(code)]);
}

function resolveAppAssetUrl(relPath: string): string {
  return new URL(relPath.replace(/^\//, ''), window.location.href).href;
}

/**
 * Checks whether a local tessdata/<code>.traineddata(.gz) asset exists
 * without falling for Vite's SPA HTML fallback.
 */
async function probeLocalTessdata(
  code: string
): Promise<{ url: string; gzip: boolean } | null> {
  const candidates = [
    { url: resolveAppAssetUrl(`tessdata/${code}.traineddata.gz`), gzip: true },
    { url: resolveAppAssetUrl(`tessdata/${code}.traineddata`), gzip: false },
  ];
  for (const c of candidates) {
    try {
      const resp = await fetch(c.url, { method: 'HEAD' });
      const ct = (resp.headers.get('content-type') || '').toLowerCase();
      if (resp.ok && !ct.includes('text/html')) {
        return c;
      }
    } catch {
      // Ignore probe miss
    }
  }
  return null;
}

export async function listAvailableLanguages(): Promise<OcrLanguageInfo[]> {
  const db = await openStore(META_DB_NAME, META_STORE, 'code');
  const stored: LangMetaRecord[] = await new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readonly');
    const req = tx.objectStore(META_STORE).getAll();
    req.onsuccess = () => resolve((req.result as LangMetaRecord[]) || []);
    req.onerror = () => reject(req.error);
  });

  const storedMap = new Map(stored.map((r) => [r.code, r]));
  const result: OcrLanguageInfo[] = await Promise.all(
    BUILTIN_LANGUAGES.map(async (lang) => {
      const hit = storedMap.get(lang.code);
      const localPack = lang.bundled ? true : Boolean(await probeLocalTessdata(lang.code));
      return {
        ...lang,
        bundled: localPack,
        cached: localPack || Boolean(hit),
        sizeBytes: hit?.sizeBytes,
      };
    })
  );

  for (const rec of stored) {
    if (!BUILTIN_LANGUAGES.some((b) => b.code === rec.code)) {
      result.push({
        code: rec.code,
        label: rec.label,
        nativeLabel: 'Imported File',
        bundled: false,
        cached: true,
        sizeBytes: rec.sizeBytes,
      });
    }
  }

  return result;
}

async function maybeUngzip(bytes: Uint8Array): Promise<Uint8Array> {
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!isGzip) return bytes;

  if (typeof DecompressionStream !== 'undefined') {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([copy.buffer]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }
  return bytes;
}

/**
 * Imports a user-supplied .traineddata or .traineddata.gz file into local IndexedDB
 * so Tesseract can use it 100% offline.
 */
export async function importLocalTrainedDataFile(
  file: File
): Promise<OcrLanguageInfo> {
  const rawName = file.name.replace(/\.traineddata(\.gz)?$/i, '').trim();
  const code = rawName.replace(/[^a-zA-Z0-9_-]/g, '_') || 'custom';
  const rawBytes = new Uint8Array(await file.arrayBuffer());
  const data = await maybeUngzip(rawBytes);

  await putTesseractCache(code, data);
  const label = `${code.toUpperCase()} (Local File)`;
  await putLangMeta({
    code,
    label,
    sizeBytes: data.byteLength,
    updatedAt: Date.now(),
  });

  return {
    code,
    label,
    nativeLabel: 'Local File',
    bundled: false,
    cached: true,
    sizeBytes: data.byteLength,
  };
}

/**
 * Downloads a language pack while online and caches its uncompressed .traineddata
 * into IndexedDB for offline OCR.
 */
export async function downloadLanguageForOffline(
  code: string,
  label: string
): Promise<number> {
  const url = `${REMOTE_TESSDATA_BASE}/${encodeURIComponent(code)}.traineddata.gz`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to download ${code}.traineddata.gz (HTTP ${resp.status})`);
  }
  const gzBytes = new Uint8Array(await resp.arrayBuffer());
  const data = await maybeUngzip(gzBytes);
  await putTesseractCache(code, data);
  await putLangMeta({
    code,
    label,
    sizeBytes: data.byteLength,
    updatedAt: Date.now(),
  });
  return data.byteLength;
}

export interface OcrProgressUpdate {
  status: string;
  progress: number;
}

/**
 * Runs 100% client-side OCR using local /tesseract/ worker + WASM core and
 * local /tessdata/ or IndexedDB-cached .traineddata payloads.
 */
export async function runLocalOcr(
  canvas: HTMLCanvasElement,
  langCode: string,
  onProgress?: (update: OcrProgressUpdate) => void,
  signal?: AbortSignal
): Promise<OcrResult> {
  const t0 = performance.now();

  onProgress?.({ status: `Preparing ${langCode} language data`, progress: 0.08 });

  let useLocalGzip = true;
  let langPath = resolveAppAssetUrl('tessdata').replace(/\/$/, '');

  // 1. Check IndexedDB first
  const isCached = await hasTesseractCache(langCode);
  if (!isCached) {
    // 2. Probe local tessdata/ folder (supports bundled eng + user-placed amh.traineddata, etc.)
    const localPack = await probeLocalTessdata(langCode);
    if (localPack) {
      useLocalGzip = localPack.gzip;
      langPath = resolveAppAssetUrl('tessdata').replace(/\/$/, '');
    } else if (langCode !== 'eng') {
      // 3. Download once if online and cache in IndexedDB
      if (!navigator.onLine) {
        throw new Error(
          `Language "${langCode}" is not in tessdata/ or IndexedDB cache. Place ${langCode}.traineddata in public/tessdata/ or import it from disk.`
        );
      }
      const meta = BUILTIN_LANGUAGES.find((l) => l.code === langCode);
      onProgress?.({
        status: `Downloading & caching ${langCode} for offline use`,
        progress: 0.14,
      });
      await downloadLanguageForOffline(langCode, meta?.label || langCode.toUpperCase());
      langPath = REMOTE_TESSDATA_BASE;
    }
  }

  if (signal?.aborted) throw new Error('OCR cancelled');

  onProgress?.({ status: 'Starting local OCR engine', progress: 0.24 });

  const worker = await createWorker(langCode, OEM.LSTM_ONLY, {
    workerPath: resolveAppAssetUrl('tesseract/worker.min.js'),
    corePath: resolveAppAssetUrl('tesseract').replace(/\/$/, ''),
    langPath,
    workerBlobURL: false,
    cacheMethod: 'write',
    gzip: useLocalGzip,
    logger: (msg) => {
      if (msg.status === 'recognizing text') {
        onProgress?.({
          status: 'Recognizing text locally',
          progress: 0.35 + msg.progress * 0.65,
        });
      } else if (msg.status) {
        onProgress?.({
          status: msg.status,
          progress: Math.min(0.35, 0.24 + (msg.progress || 0) * 0.11),
        });
      }
    },
  });

  if (signal?.aborted) {
    await worker.terminate();
    throw new Error('OCR cancelled');
  }

  try {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: '1',
    });

    const result = await worker.recognize(
      canvas,
      {},
      { text: true, blocks: true }
    );

    if (signal?.aborted) {
      throw new Error('OCR cancelled');
    }

    const words: OcrWordBox[] = [];
    let lineCount = 0;

    if (result.data.blocks) {
      for (const block of result.data.blocks) {
        for (const para of block.paragraphs) {
          for (const line of para.lines) {
            lineCount++;
            for (const word of line.words) {
              if (word.text.trim()) {
                words.push({
                  text: word.text,
                  confidence: word.confidence,
                  bbox: { ...word.bbox },
                });
              }
            }
          }
        }
      }
    }

    const text = (result.data.text || '').trim();
    const durationMs = Math.round(performance.now() - t0);

    return {
      text,
      confidence: Math.round(result.data.confidence || 0),
      wordCount: words.length,
      lineCount,
      lang: langCode,
      durationMs,
      imageWidth: canvas.width,
      imageHeight: canvas.height,
      words,
    };
  } finally {
    await worker.terminate();
  }
}
