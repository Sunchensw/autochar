import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const mainSource = fs.readFileSync(path.resolve('apps/operator-console/src/main.ts'), 'utf8');

describe('operator Playwright bootstrap order', () => {
  test('does not load batch-runner before PLAYWRIGHT_BROWSERS_PATH is configured', () => {
    expect(mainSource).not.toContain("import { runBatch } from '@autochar/batch-runner'");
    expect(mainSource).toContain("await import('@autochar/batch-runner')");
  });
});
