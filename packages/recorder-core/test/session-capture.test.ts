import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';

const playwrightMock = vi.hoisted(() => {
  let binding: undefined | ((source: unknown, raw: unknown) => Promise<void>);
  let currentUrl = 'https://example.test/admin/products';
  let currentTitle = 'Products';
  const pageListeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const contextListeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const mainFrame = {
    url: () => currentUrl,
    parentFrame: () => null,
    evaluate: vi.fn(async () => undefined)
  };
  const childFrame = {
    url: () => `${currentUrl}/child-frame`,
    parentFrame: () => mainFrame,
    evaluate: vi.fn(async () => undefined),
    waitForLoadState: vi.fn(async () => undefined),
    frameElement: vi.fn(async () => ({
      evaluate: vi.fn(async () => ({ id: 'editor-frame', name: '', title: '', src: '', testId: '' }))
    }))
  };
  const page = {
    exposeBinding: vi.fn(async () => undefined),
    addInitScript: vi.fn(async () => undefined),
    on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
      pageListeners.set(event, [...(pageListeners.get(event) ?? []), callback]);
    }),
    goto: vi.fn(async () => undefined),
    waitForLoadState: vi.fn(async () => undefined),
    evaluate: vi.fn(async (fn?: unknown) => {
      if (typeof fn === 'function') {
        return { width: 1440, height: 900, scrollX: 0, scrollY: 0 };
      }
      return undefined;
    }),
    screenshot: vi.fn(async ({ path: outputPath }: { path: string }) => {
      fs.writeFileSync(outputPath, 'png');
    }),
    url: vi.fn(() => currentUrl),
    title: vi.fn(async () => currentTitle),
    mainFrame: vi.fn(() => mainFrame),
    frames: vi.fn(() => [mainFrame, childFrame])
  };
  const context = {
    exposeBinding: vi.fn(async (_name: string, callback: (source: unknown, raw: unknown) => Promise<void>) => {
      binding = callback;
    }),
    addInitScript: vi.fn(async () => undefined),
    newPage: vi.fn(async () => page),
    on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
      contextListeners.set(event, [...(contextListeners.get(event) ?? []), callback]);
    })
  };
  const browser = {
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => undefined)
  };
  return {
    page,
    context,
    browser,
    launch: vi.fn(async () => browser),
    get binding() {
      return binding;
    },
    reset() {
      pageListeners.clear();
      contextListeners.clear();
      binding = undefined;
      for (const item of [
        page.exposeBinding,
        page.addInitScript,
        page.on,
        page.goto,
        page.waitForLoadState,
        page.evaluate,
        page.screenshot,
        page.url,
        page.title,
        page.mainFrame,
        page.frames,
        mainFrame.evaluate,
        childFrame.evaluate,
        childFrame.waitForLoadState,
        childFrame.frameElement,
        context.exposeBinding,
        context.addInitScript,
        context.newPage,
        context.on,
        browser.newContext,
        browser.close,
        this.launch
      ]) {
        item.mockClear();
      }
      currentUrl = 'https://example.test/admin/products';
      currentTitle = 'Products';
    },
    async emitPageEvent(event: string, ...args: unknown[]) {
      const listeners = pageListeners.get(event) ?? [];
      await Promise.all(listeners.map((listener) => listener(...args)));
    },
    setPageLocation(url: string, title: string) {
      currentUrl = url;
      currentTitle = title;
    },
    mainFrame
    ,
    childFrame
  };
});

vi.mock('playwright', () => ({
  chromium: {
    launch: playwrightMock.launch
  }
}));

import { RecorderSession } from '../src';

