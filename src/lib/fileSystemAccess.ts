// TypeScript definitions and wrappers for the File System Access API
// with graceful fallback for restricted iframes and unsupported browsers.

export interface FsPermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

export interface FsWritableFileStream extends WritableStream {
  write(data: BufferSource | Blob | string): Promise<void>;
  close(): Promise<void>;
}

export interface FsFileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable(options?: { keepExistingData?: boolean }): Promise<FsWritableFileStream>;
  queryPermission?(descriptor?: FsPermissionDescriptor): Promise<PermissionState>;
  requestPermission?(descriptor?: FsPermissionDescriptor): Promise<PermissionState>;
}

export interface FsDirectoryHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterableIterator<FsFileHandle | FsDirectoryHandle>;
  getFileHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<FsFileHandle>;
  queryPermission?(descriptor?: FsPermissionDescriptor): Promise<PermissionState>;
  requestPermission?(descriptor?: FsPermissionDescriptor): Promise<PermissionState>;
}

interface FolioDesktopBridge {
  isDesktop: boolean;
  pickFile: () => Promise<{
    filePath: string;
    dirPath: string;
    dirName: string;
    name: string;
    bytes: Uint8Array;
  } | null>;
  pickDirectory: () => Promise<{
    dirPath: string;
    dirName: string;
    entries: Array<{ filePath: string; name: string; bytes: Uint8Array }>;
  } | null>;
  writeFile: (filePath: string, bytes: Uint8Array) => Promise<boolean>;
  writeInDirectory: (
    dirPath: string,
    filename: string,
    bytes: Uint8Array
  ) => Promise<string>;
}

interface WindowWithFs extends Window {
  folioDesktop?: FolioDesktopBridge;
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    excludeAcceptAllOption?: boolean;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<FsFileHandle[]>;
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: 'read' | 'readwrite';
  }) => Promise<FsDirectoryHandle>;
}

function getDesktopBridge(): FolioDesktopBridge | undefined {
  return (window as unknown as WindowWithFs).folioDesktop;
}

function makeElectronFileHandle(
  filePath: string,
  name: string,
  fileObj: File,
  bridge: FolioDesktopBridge
): FsFileHandle {
  return {
    kind: 'file',
    name,
    getFile: async () => fileObj,
    createWritable: async () => {
      const chunks: Uint8Array[] = [];
      return {
        write: async (data: BufferSource | Blob | string) => {
          if (data instanceof Blob) {
            chunks.push(new Uint8Array(await data.arrayBuffer()));
          } else if (typeof data === 'string') {
            chunks.push(new TextEncoder().encode(data));
          } else if (ArrayBuffer.isView(data)) {
            chunks.push(
              new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
            );
          } else {
            chunks.push(new Uint8Array(data));
          }
        },
        close: async () => {
          const total = chunks.reduce((s, c) => s + c.length, 0);
          const merged = new Uint8Array(total);
          let off = 0;
          for (const c of chunks) {
            merged.set(c, off);
            off += c.length;
          }
          await bridge.writeFile(filePath, merged);
        },
      } as unknown as FsWritableFileStream;
    },
  };
}

function makeElectronDirHandle(
  dirPath: string,
  dirName: string,
  bridge: FolioDesktopBridge
): FsDirectoryHandle {
  return {
    kind: 'directory',
    name: dirName,
    values: async function* () {
      // Directory entries are loaded upfront during pickDirectory
    },
    getFileHandle: async (filename: string) => {
      return {
        kind: 'file',
        name: filename,
        getFile: async () => new File([], filename),
        createWritable: async () => {
          const chunks: Uint8Array[] = [];
          return {
            write: async (data: BufferSource | Blob | string) => {
              if (data instanceof Blob) {
                chunks.push(new Uint8Array(await data.arrayBuffer()));
              } else if (typeof data === 'string') {
                chunks.push(new TextEncoder().encode(data));
              } else if (ArrayBuffer.isView(data)) {
                chunks.push(
                  new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
                );
              } else {
                chunks.push(new Uint8Array(data));
              }
            },
            close: async () => {
              const total = chunks.reduce((s, c) => s + c.length, 0);
              const merged = new Uint8Array(total);
              let off = 0;
              for (const c of chunks) {
                merged.set(c, off);
                off += c.length;
              }
              await bridge.writeInDirectory(dirPath, filename, merged);
            },
          } as unknown as FsWritableFileStream;
        },
      };
    },
  };
}

export const SUPPORTED_IMAGE_EXTS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'bmp',
]);

export function isSupportedImageFilename(name: string): boolean {
  const lower = name.toLowerCase();
  const ext = lower.split('.').pop() || '';
  if (!SUPPORTED_IMAGE_EXTS.has(ext)) return false;
  // Skip already-cleaned files when scanning a folder
  const stem = lower.replace(/\.[^.]+$/, '');
  if (stem.endsWith('_clean')) return false;
  return true;
}

