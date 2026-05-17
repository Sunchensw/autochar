import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type {
  ExtensionRecorderEvent,
  ExtensionRecorderSession as ExtensionRecorderSessionType,
  RecorderSession as RecorderSessionType
} from '@autochar/recorder-core';
import { ExtensionReceiverServer, type ExtensionReceiverInfo } from './extension-receiver';

process.env.PLAYWRIGHT_BROWSERS_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'ms-playwright')
  : path.resolve(process.cwd(), 'ms-playwright');

let mainWindow: BrowserWindow | undefined;
let session: RecorderSessionType | undefined;
let extensionSession: ExtensionRecorderSessionType | undefined;
let extensionReceiver: ExtensionReceiverServer | undefined;
let extensionReceiverInfo: ExtensionReceiverInfo | undefined;
let activeMode: 'browser' | 'extension' | undefined;
let stopped = false;
let lastOperationMarkdown = '';
const remoteDebuggingPort = 9223;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 920,
    minHeight: 640,
    title: 'Autochar Recorder',
    backgroundColor: '#f7f7f7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

async function ensureSession() {
  if (!session) {
    const { RecorderSession } = await import('@autochar/recorder-core');
    const workDir = path.join(app.getPath('userData'), 'recordings', String(Date.now()));
    session = new RecorderSession({
      workDir,
      debugLogPath: path.join(workDir, 'recorder-debug.log'),
      remoteDebuggingPort
    });
  }
  return session;
}

function activeSession() {
  return activeMode === 'extension' ? extensionSession : session;
}

function recorderExtensionDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'recorder-extension')
    : path.resolve(__dirname, '..', '..', 'recorder-extension');
}

async function ensureExtensionReceiver() {
  if (!extensionReceiver) {
    extensionReceiver = new ExtensionReceiverServer({
      preferredPort: 17321,
      onEvent: async (event) => {
        if (!extensionSession) return;
        await extensionSession.receiveEvent(event as ExtensionRecorderEvent);
      }
    });
    extensionReceiverInfo = await extensionReceiver.start();
  } else if (!extensionReceiverInfo) {
    extensionReceiverInfo = extensionReceiver.info();
  }
  const info = extensionReceiverInfo ?? extensionReceiver.info();
  extensionReceiverInfo = info;
  return {
    ...info,
    extensionDir: recorderExtensionDir()
  };
}

ipcMain.handle('recorder:open', async (_event, startUrl: string) => {
  const current = await ensureSession();
  activeMode = 'browser';
  await current.open(startUrl);
  await current.startRecording();
  stopped = false;
  lastOperationMarkdown = '';
  return current.getState();
});

ipcMain.handle('recorder:start', async () => {
  const current = await ensureSession();
  activeMode = 'browser';
  await current.startRecording();
  stopped = false;
  lastOperationMarkdown = '';
  return current.getState();
});

ipcMain.handle('recorder:stop', async () => {
  const current = activeSession();
  if (!current) throw new Error('Recorder is not open.');
  const flow = await current.stopRecording();
  lastOperationMarkdown = current.previewOperationMarkdown();
  stopped = true;
  return { state: current.getState(), flow, operationMarkdown: lastOperationMarkdown };
});

ipcMain.handle('recorder:export', async (_event, payload: { name: string; notes: string }) => {
  const current = activeSession();
  if (!current || !stopped) throw new Error('Stop recording before export.');
  const selection = await dialog.showOpenDialog(mainWindow!, {
    title: '选择 AI 操作文档导出目录',
    properties: ['openDirectory', 'createDirectory']
  });
  if (selection.canceled || !selection.filePaths[0]) {
    return current.getState();
  }
  const documentPath = await current.exportRecording({
    name: payload.name || 'Autochar Recording',
    notes: payload.notes || '',
    outputDir: selection.filePaths[0]
  });
  lastOperationMarkdown = current.previewOperationMarkdown({
    name: payload.name || 'Autochar Recording',
    notes: payload.notes || ''
  });
  return { ...current.getState(), exportPath: documentPath, operationMarkdown: lastOperationMarkdown };
});

ipcMain.handle('recorder:export-materials', async (_event, payload: { name: string; notes: string }) => {
  const current = activeSession();
  if (!current || !stopped) throw new Error('Stop recording before exporting materials.');
  const selection = await dialog.showOpenDialog(mainWindow!, {
    title: '选择电商材料包导出目录',
    properties: ['openDirectory', 'createDirectory']
  });
  if (selection.canceled || !selection.filePaths[0]) {
    return current.getState();
  }
  const result = await current.exportMaterialPackage({
    name: payload.name || 'Autochar Recording',
    notes: payload.notes || '',
    outputDir: selection.filePaths[0]
  });
  return { ...current.getState(), materialPackagePath: result.outputDir };
});

ipcMain.handle('recorder:extension-info', async () => {
  const receiver = await ensureExtensionReceiver();
  return {
    ...receiver,
    state: extensionSession?.getState()
  };
});

ipcMain.handle('recorder:extension-start', async () => {
  await ensureExtensionReceiver();
  const { ExtensionRecorderSession } = await import('@autochar/recorder-core');
  const workDir = path.join(app.getPath('userData'), 'extension-recordings', String(Date.now()));
  extensionSession = new ExtensionRecorderSession({
    workDir,
    debugLogPath: path.join(workDir, 'extension-recorder-debug.log')
  });
  activeMode = 'extension';
  stopped = false;
  lastOperationMarkdown = '';
  await extensionSession.startRecording();
  return {
    ...extensionSession.getState(),
    extension: {
      ...(extensionReceiverInfo ?? {}),
      extensionDir: recorderExtensionDir()
    }
  };
});

ipcMain.handle('recorder:open-extension-folder', async () => {
  await shell.openPath(recorderExtensionDir());
});

ipcMain.handle('recorder:state', async () => activeSession()?.getState() ?? {
  isOpen: false,
  isRecording: false,
  stepCount: 0,
  screenshotCount: 0,
  notes: [],
  debugLog: [],
  materialPackagePath: undefined
});

ipcMain.handle('recorder:close-browser', async () => {
  await session?.close();
  await extensionSession?.close();
  session = undefined;
  extensionSession = undefined;
  activeMode = undefined;
  stopped = false;
  lastOperationMarkdown = '';
  return {
    isOpen: false,
    isRecording: false,
    stepCount: 0,
    screenshotCount: 0,
    notes: [],
    debugLog: [],
    materialPackagePath: undefined
  };
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  Promise.all([
    session?.close(),
    extensionSession?.close(),
    extensionReceiver?.close()
  ]).finally(() => app.quit());
});