describe('RecorderSession capture plumbing', () => {
  test('installs capture binding and init script at context level', async () => {
    playwrightMock.reset();
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autochar-session-capture-'));
    const session = new RecorderSession({ workDir, headless: false });

    await session.open('https://example.test/admin/products');

    expect(playwrightMock.context.exposeBinding).toHaveBeenCalledWith(
      '__autocharCapture',
      expect.any(Function)
    );
    expect(playwrightMock.context.addInitScript).toHaveBeenCalledWith(expect.stringContaining('__autocharCaptureInstalled'));
    expect(playwrightMock.context.on).toHaveBeenCalledWith('page', expect.any(Function));
    expect(playwrightMock.page.exposeBinding).not.toHaveBeenCalled();
  });

  test('records safe debug log entries when captured actions reach the binding', async () => {
    playwrightMock.reset();
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autochar-session-log-'));
    const session = new RecorderSession({ workDir, headless: false });

    await session.open('https://example.test/admin/products');
    await session.startRecording();
    await playwrightMock.binding?.(
      { page: playwrightMock.page, frame: playwrightMock.page.mainFrame() },
      {
        type: 'click',
        label: 'Save product',
        element: { tagName: 'BUTTON', text: 'Save product', role: 'button' },
        url: 'https://example.test/admin/products/1',
        title: 'Product detail',
        timestamp: new Date('2026-01-01T00:00:00.000Z').toISOString()
      }
    );

    const state = session.getState();
    expect(state.stepCount).toBe(2);
    expect(state.debugLog?.some((line) => line.includes('captured click') && line.includes('Save product'))).toBe(true);
    expect(state.debugLog?.some((line) => line.includes('recorded step-002'))).toBe(true);
  });

  test('persists recorder debug logs to disk when debugLogPath is configured', async () => {
    playwrightMock.reset();
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autochar-session-file-log-'));
    const debugLogPath = path.join(workDir, 'recorder-debug.log');
    const session = new RecorderSession({ workDir, headless: false, debugLogPath });

    await session.open('https://example.test/admin/products');
    await session.startRecording();

    const log = fs.readFileSync(debugLogPath, 'utf8');
    expect(log).toContain('opened browser at https://example.test/admin/products');
    expect(log).toContain('recording started');
  });

  test('continues recording when navigation only emits framenavigated', async () => {
    playwrightMock.reset();
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autochar-session-navigation-'));
    const session = new RecorderSession({ workDir, headless: false });

    await session.open('https://example.test/admin/products');
    await session.startRecording();
    playwrightMock.setPageLocation('https://example.test/admin/products/1/edit', 'Edit product');
    await playwrightMock.emitPageEvent('framenavigated', playwrightMock.mainFrame);
    await playwrightMock.binding?.(
      { page: playwrightMock.page, frame: playwrightMock.page.mainFrame() },
      {
        type: 'fill',
        label: 'Product title',
        value: 'New title',
        element: { tagName: 'INPUT', placeholder: 'Product title' },
        url: 'https://example.test/admin/products/1/edit',
        title: 'Edit product',
        timestamp: new Date('2026-01-01T00:00:00.000Z').toISOString()
      }
    );

    const state = session.getState();
    expect(state.stepCount).toBe(3);
    expect(state.lastAction).toBe('fill');
    expect(state.debugLog.some((line) => line.includes('recorded step-002: navigation'))).toBe(true);
    expect(state.debugLog.some((line) => line.includes('recorded step-003: fill Product title'))).toBe(true);
  });

  test('injects capture script into child frames after page navigation', async () => {
    playwrightMock.reset();
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autochar-session-frame-'));
    const session = new RecorderSession({ workDir, headless: false });

    await session.open('https://example.test/admin/products');
    await session.startRecording();
    playwrightMock.setPageLocation('https://example.test/admin/products/1/edit', 'Edit product');
    await playwrightMock.emitPageEvent('framenavigated', playwrightMock.mainFrame);

    expect(playwrightMock.childFrame.evaluate).toHaveBeenCalledWith(expect.stringContaining('__autocharCaptureInstalled'));
  });

  test('retries child frame capture injection after the frame becomes ready', async () => {
    playwrightMock.reset();
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autochar-session-frame-retry-'));
    const session = new RecorderSession({ workDir, headless: false });
    playwrightMock.childFrame.evaluate.mockRejectedValueOnce(new Error('Execution context was destroyed'));

    await session.open('https://example.test/admin/products');
    await session.startRecording();
    playwrightMock.setPageLocation('https://example.test/admin/products/1/edit', 'Edit product');
    await playwrightMock.emitPageEvent('framenavigated', playwrightMock.mainFrame);

    expect(playwrightMock.childFrame.waitForLoadState).toHaveBeenCalledWith('domcontentloaded', { timeout: 1000 });
    expect(playwrightMock.childFrame.evaluate).toHaveBeenCalledTimes(2);
    expect(session.getState().debugLog.some((line) => line.includes('capture script injected into frame'))).toBe(true);
  });
});
