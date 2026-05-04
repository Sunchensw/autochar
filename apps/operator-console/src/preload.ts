import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('autocharOwner', {
  importFlow: () => ipcRenderer.invoke('owner:import-flow'),
  validateFlow: () => ipcRenderer.invoke('owner:validate-flow'),
  generateScript: () => ipcRenderer.invoke('owner:generate-script'),
  selectInput: () => ipcRenderer.invoke('owner:select-input'),
  runDryRun: (options: { maxRows: number; startRow: number; failFast: boolean }) =>
    ipcRenderer.invoke('owner:run-dry-run', options),
  runBatch: (options: { maxRows: number; startRow: number; failFast: boolean; confirmed: boolean }) =>
    ipcRenderer.invoke('owner:run-batch', options),
  openResult: () => ipcRenderer.invoke('owner:open-result'),
  openScreenshot: (screenshotPath: string) => ipcRenderer.invoke('owner:open-screenshot', screenshotPath)
});
