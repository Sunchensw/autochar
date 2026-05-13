import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('autocharRecorder', {
  open: (url: string) => ipcRenderer.invoke('recorder:open', url),
  start: () => ipcRenderer.invoke('recorder:start'),
  extensionInfo: () => ipcRenderer.invoke('recorder:extension-info'),
  startExtension: () => ipcRenderer.invoke('recorder:extension-start'),
  stop: () => ipcRenderer.invoke('recorder:stop'),
  export: (payload: { name: string; notes: string }) => ipcRenderer.invoke('recorder:export', payload),
  state: () => ipcRenderer.invoke('recorder:state'),
  openExtensionFolder: () => ipcRenderer.invoke('recorder:open-extension-folder'),
  closeBrowser: () => ipcRenderer.invoke('recorder:close-browser')
});
