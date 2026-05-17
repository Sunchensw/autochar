import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  detectHighRiskAction,
  isSensitiveField,
  type FlowMetadata,
  type FlowPackage,
  type FlowStep,
  type PageContextSnapshot,
  type SelectorSet
} from '@autochar/shared';
import { normalizeCapturedAction, type CapturedAction } from './action-capture';
import { isAllowedRecordingUrl } from './page-context';
import { buildOperationMarkdown, writeOperationMarkdown } from './operation-markdown';
import { writeMaterialPackage, type WriteMaterialPackageResult } from './material-package';
import type { ExportRecordingOptions, RecordingState } from './recorder-session';

export interface ExtensionRecorderSessionOptions {
  workDir?: string;
  debugLogPath?: string;
}

export interface ExtensionRecorderEvent {
  type: string;
  label?: string;
  value?: string;
  element?: Record<string, string | undefined>;
  url?: string;
  title?: string;
  timestamp?: string;
  screenshotDataUrl?: string;
  framePath?: string[];
  viewport?: { width: number; height: number };
  pageContext?: PageContextSnapshot;
}

const placeholderPngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

function stepId(order: number) {
  return `step-${String(order).padStart(3, '0')}`;
}

function cssEscapeValue(value: string): string {
  return value.replace(/["\\]/g, '\\$&').replace(/\n/g, '\\a ');
}

function selectorFromElement(element: Record<string, string | undefined>): SelectorSet {
  const fallbacks = [];
  const css = element.id
    ? `${(element.tagName || 'element').toLowerCase()}#${cssEscapeValue(element.id)}`
    : element.name
      ? `${(element.tagName || 'element').toLowerCase()}[name="${cssEscapeValue(element.name)}"]`
      : (element.testId ? `[data-testid="${cssEscapeValue(element.testId)}"]` : `${(element.tagName || 'element').toLowerCase()}`);
  const accessibleName = element.label || element.text || element.placeholder || element.name || element.id;
  if (element.placeholder) fallbacks.push({ kind: 'placeholder' as const, value: element.placeholder });
  if (element.role && accessibleName) {
    fallbacks.push({ kind: 'role' as const, value: element.role, role: element.role, name: accessibleName });
  }
  if (element.label) fallbacks.push({ kind: 'label' as const, value: element.label });
  if (element.name) fallbacks.push({ kind: 'name' as const, value: element.name });
  if (element.id) fallbacks.push({ kind: 'id' as const, value: element.id });
  fallbacks.push({ kind: 'css' as const, value: css });
  const primary = element.testId
    ? { kind: 'testId' as const, value: element.testId }
    : element.role && accessibleName
      ? { kind: 'role' as const, value: element.role, role: element.role, name: accessibleName }
      : element.label
        ? { kind: 'label' as const, value: element.label }
        : element.placeholder
          ? { kind: 'placeholder' as const, value: element.placeholder }
          : element.text
            ? { kind: 'text' as const, value: element.text }
            : fallbacks[0];
  return {
    primary,
    fallbacks: fallbacks.filter((item) => item.kind !== primary.kind || item.value !== primary.value)
  };
}

function screenshotBuffer(dataUrl?: string): Buffer {
  const match = dataUrl?.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  return Buffer.from(match?.[1] ?? placeholderPngBase64, 'base64');
}

export class ExtensionRecorderSession {
  private startUrl = 'about:blank';
  private flowName = 'Untitled flow';
  private steps: FlowStep[] = [];
  private readonly workDir: string;
  private readonly screenshotsDir: string;
  private lastNavigationKey = '';
  private metadataViewport = { width: 1365, height: 768 };
  private stateValue: RecordingState = {
    isOpen: false,
    isRecording: false,
    stepCount: 0,
    screenshotCount: 0,
    notes: [],
    debugLog: [],
    debugLogPath: undefined
  };

  constructor(private readonly options: ExtensionRecorderSessionOptions = {}) {
    this.workDir = options.workDir ?? path.join(os.tmpdir(), `autochar-extension-recording-${Date.now()}`);
    this.screenshotsDir = path.join(this.workDir, 'screenshots');
    this.stateValue.debugLogPath = options.debugLogPath;
  }

  getState(): RecordingState {
    return {
      ...this.stateValue,
      notes: [...this.stateValue.notes],
      debugLog: [...this.stateValue.debugLog]
    };
  }

  async startRecording(): Promise<void> {
    await fs.mkdir(this.screenshotsDir, { recursive: true });
    this.startUrl = 'about:blank';
    this.steps = [];
    this.lastNavigationKey = '';
    this.metadataViewport = { width: 1365, height: 768 };
    this.stateValue = {
      ...this.stateValue,
      isOpen: true,
      isRecording: true,
      stepCount: 0,
      screenshotCount: 0,
      lastAction: undefined,
      notes: [],
      exportPath: undefined,
      materialPackagePath: undefined
    };
    this.appendDebug('extension recording started');
  }

  async receiveEvent(raw: ExtensionRecorderEvent): Promise<void> {
    if (!this.stateValue.isRecording) {
      this.appendDebug(`ignored extension ${raw.type}: recorder is not running`);
      return;
    }
    if (raw.viewport && raw.viewport.width > 0 && raw.viewport.height > 0) {
      this.metadataViewport = raw.viewport;
    }
    if (!raw.url || !raw.title) {
      this.appendDebug(`ignored extension ${raw.type}: missing page metadata`);
      return;
    }
    if (!isAllowedRecordingUrl(raw.url)) {
      this.appendDebug(`ignored extension ${raw.type}: URL outside safety boundary ${raw.url}`);
      return;
    }
    if (raw.type === 'debug') {
      this.appendDebug(`extension debug: ${raw.label || '-'}`);
      return;
    }
    if (raw.type === 'navigation') {
      await this.recordNavigation(raw);
      return;
    }

    const action = normalizeCapturedAction(raw);
    if (!action) {
      this.appendDebug(`ignored extension ${raw.type}: unsupported event`);
      return;
    }
    await this.ensureStartStep(raw);
    await this.recordAction(action, raw);
  }

  async stopRecording(): Promise<FlowPackage> {
    this.stateValue.isRecording = false;
    return this.buildFlow();
  }

  async exportRecording(options: ExportRecordingOptions): Promise<string> {
    this.flowName = options.name;
    const flow = this.buildFlow();
    const documentPath = await writeOperationMarkdown({
      flow,
      metadata: this.buildMetadata(),
      notes: this.exportNotes(options.notes),
      outputDir: options.outputDir,
      documentName: options.name
    });
    this.stateValue.exportPath = documentPath;
    return documentPath;
  }

  async exportMaterialPackage(options: ExportRecordingOptions): Promise<WriteMaterialPackageResult> {
    this.flowName = options.name;
    const result = await writeMaterialPackage({
      flow: this.buildFlow(),
      notes: this.exportNotes(options.notes),
      outputDir: options.outputDir,
      documentName: options.name
    });
    this.stateValue.materialPackagePath = result.outputDir;
    return result;
  }

  async close(): Promise<void> {
    this.stateValue.isOpen = false;
    this.stateValue.isRecording = false;
    this.appendDebug('extension recorder closed');
  }

  private async recordNavigation(raw: ExtensionRecorderEvent) {
    await this.ensureStartStep(raw);
    const key = `${raw.url}|${raw.title}`;
    if (this.lastNavigationKey === key) return;
    const order = this.steps.length + 1;
    const id = stepId(order);
    const screenshot = await this.writeScreenshot(`${id}-navigation.png`, raw.screenshotDataUrl, id);
    const step: FlowStep = {
      id,
      order,
      type: 'navigation',
      label: raw.label || 'Page navigation',
      url: raw.url!,
      title: raw.title!,
      value: raw.url,
      valuePolicy: 'notStored',
      sensitive: false,
      pageContext: raw.pageContext,
      screenshot,
      screenshotKind: 'viewport',
      riskLevel: 'low',
      requiresConfirmation: false,
      requiresManualReview: false,
      timestamp: raw.timestamp || new Date().toISOString()
    };
    this.steps.push(step);
    this.stateValue.stepCount = this.steps.length;
    this.stateValue.lastAction = step.type;
    this.lastNavigationKey = key;
    this.appendDebug(`recorded ${id}: navigation ${raw.url}`);
  }

  private async recordAction(action: CapturedAction, raw: ExtensionRecorderEvent) {
    const order = this.steps.length + 1;
    const id = stepId(order);
    const type = action.type === 'submit' ? 'click' : action.type;
    const sensitive = isSensitiveField(action.element);
    const highRisk = detectHighRiskAction(`${action.label} ${action.value ?? ''}`);
    const screenshot = await this.writeScreenshot(`${id}-${type}.png`, raw.screenshotDataUrl, id);
    const step: FlowStep = {
      id,
      order,
      type,
      label: action.label,
      url: action.url,
      title: action.title,
      framePath: raw.framePath?.length ? raw.framePath : undefined,
      value: action.value,
      valuePolicy: sensitive ? 'masked' : type === 'fill' || type === 'select' || type === 'fileUpload' ? 'plain' : 'notStored',
      sensitive,
      selectors: selectorFromElement(action.element),
      element: action.element,
      pageContext: raw.pageContext,
      screenshot,
      screenshotKind: 'viewport',
      riskLevel: highRisk ? 'high' : 'low',
      requiresConfirmation: highRisk,
      requiresManualReview: false,
      timestamp: action.timestamp
    };
    this.steps.push(step);
    this.stateValue.stepCount = this.steps.length;
    this.stateValue.lastAction = step.type;
    this.appendDebug(`recorded ${id}: ${step.type} ${step.label}`);
  }

  private async ensureStartStep(raw: ExtensionRecorderEvent) {
    if (this.steps.length > 0) return;
    this.startUrl = raw.url || 'about:blank';
    const id = stepId(1);
    const screenshot = await this.writeScreenshot('step-001-start.png', raw.screenshotDataUrl, id);
    const step: FlowStep = {
      id,
      order: 1,
      type: 'goto',
      label: 'Open current browser page',
      url: raw.url || 'about:blank',
      title: raw.title || '',
      valuePolicy: 'notStored',
      sensitive: false,
      pageContext: raw.pageContext,
      screenshot,
      screenshotKind: 'viewport',
      riskLevel: 'low',
      requiresConfirmation: false,
      requiresManualReview: false,
      timestamp: raw.timestamp || new Date().toISOString()
    };
    this.steps.push(step);
    this.stateValue.stepCount = this.steps.length;
    this.stateValue.lastAction = step.type;
    this.lastNavigationKey = `${step.url}|${step.title}`;
    this.appendDebug(`recorded ${id}: goto ${step.url}`);
  }

  private async writeScreenshot(fileName: string, dataUrl: string | undefined, step: string): Promise<string> {
    await fs.mkdir(this.screenshotsDir, { recursive: true });
    if (!dataUrl?.startsWith('data:image/png;base64,')) {
      this.stateValue.notes.push(`Screenshot missing for ${step}; placeholder PNG was written.`);
    }
    await fs.writeFile(path.join(this.screenshotsDir, fileName), screenshotBuffer(dataUrl));
    this.stateValue.screenshotCount += 1;
    return `screenshots/${fileName}`;
  }

  private buildFlow(): FlowPackage {
    return {
      schemaVersion: '1.0.0',
      name: this.flowName,
      startUrl: this.startUrl,
      createdAt: new Date().toISOString(),
      steps: this.steps
    };
  }

  private buildMetadata(): FlowMetadata {
    return {
      toolVersion: '0.1.0',
      browser: 'User browser extension',
      viewport: this.metadataViewport,
      platform: process.platform,
      screenshotCount: this.stateValue.screenshotCount,
      containsPassword: this.steps.some((step) => step.sensitive),
      containsCookies: false
    };
  }

  private exportNotes(notes: string): string {
    const debugNotes = this.stateValue.debugLog.length
      ? ['Extension recorder debug log:', ...this.stateValue.debugLog].join('\n')
      : '';
    return [notes, ...this.stateValue.notes, debugNotes].filter(Boolean).join('\n');
  }

  previewOperationMarkdown(options: { name?: string; notes?: string } = {}): string {
    const flow = {
      ...this.buildFlow(),
      name: options.name || this.flowName
    };
    return buildOperationMarkdown({
      flow,
      metadata: this.buildMetadata(),
      notes: this.exportNotes(options.notes || '')
    });
  }

  private appendDebug(message: string) {
    const line = `${new Date().toISOString()} ${message}`;
    this.stateValue.debugLog = [...this.stateValue.debugLog, line].slice(-200);
    if (this.options.debugLogPath) {
      try {
        fsSync.mkdirSync(path.dirname(this.options.debugLogPath), { recursive: true });
        fsSync.appendFileSync(this.options.debugLogPath, `${line}\n`, 'utf8');
      } catch {
        // Debug logging must never break user recording.
      }
    }
  }
}
