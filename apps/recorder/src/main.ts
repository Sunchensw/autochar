import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import type { RecorderSession as RecorderSessionType } from '@autochar/recorder-core';

process.env.PLAYWRIGHT_BROWSERS_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'ms-playwright')
  : path.resolve(process.cwd(), 'ms-playwright');

let mainWindow: BrowserWindow | undefined;
let session: RecorderSessionType | undefined;
let stopped = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 860,
    minHeight: 640,
    title: 'Autochar Recorder',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'ui', 'index.html'));
}

async function ensureSession() {
  if (!session) {
    const { RecorderSession } = await import('@autochar/recorder-core');
    session = new RecorderSession({
      workDir: path.join(app.getPath('userData'), 'recordings', String(Date.now()))
    });
  }
  return session;
}

ipcMain.handle('recorder:open', async (_event, startUrl: string) => {
  const current = await ensureSession();
  await current.open(startUrl);
  stopped = false;
  return current.getState();
});

ipcMain.handle('recorder:start', async () => {
  const current = await ensureSession();
  await current.startRecording();
  stopped = false;
  return current.getState();
});

ipcMain.handle('recorder:stop', async () => {
  if (!session) throw new Error('Recorder is not open.');
  const flow = await session.stopRecording();
  stopped = true;
  return { state: session.getState(), flow };
});

ipcMain.handle('recorder:export', async (_event, payload: { name: string; notes: string }) => {
  if (!session || !stopped) throw new Error('Stop recording before export.');
  const selection = await dialog.showOpenDialog(mainWindow!, {
    title: '选择 flow package 导出目录',
    properties: ['openDirectory', 'createDirectory']
  });
  if (selection.canceled || !selection.filePaths[0]) {
    return session.getState();
  }
  const zipPath = await session.exportRecording({
    name: payload.name || 'Autochar Recording',
    notes: payload.notes || '',
    outputDir: selection.filePaths[0]
  });
  return { ...session.getState(), exportPath: zipPath };
});

ipcMain.handle('recorder:state', async () => session?.getState() ?? {
  isOpen: false,
  isRecording: false,
  stepCount: 0,
  screenshotCount: 0,
  notes: []
});

ipcMain.handle('recorder:close-browser', async () => {
  await session?.close();
  session = undefined;
  stopped = false;
  return {
    isOpen: false,
    isRecording: false,
    stepCount: 0,
    screenshotCount: 0,
    notes: []
  };
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  session?.close().finally(() => app.quit());
});
