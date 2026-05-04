import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { buildStepScreenshotName, capturePageScreenshot } from '../src';

test('buildStepScreenshotName maps final and normal steps', () => {
  expect(buildStepScreenshotName('step-002-fill')).toBe('step-002-fill.png');
  expect(buildStepScreenshotName('final')).toBe('final.png');
});

test('capturePageScreenshot writes through page.screenshot', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autochar-shot-'));
  const page = {
    screenshot: async ({ path: outputPath }: { path: string }) => {
      fs.writeFileSync(outputPath, 'png');
    }
  };

  const output = await capturePageScreenshot({
    page: page as never,
    screenshotsDir: dir,
    fileName: 'step-001-start.png'
  });

  expect(fs.existsSync(output)).toBe(true);
});
