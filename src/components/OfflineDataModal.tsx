import React, { useRef, useState } from 'react';
import { Check, Download, FolderInput, Trash2, X } from 'lucide-react';
import { OcrLanguageInfo } from '../types/scanner';
import {
  downloadLanguageForOffline,
  importLocalTrainedDataFile,
  removeCachedLanguage,
} from '../lib/offlineOcr';

interface OfflineDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  languages: OcrLanguageInfo[];
  selectedLang: string;
  onSelectLang: (code: string) => void;
  onLanguagesChanged: () => Promise<void>;
  isOnline: boolean;
}

function formatBytes(bytes?: number): string {
  if (!bytes) return 'Cached';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

export const OfflineDataModal: React.FC<OfflineDataModalProps> = ({
  isOpen,
  onClose,
  languages,
  selectedLang,
  onSelectLang,
  onLanguagesChanged,
  isOnline,
}) => {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleDownload = async (lang: OcrLanguageInfo) => {
    setError(null);
    setBusyCode(lang.code);
    try {
      await downloadLanguageForOffline(lang.code, lang.label);
      await onLanguagesChanged();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to download language pack'
      );
    } finally {
      setBusyCode(null);
    }
  };

  const handleRemove = async (code: string) => {
    setError(null);
    setBusyCode(code);
    try {
      await removeCachedLanguage(code);
      if (selectedLang === code) {
        onSelectLang('eng');
      }
      await onLanguagesChanged();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to remove cached pack'
      );
    } finally {
      setBusyCode(null);
    }
  };

  const handleImportFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setError(null);
    setBusyCode('__import__');
    try {
      let lastCode = selectedLang;
      for (const file of Array.from(files)) {
        const info = await importLocalTrainedDataFile(file);
        lastCode = info.code;
      }
      await onLanguagesChanged();
      onSelectLang(lastCode);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not import .traineddata file'
      );
    } finally {
      setBusyCode(null);
      e.target.value = '';
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Offline OCR Language Packs"
    >
      <div className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Offline OCR Language Data
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              English is bundled locally. Cache extra languages or import .traineddata files from disk.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close language manager"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-3">
          <div className="text-xs text-slate-600">
            <span>Engine: Tesseract WASM (Local)</span>
            <span className="mx-2 text-slate-400" aria-hidden="true">
              ·
            </span>
            <span>{isOnline ? 'Network Available' : 'Offline Mode Active'}</span>
          </div>
          <div>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".traineddata,.gz"
              onChange={handleImportFiles}
              className="hidden"
            />
            <button
              type="button"
              disabled={busyCode === '__import__'}
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FolderInput className="h-3.5 w-3.5 text-blue-700" />
              Import .traineddata
            </button>
          </div>
        </div>

        {error && (
          <div className="border-b border-red-200 bg-red-50 px-6 py-2.5 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 px-6">
          {languages.map((lang) => {
            const isBusy = busyCode === lang.code;
            const isActive = selectedLang === lang.code;
            return (
              <div
                key={lang.code}
                className="flex items-center justify-between gap-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-900">
                      {lang.label}
                    </span>
                    <span className="font-mono text-xs text-slate-500">
                      {lang.code}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500">
                    {lang.bundled
                      ? 'Found in local tessdata/ · Always offline'
                      : lang.cached
                        ? `Stored locally in IndexedDB · ${formatBytes(lang.sizeBytes)}`
                        : 'Not cached locally'}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {lang.cached ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          onSelectLang(lang.code);
                          onClose();
                        }}
                        className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap cursor-pointer ${
                          isActive
                            ? 'bg-blue-700 text-white'
                            : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {isActive && <Check className="h-3.5 w-3.5" />}
                        {isActive ? 'Selected' : 'Use'}
                      </button>
                      {!lang.bundled && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleRemove(lang.code)}
                          aria-label={`Remove ${lang.label} offline cache`}
                          className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-700 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={isBusy || !isOnline}
                      onClick={() => handleDownload(lang)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap cursor-pointer"
                    >
                      <Download className="h-3.5 w-3.5 text-blue-700" />
                      {isBusy ? 'Caching...' : 'Cache Offline'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-end border-t border-slate-200 px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
