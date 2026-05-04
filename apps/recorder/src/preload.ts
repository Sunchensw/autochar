import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('autocharRecorder', {
  open: (url: string) => ipcRenderer.invoke('recorder:open', url),
  start: () => ipcRenderer.invoke('recorder:start'),
  stop: () => ipcRenderer.invoke('recorder:stop'),
  export: (payload: { name: string; notes: string }) => ipcRenderer.invoke('recorder:export', payload),
  state: () => ipcRenderer.invoke('recorder:state'),
  closeBrowser: () => ipcRenderer.invoke('recorder:close-browser')
});