export function isFileSystemAccessAvailable(): boolean {
  const w = window as unknown as WindowWithFs;
  if (w.folioDesktop?.isDesktop) return true;
  return (
    typeof w.showOpenFilePicker === 'function' &&
    typeof w.showDirectoryPicker === 'function'
  );
}

export async function ensureReadWritePermission(
  handle: FsFileHandle | FsDirectoryHandle
): Promise<boolean> {
  if (getDesktopBridge()?.isDesktop) return true;
  if (!handle.queryPermission || !handle.requestPermission) return true;
  const opts: FsPermissionDescriptor = { mode: 'readwrite' };
  const current = await handle.queryPermission(opts);
  if (current === 'granted') return true;
  const requested = await handle.requestPermission(opts);
  return requested === 'granted';
}

export async function pickSingleFileWithFsApi(): Promise<{
  file: File;
  handle: FsFileHandle;
  dirHandle?: FsDirectoryHandle;
} | null> {
  const bridge = getDesktopBridge();
  if (bridge?.isDesktop) {
    const res = await bridge.pickFile();
    if (!res) return null;
    const copy = new Uint8Array(res.bytes.byteLength);
    copy.set(res.bytes);
    const ext = res.name.split('.').pop()?.toLowerCase() || 'png';
    const file = new File([copy.buffer], res.name, {
      type: mimeTypeForExt(ext).mime,
    });
    return {
      file,
      handle: makeElectronFileHandle(res.filePath, res.name, file, bridge),
      dirHandle: makeElectronDirHandle(res.dirPath, res.dirName, bridge),
    };
  }

  const w = window as unknown as WindowWithFs;
  if (typeof w.showOpenFilePicker !== 'function') {
    throw new Error('FS_UNSUPPORTED');
  }
  const [handle] = await w.showOpenFilePicker({
    multiple: false,
    types: [
      {
        description: 'Document Images',
        accept: {
          'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.bmp'],
        },
      },
    ],
  });
  if (!handle) return null;
  const file = await handle.getFile();
  return { file, handle };
}

export interface DirectoryImageEntry {
  file: File;
  fileHandle: FsFileHandle;
}

export async function pickDirectoryWithFsApi(): Promise<{
  dirHandle: FsDirectoryHandle;
  entries: DirectoryImageEntry[];
} | null> {
  const bridge = getDesktopBridge();
  if (bridge?.isDesktop) {
    const res = await bridge.pickDirectory();
    if (!res) return null;
    const dirHandle = makeElectronDirHandle(res.dirPath, res.dirName, bridge);
    const entries: DirectoryImageEntry[] = res.entries.map((e) => {
      const copy = new Uint8Array(e.bytes.byteLength);
      copy.set(e.bytes);
      const ext = e.name.split('.').pop()?.toLowerCase() || 'png';
      const file = new File([copy.buffer], e.name, {
        type: mimeTypeForExt(ext).mime,
      });
      return {
        file,
        fileHandle: makeElectronFileHandle(e.filePath, e.name, file, bridge),
      };
    });
    return { dirHandle, entries };
  }

  const w = window as unknown as WindowWithFs;
  if (typeof w.showDirectoryPicker !== 'function') {
    throw new Error('FS_UNSUPPORTED');
  }

  const dirHandle = await w.showDirectoryPicker({ mode: 'readwrite' });
  const granted = await ensureReadWritePermission(dirHandle);
  if (!granted) {
    throw new Error('Read/write folder permission was not granted.');
  }

  const entries: DirectoryImageEntry[] = [];
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file' && isSupportedImageFilename(entry.name)) {
      const file = await entry.getFile();
      entries.push({ file, fileHandle: entry });
    }
  }

  entries.sort((a, b) => a.file.name.localeCompare(b.file.name));
  return { dirHandle, entries };
}

export async function writeBlobToFileHandle(
  handle: FsFileHandle,
  blob: Blob
): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
}

export async function writeBlobIntoDirectory(
  dirHandle: FsDirectoryHandle,
  filename: string,
  blob: Blob
): Promise<void> {
  const targetHandle = await dirHandle.getFileHandle(filename, { create: true });
  await writeBlobToFileHandle(targetHandle, blob);
}

export function splitFilename(filename: string): {
  stem: string;
  ext: string;
} {
  const idx = filename.lastIndexOf('.');
  if (idx <= 0) return { stem: filename, ext: 'png' };
  return {
    stem: filename.slice(0, idx),
    ext: filename.slice(idx + 1).toLowerCase(),
  };
}

export function mimeTypeForExt(ext: string): {
  mime: string;
  normalizedExt: string;
} {
  switch (ext.toLowerCase()) {
    case 'jpg':
    case 'jpeg':
      return { mime: 'image/jpeg', normalizedExt: ext.toLowerCase() };
    case 'webp':
      return { mime: 'image/webp', normalizedExt: 'webp' };
    default:
      // BMP/PNG encode cleanly to lossless PNG
      return { mime: 'image/png', normalizedExt: 'png' };
  }
}

export function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}
