import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import {
  detectHighRiskAction,
  isSensitiveField,
  type FlowMetadata,
  type FlowPackage,
  type FlowStep,
  type SelectorSet
} from '@autochar/shared';
import { normalizeCapturedAction, buildCaptureScript, type CapturedAction } from './action-capture';
import {
  capturePageScreenshot,
  shouldCapturePageStateScreenshot,
  type PageScreenshotState
} from './screenshot';
import { writeFlowPackage } from './export-flow';

export interface RecorderSessionOptions {
  workDir?: string;
  headless?: boolean;
  viewport?: { width: number; height: number };
}

export interface RecordingState {
  isOpen: boolean;
  isRecording: boolean;
  stepCount: number;
  screenshotCount: number;
  lastAction?: string;
  notes: string[];
  exportPath?: string;
}

export interface ExportRecordingOptions {
  name: string;
  notes: string;
  outputDir: string;
}

function stepId(order: number) {
  return `step-${String(order).padStart(3, '0')}`;
}

function selectorFromElement(element: Record<string, string | undefined>): SelectorSet {
  const fallbacks = [];
  const css = element.id
    ? `${(element.tagName || 'element').toLowerCase()}#${element.id}`
    : element.name
      ? `${(element.tagName || 'element').toLowerCase()}[name="${element.name}"]`
      : (element.testId ? `[data-testid="${element.testId}"]` : `${(element.tagName || 'element').toLowerCase()}`);
  if (element.placeholder) fallbacks.push({ kind: 'placeholder' as const, value: element.placeholder });
  if (element.name) fallbacks.push({ kind: 'name' as const, value: element.name });
  if (element.id) fallbacks.push({ kind: 'id' as const, value: element.id });
  fallbacks.push({ kind: 'css' as const, value: css });
  const primary = element.testId
    ? { kind: 'testId' as const, value: element.testId }
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

export class RecorderSession {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private startUrl = '';
  private flowName = 'Untitled flow';
  private steps: FlowStep[] = [];
  private stateValue: RecordingState = {
    isOpen: false,
    isRecording: false,
    stepCount: 0,
    screenshotCount: 0,
    notes: []
  };
  private readonly workDir: string;
  private readonly screenshotsDir: string;
  private readonly viewport: { width: number; height: number };
  private navigationRevision = 0;
  private lastScreenshotState?: PageScreenshotState;
  private lastScreenshotRef?: string;

  constructor(private readonly options: RecorderSessionOptions = {}) {
    this.workDir = options.workDir ?? path.join(os.tmpdir(), `autochar-recording-${Date.now()}`);
    this.screenshotsDir = path.join(this.workDir, 'screenshots');
    this.viewport = options.viewport ?? { width: 1365, height: 768 };
  }

  getState(): RecordingState {
    return { ...this.stateValue };
  }

  async open(startUrl: string): Promise<void> {
    this.startUrl = startUrl;
    await fs.mkdir(this.screenshotsDir, { recursive: true });
    this.browser = await chromium.launch({ headless: this.options.headless ?? false });
    this.context = await this.browser.newContext({ viewport: this.viewport });
    this.page = await this.context.newPage();
    await this.installCapture();
    await this.page.goto(startUrl);
    this.stateValue.isOpen = true;
  }

  private async installCapture() {
    if (!this.page) return;
    await this.page.exposeBinding('__autocharCapture', async (_source, raw) => {
      const action = normalizeCapturedAction(raw);
      if (action && this.stateValue.isRecording) {
        await this.recordAction(action).catch((error) => {
          this.stateValue.notes.push(`Failed to record action: ${String(error)}`);
        });
      }
    });
    await this.page.addInitScript(buildCaptureScript());
    this.page.on('framenavigated', (frame) => {
      if (frame === this.page?.mainFrame()) {
        this.navigationRevision += 1;
      }
    });
    this.page.on('domcontentloaded', async () => {
      await this.page?.evaluate(buildCaptureScript()).catch(() => undefined);
    });
  }

  async startRecording(): Promise<void> {
    if (!this.page) throw new Error('Browser is not open.');
    this.steps = [];
    this.lastScreenshotState = undefined;
    this.lastScreenshotRef = undefined;
    this.stateValue = { ...this.stateValue, isRecording: true, stepCount: 0, screenshotCount: 0, notes: [] };
    const id = stepId(1);
    const screenshotFile = 'step-001-start.png';
    const screenshotState = await this.readPageScreenshotState();
    const screenshotRef = await this.captureScreenshotForState(screenshotFile, screenshotState, true);
    this.steps.push({
      id,
      order: 1,
      type: 'goto',
      label: '打开起始页面',
      url: this.page.url(),
      title: await this.page.title(),
      valuePolicy: 'notStored',
      sensitive: false,
      screenshot: screenshotRef,
      screenshotKind: 'viewport',
      riskLevel: 'low',
      requiresConfirmation: false,
      requiresManualReview: false,
      timestamp: new Date().toISOString()
    });
    this.stateValue.stepCount = this.steps.length;
    this.stateValue.lastAction = 'goto';
  }

  private async readPageScreenshotState(url?: string, title?: string): Promise<PageScreenshotState> {
    if (!this.page) throw new Error('Browser is not open.');
    const scroll = await this.page
      .evaluate(() => ({
        scrollX: Math.round(window.scrollX),
        scrollY: Math.round(window.scrollY)
      }))
      .catch(() => ({ scrollX: 0, scrollY: 0 }));
    return {
      url: url ?? this.page.url(),
      title: title ?? await this.page.title(),
      scrollX: scroll.scrollX,
      scrollY: scroll.scrollY,
      navigationRevision: this.navigationRevision
    };
  }

  private async captureScreenshotForState(
    fileName: string,
    state: PageScreenshotState,
    force = false
  ): Promise<string> {
    if (!force && this.lastScreenshotRef && !shouldCapturePageStateScreenshot(this.lastScreenshotState, state)) {
      return this.lastScreenshotRef;
    }
    if (!this.page) throw new Error('Browser is not open.');
    await capturePageScreenshot({ page: this.page, screenshotsDir: this.screenshotsDir, fileName });
    const screenshotRef = `screenshots/${fileName}`;
    this.lastScreenshotState = state;
    this.lastScreenshotRef = screenshotRef;
    this.stateValue.screenshotCount += 1;
    return screenshotRef;
  }

  private async recordAction(action: CapturedAction): Promise<void> {
    if (!this.page) return;
    const order = this.steps.length + 1;
    const id = stepId(order);
    const type = action.type === 'submit' ? 'click' : action.type;
    const sensitive = isSensitiveField(action.element);
    const highRisk = detectHighRiskAction(`${action.label} ${action.value ?? ''}`);
    const screenshotFile = `${id}-${type}.png`;
    const screenshotState = await this.readPageScreenshotState(action.url, action.title);
    let screenshotRef: string | undefined;
    try {
      screenshotRef = await this.captureScreenshotForState(screenshotFile, screenshotState);
    } catch (error) {
      this.stateValue.notes.push(`Screenshot failed for ${id}: ${String(error)}`);
    }
    const step: FlowStep = {
      id,
      order,
      type,
      label: action.label,
      url: action.url,
      title: action.title,
      value: action.value,
      valuePolicy: sensitive ? 'masked' : type === 'fill' || type === 'select' || type === 'fileUpload' ? 'plain' : 'notStored',
      sensitive,
      selectors: selectorFromElement(action.element),
      element: action.element,
      screenshot: screenshotRef,
      screenshotKind: 'viewport',
      riskLevel: highRisk ? 'high' : 'low',
      requiresConfirmation: highRisk,
      requiresManualReview: false,
      timestamp: action.timestamp
    };
    this.steps.push(step);
    this.stateValue.stepCount = this.steps.length;
    this.stateValue.lastAction = step.type;
  }

  async stopRecording(): Promise<FlowPackage> {
    if (!this.page) throw new Error('Browser is not open.');
    this.stateValue.isRecording = false;
    try {
      const screenshotState = await this.readPageScreenshotState();
      if (shouldCapturePageStateScreenshot(this.lastScreenshotState, screenshotState)) {
        await this.captureScreenshotForState('final.png', screenshotState);
      }
    } catch (error) {
      this.stateValue.notes.push(`Final screenshot failed: ${String(error)}`);
    }
    return this.buildFlow();
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
      browser: 'Playwright Chromium',
      viewport: this.viewport,
      platform: process.platform,
      screenshotCount: this.stateValue.screenshotCount,
      containsPassword: this.steps.some((step) => step.sensitive),
      containsCookies: false
    };
  }

  async exportRecording(options: ExportRecordingOptions): Promise<string> {
    this.flowName = options.name;
    const flow = this.buildFlow();
    const zipPath = await writeFlowPackage({
      flow,
      metadata: this.buildMetadata(),
      notes: [options.notes, ...this.stateValue.notes].filter(Boolean).join('\n'),
      screenshotsDir: this.screenshotsDir,
      outputDir: options.outputDir,
      packageName: options.name
    });
    this.stateValue.exportPath = zipPath;
    return zipPath;
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = undefined;
    this.context = undefined;
    this.page = undefined;
    this.stateValue.isOpen = false;
    this.stateValue.isRecording = false;
  }
}
