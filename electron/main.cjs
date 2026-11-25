const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('fs/promises');
const path = require('path');

const SUPPORTED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp']);

function isSupportedImage(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (!SUPPORTED_EXTS.has(ext)) return false;
  const stem = path.basename(filename, ext).toLowerCase();
  return !stem.endsWith('_clean');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 680,
    title: 'FolioScan — Document Scanner & OCR Studio',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '../public/pwa-512x512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

ipcMain.handle('folio:pick-file', async () => {
  const res = await dialog.showOpenDialog({
    title: 'Open Document Image',
    properties: ['openFile'],
    filters: [
      {
        name: 'Document Images',
        extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'],
      },
    ],
  });
  if (res.canceled || res.filePaths.length === 0) return null;

  const filePath = res.filePaths[0];
  const data = await fs.readFile(filePath);
  return {
    filePath,
    dirPath: path.dirname(filePath),
    dirName: path.basename(path.dirname(filePath)) || path.dirname(filePath),
    name: path.basename(filePath),
    bytes: new Uint8Array(data),
  };
});

ipcMain.handle('folio:pick-directory', async () => {
  const res = await dialog.showOpenDialog({
    title: 'Select Folder to Auto-Process',
    properties: ['openDirectory'],
  });
  if (res.canceled || res.filePaths.length === 0) return null;

  const dirPath = res.filePaths[0];
  const dirEntries = await fs.readdir(dirPath, { withFileTypes: true });
  const entries = [];

  for (const ent of dirEntries) {
    if (ent.isFile() && isSupportedImage(ent.name)) {
      const fullPath = path.join(dirPath, ent.name);
      const data = await fs.readFile(fullPath);
      entries.push({
        filePath: fullPath,
        name: ent.name,
        bytes: new Uint8Array(data),
      });
    }
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  return {
    dirPath,
    dirName: path.basename(dirPath) || dirPath,
    entries,
  };
});

ipcMain.handle('folio:write-file', async (_event, { filePath, bytes }) => {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Invalid target file path');
  }
  await fs.writeFile(filePath, Buffer.from(bytes));
  return true;
});

ipcMain.handle(
  'folio:write-in-dir',
  async (_event, { dirPath, filename, bytes }) => {
    if (!dirPath || !filename) {
      throw new Error('Invalid directory or filename');
    }
    const safeName = path.basename(filename);
    const targetPath = path.join(dirPath, safeName);
    await fs.writeFile(targetPath, Buffer.from(bytes));
    return targetPath;
  }
);

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
