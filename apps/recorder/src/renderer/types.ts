export interface RecordingState {
  isOpen: boolean;
  isRecording: boolean;
  stepCount: number;
  screenshotCount: number;
  lastAction?: string;
  notes: string[];
  debugLog: string[];
  debugLogPath?: string;
  remoteDebuggingPort?: number;
  exportPath?: string;
  materialPackagePath?: string;
  operationMarkdown?: string;
  extension?: ExtensionInfo;
}

export interface ExtensionInfo {
  port?: number;
  receiverUrl?: string;
  token?: string;
  extensionDir?: string;
  state?: RecordingState;
}

export interface StopResult {
  state: RecordingState;
  flow: unknown;
  operationMarkdown: string;
}

export interface AutocharRecorderApi {
  open: (url: string) => Promise<RecordingState>;
  start: () => Promise<RecordingState>;
  extensionInfo: () => Promise<ExtensionInfo>;
  startExtension: () => Promise<RecordingState>;
  stop: () => Promise<StopResult>;
  export: (payload: { name: string; notes: string }) => Promise<RecordingState>;
  exportMaterials: (payload: { name: string; notes: string }) => Promise<RecordingState>;
  state: () => Promise<RecordingState>;
  openExtensionFolder: () => Promise<void>;
  closeBrowser: () => Promise<RecordingState>;
}

declare global {
  interface Window {
    autocharRecorder: AutocharRecorderApi;
  }
}
