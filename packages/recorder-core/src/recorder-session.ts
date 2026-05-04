import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Frame,
  type LaunchOptions,
  type Page
} from 'playwright';
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
  viewport?: { width: number; height: number } | null;
  debugLogPath?: string;
  remoteDebuggingPort?: number;
}

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
}

export interface ExportRecordingOptions {
  name: string;
  notes: string;
  outputDir: string;
  reviewMarkdown?: string;
}

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
    notes: [],
    debugLog: [],
    debugLogPath: undefined,
    remoteDebuggingPort: undefined
  };
  private readonly workDir: string;
  private readonly screenshotsDir: string;
  private readonly viewport: BrowserContextOptions['viewport'];
  private metadataViewport: { width: number; height: number };
  private navigationRevision = 0;
  private lastScreenshotState?: PageScreenshotState;
  private lastScreenshotRef?: string;
  private readonly attachedPages = new WeakSet<Page>();
  private readonly lastNavigationKeys = new WeakMap<Page, string>();

  constructor(private readonly options: RecorderSessionOptions = {}) {
    this.workDir = options.workDir ?? path.join(os.tmpdir(), `autochar-recording-${Date.now()}`);
    this.screenshotsDir = path.join(this.workDir, 'screenshots');
    this.viewport = options.viewport === undefined ? null : options.viewport;
    this.metadataViewport = options.viewport ?? { width: 1365, height: 768 };
    this.stateValue.debugLogPath = options.debugLogPath;
    this.stateValue.remoteDebuggingPort = options.remoteDebuggingPort;
  }

  getState(): RecordingState {
    return {
      ...this.stateValue,
      notes: [...this.stateValue.notes],
      debugLog: [...this.stateValue.debugLog]
    };
  }

  async open(startUrl: string): Promise<void> {
    this.startUrl = startUrl;
    await fs.mkdir(this.screenshotsDir, { recursive: true });
    const headless = this.options.headless ?? false;
    const args = headless ? [] : ['--start-maximized'];
    if (this.options.remoteDebuggingPort) {
      args.push('--remote-debugging-address=127.0.0.1');
      args.push(`--remote-debugging-port=${this.options.remoteDebuggingPort}`);
    }
    const launchOptions: LaunchOptions = headless
      ? { headless }
      : { headless, args };
    this.browser = await chromium.launch(launchOptions);
    this.context = await this.browser.newContext({ viewport: this.viewport, bypassCSP: true });
    await this.installCapture();
    this.page = await this.context.newPage();
    this.attachPage(this.page);
    await this.page.goto(startUrl);
    await this.updateMetadataViewport();
    this.stateValue.isOpen = true;
    this.appendDebug(`opened browser at ${startUrl}`);
  }

  private async updateMetadataViewport(page = this.page) {
    if (!page) return;
    const actualViewport = await page
      .evaluate(() => ({
        width: Math.round(window.innerWidth),
        height: Math.round(window.innerHeight)
      }))
      .catch(() => undefined);
    if (
      actualViewport &&
      Number.isFinite(actualViewport.width) &&
      Number.isFinite(actualViewport.height) &&
      actualViewport.width > 0 &&
      actualViewport.height > 0
    ) {
      this.metadataViewport = actualViewport;
    }
  }

  private async installCapture() {
    if (!this.context) return;
    await this.context.exposeBinding('__autocharCapture', async (source, raw) => {
      const sourcePage = source.page ?? this.page;
      if (sourcePage) {
        this.page = sourcePage;
        this.attachPage(sourcePage);
      }
      this.appendDebug(`captured ${this.captureSummary(raw)}`);
      const action = normalizeCapturedAction(raw);
      if (!action) {
        this.appendDebug(`ignored ${this.captureSummary(raw)}`);
        return;
      }
      if (this.stateValue.isRecording) {
        const framePath = await this.framePathFromSource(source.frame).catch(() => []);
        await this.recordAction(sourcePage ?? this.page, action, framePath).catch((error) => {
          const message = `Failed to record action: ${String(error)}`;
          this.stateValue.notes.push(message);
          this.appendDebug(message);
        });
      } else {
        this.appendDebug(`ignored ${action.type}: recorder is not running`);
      }
    });
    await this.context.addInitScript(buildCaptureScript());
    this.context.on('page', (page) => {
      this.page = page;
      this.attachPage(page);
      this.appendDebug('attached new Chromium page');
    });
  }

  private attachPage(page: Page) {
    if (this.attachedPages.has(page)) return;
    this.attachedPages.add(page);
    page.on('framenavigated', async (frame) => {
      if (frame === page.mainFrame()) {
        this.page = page;
        this.navigationRevision += 1;
        this.appendDebug(`navigation observed: ${page.url()}`);
        await this.handlePageReady(page, 'framenavigated', true);
      } else {
        await this.injectCaptureIntoFrame(frame, 'child frame navigated');
      }
    });
    page.on('frameattached', async (frame) => {
      await this.injectCaptureIntoFrame(frame, 'child frame attached');
    });
    page.on('domcontentloaded', async () => {
      this.page = page;
      await this.handlePageReady(page, 'domcontentloaded');
    });
  }

  private async handlePageReady(page: Page, reason: string, waitForDomContentLoaded = false) {
    if (waitForDomContentLoaded) {
      await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch((error) => {
        this.appendDebug(`navigation ready wait skipped after ${reason}: ${String(error)}`);
      });
    }
    await page.evaluate(buildCaptureScript()).catch((error) => {
      this.appendDebug(`capture script reinjection failed after ${reason}: ${String(error)}`);
    });
    await this.injectCaptureIntoChildFrames(page, reason);
    await this.updateMetadataViewport(page);
    await this.recordNavigation(page).catch((error) => {
      const message = `Failed to record navigation after ${reason}: ${String(error)}`;
      this.stateValue.notes.push(message);
      this.appendDebug(message);
    });
  }

  private async injectCaptureIntoChildFrames(page: Page, reason: string) {
    const frames = typeof page.frames === 'function' ? page.frames() : [];
    const childFrames = frames.filter((frame) => frame !== page.mainFrame());
    await Promise.all(childFrames.map((frame) => this.injectCaptureIntoFrame(frame, reason)));
  }

  private async injectCaptureIntoFrame(frame: Frame, reason: string) {
    const script = buildCaptureScript();
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await frame.evaluate(script);
        this.appendDebug(`capture script injected into frame after ${reason}: ${frame.url()}`);
        return;
      } catch (error) {
        this.appendDebug(`capture script frame injection failed after ${reason} attempt ${attempt}: ${String(error)}`);
        if (attempt < 2) {
          await frame.waitForLoadState('domcontentloaded', { timeout: 1000 }).catch((waitError) => {
            this.appendDebug(`capture script frame retry wait skipped after ${reason}: ${String(waitError)}`);
          });
        }
      }
    }
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

  private captureSummary(raw: unknown): string {
    if (!raw || typeof raw !== 'object') return 'unknown payload';
    const input = raw as Record<string, unknown>;
    const element = input.element && typeof input.element === 'object'
      ? input.element as Record<string, unknown>
      : {};
    const type = typeof input.type === 'string' ? input.type : 'unknown';
    const label = typeof input.label === 'string' && input.label ? input.label : '-';
    const tag = typeof element.tagName === 'string' && element.tagName ? element.tagName.toLowerCase() : 'element';
    const role = typeof element.role === 'string' && element.role ? `[role=${element.role}]` : '';
    const id = typeof element.id === 'string' && element.id ? `#${element.id}` : '';
    const name = typeof element.name === 'string' && element.name ? `[name=${element.name}]` : '';
    const url = typeof input.url === 'string' ? input.url : '';
    return `${type} ${label} ${tag}${id}${name}${role} ${url}`.trim();
  }

  private async framePathFromSource(frame: Frame | undefined): Promise<string[]> {
    if (!frame?.parentFrame()) return [];
    const frames: Frame[] = [];
    let current: Frame | null = frame;
    while (current?.parentFrame()) {
      frames.unshift(current);
      current = current.parentFrame();
    }
    const selectors: string[] = [];
    for (const item of frames) {
      selectors.push(await this.frameSelector(item));
    }
    return selectors;
  }

  private async frameSelector(frame: Frame): Promise<string> {
    const element = await frame.frameElement().catch(() => undefined);
    if (!element) return 'iframe';
    const metadata = await element.evaluate((node) => {
      const iframe = node as Element;
      return {
        id: iframe.getAttribute('id') || '',
        name: iframe.getAttribute('name') || '',
        title: iframe.getAttribute('title') || '',
        src: iframe.getAttribute('src') || '',
        testId:
          iframe.getAttribute('data-testid') ||
          iframe.getAttribute('data-test') ||
          iframe.getAttribute('data-qa') ||
          ''
      };
    }).catch(() => undefined);
    if (!metadata) return 'iframe';
    if (metadata.testId) return `iframe[data-testid="${cssEscapeValue(metadata.testId)}"]`;
    if (metadata.id) return `iframe#${cssEscapeValue(metadata.id)}`;
    if (metadata.name) return `iframe[name="${cssEscapeValue(metadata.name)}"]`;
    if (metadata.title) return `iframe[title="${cssEscapeValue(metadata.title)}"]`;
    if (metadata.src) return `iframe[src*="${cssEscapeValue(metadata.src)}"]`;
    return 'iframe';
  }

  private async recordNavigation(page: Page): Promise<void> {
    if (!this.stateValue.isRecording) return;
    const url = page.url();
    if (!url || url === 'about:blank') return;
    const title = await page.title().catch(() => '');
    const key = `${url}|${title}|${this.navigationRevision}`;
    if (this.lastNavigationKeys.get(page) === key) return;
    this.lastNavigationKeys.set(page, key);

    const order = this.steps.length + 1;
    const id = stepId(order);
    const screenshotFile = `${id}-navigation.png`;
    const screenshotState = await this.readPageScreenshotState(page, url, title);
    let screenshotRef: string | undefined;
    try {
      screenshotRef = await this.captureScreenshotForState(page, screenshotFile, screenshotState);
    } catch (error) {
      this.stateValue.notes.push(`Screenshot failed for ${id}: ${String(error)}`);
    }
    const step: FlowStep = {
      id,
      order,
      type: 'navigation',
      label: 'Page navigation',
      url,
      title,
      value: url,
      valuePolicy: 'notStored',
      sensitive: false,
      screenshot: screenshotRef,
      screenshotKind: 'viewport',
      riskLevel: 'low',
      requiresConfirmation: false,
      requiresManualReview: false,
      timestamp: new Date().toISOString()
    };
    this.steps.push(step);
    this.stateValue.stepCount = this.steps.length;
    this.stateValue.lastAction = step.type;
    this.appendDebug(`recorded ${id}: navigation ${url}`);
  }

  async startRecording(): Promise<void> {
    if (!this.page) throw new Error('Browser is not open.');
    this.steps = [];
    this.lastScreenshotState = undefined;
    this.lastScreenshotRef = undefined;
    this.lastNavigationKeys.set(this.page, `${this.page.url()}|${await this.page.title()}|${this.navigationRevision}`);
    this.stateValue = { ...this.stateValue, isRecording: true, stepCount: 0, screenshotCount: 0, notes: [] };
    this.appendDebug('recording started');
    const id = stepId(1);
    const screenshotFile = 'step-001-start.png';
    const screenshotState = await this.readPageScreenshotState(this.page);
    const screenshotRef = await this.captureScreenshotForState(this.page, screenshotFile, screenshotState, true);
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

  private async readPageScreenshotState(page = this.page, url?: string, title?: string): Promise<PageScreenshotState> {
    if (!page) throw new Error('Browser is not open.');
    const scroll = await page
      .evaluate(() => ({
        scrollX: Math.round(window.scrollX),
        scrollY: Math.round(window.scrollY)
      }))
      .catch(() => ({ scrollX: 0, scrollY: 0 }));
    return {
      url: url ?? page.url(),
      title: title ?? await page.title(),
      scrollX: scroll.scrollX,
      scrollY: scroll.scrollY,
      navigationRevision: this.navigationRevision
    };
  }

  private async captureScreenshotForState(
    page: Page,
    fileName: string,
    state: PageScreenshotState,
    force = false
  ): Promise<string> {
    if (!force && this.lastScreenshotRef && !shouldCapturePageStateScreenshot(this.lastScreenshotState, state)) {
      return this.lastScreenshotRef;
    }
    await capturePageScreenshot({ page, screenshotsDir: this.screenshotsDir, fileName });
    const screenshotRef = `screenshots/${fileName}`;
    this.lastScreenshotState = state;
    this.lastScreenshotRef = screenshotRef;
    this.stateValue.screenshotCount += 1;
    return screenshotRef;
  }

  private async recordAction(page: Page | undefined, action: CapturedAction, framePath: string[] = []): Promise<void> {
    if (!page) return;
    this.page = page;
    const order = this.steps.length + 1;
    const id = stepId(order);
    const type = action.type === 'submit' ? 'click' : action.type;
    const sensitive = isSensitiveField(action.element);
    const highRisk = detectHighRiskAction(`${action.label} ${action.value ?? ''}`);
    const screenshotFile = `${id}-${type}.png`;
    const screenshotState = await this.readPageScreenshotState(page, action.url, action.title);
    let screenshotRef: string | undefined;
    try {
      screenshotRef = await this.captureScreenshotForState(page, screenshotFile, screenshotState);
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
      framePath: framePath.length ? framePath : undefined,
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
    this.appendDebug(`recorded ${id}: ${step.type} ${step.label}`);
  }

  async stopRecording(): Promise<FlowPackage> {
    if (!this.page) throw new Error('Browser is not open.');
    this.stateValue.isRecording = false;
    try {
      const screenshotState = await this.readPageScreenshotState(this.page);
      if (shouldCapturePageStateScreenshot(this.lastScreenshotState, screenshotState)) {
        await this.captureScreenshotForState(this.page, 'final.png', screenshotState);
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
      viewport: this.metadataViewport,
      platform: process.platform,
      screenshotCount: this.stateValue.screenshotCount,
      containsPassword: this.steps.some((step) => step.sensitive),
      containsCookies: false
    };
  }

  async exportRecording(options: ExportRecordingOptions): Promise<string> {
    this.flowName = options.name;
    const flow = this.buildFlow();
    const debugNotes = this.stateValue.debugLog.length
      ? ['Recorder debug log:', ...this.stateValue.debugLog].join('\n')
      : '';
    const zipPath = await writeFlowPackage({
      flow,
      metadata: this.buildMetadata(),
      notes: [options.notes, ...this.stateValue.notes, debugNotes].filter(Boolean).join('\n'),
      reviewMarkdown: options.reviewMarkdown,
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
    this.appendDebug('browser closed');
  }
}
