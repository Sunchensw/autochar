import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const packageScript = () => fs.readFileSync(path.resolve('scripts/package-user.mjs'), 'utf8');
const browserScript = () => fs.readFileSync(path.resolve('scripts/ensure-playwright-browsers.mjs'), 'utf8');
const builderConfig = () => fs.readFileSync(path.resolve('apps/recorder/electron-builder.yml'), 'utf8');

describe('user package scripts', () => {
  test('prepares only the Chromium browser needed by packaged recorder', () => {
    expect(browserScript()).toContain("'--no-shell'");
  });

  test('uses a longer Playwright download connection timeout for user packaging', () => {
    expect(browserScript()).toContain('PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT');
    expect(browserScript()).toContain("?? '180000'");
    expect(packageScript()).toContain('PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT');
    expect(packageScript()).toContain("?? '180000'");
  });

  test('uses the installed Electron runtime instead of downloading it during packaging', () => {
    expect(builderConfig()).toContain('electronDist: ../../node_modules/electron/dist');
  });
});
