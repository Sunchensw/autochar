import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const mainSource = fs.readFileSync(path.resolve('apps/recorder/src/main.ts'), 'utf8');

describe('recorder Playwright bootstrap order', () => {
  test('does not load recorder-core before PLAYWRIGHT_BROWSERS_PATH is configured', () => {
    expect(mainSource).not.toContain("import { RecorderSession } from '@autochar/recorder-core'");
    expect(mainSource).toContain("await import('@autochar/recorder-core')");
  });
});
