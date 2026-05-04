import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';

const playwrightMock = vi.hoisted(() => {
  const page = {
    exposeBinding: vi.fn(async () => undefined),
    addInitScript: vi.fn(async () => undefined),
    on: vi.fn(),
    goto: vi.fn(async () => undefined),
    evaluate: vi.fn(async () => ({ width: 1440, height: 900 }))
  };
  const context = {
    exposeBinding: vi.fn(async () => undefined),
    addInitScript: vi.fn(async () => undefined),
    on: vi.fn(),
    newPage: vi.fn(async () => page)
  };
  const browser = {
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => undefined)
  };
  return {
    page,
    context,
    browser,
    launch: vi.fn(async () => browser)
  };
});

vi.mock('playwright', () => ({
  chromium: {
    launch: playwrightMock.launch
  }
}));

import { RecorderSession } from '../src';

describe('RecorderSession browser window sizing', () => {
  test('opens headed Chromium maximized without a fixed emulated viewport', async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autochar-browser-window-'));
    const session = new RecorderSession({ workDir, headless: false, remoteDebuggingPort: 9223 });

    await session.open('http://localhost:4173');

    expect(playwrightMock.launch).toHaveBeenCalledWith({
      headless: false,
      args: expect.arrayContaining([
        '--start-maximized',
        '--remote-debugging-address=127.0.0.1',
        '--remote-debugging-port=9223'
      ])
    });
    expect(playwrightMock.browser.newContext).toHaveBeenCalledWith({ viewport: null, bypassCSP: true });
  });
});
