import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { describe, expect, test } from 'vitest';
import { writeFlowPackage } from '../src';
import type { FlowMetadata, FlowPackage } from '@autochar/shared';

const flow: FlowPackage = {
  schemaVersion: '1.0.0',
  name: 'Export flow',
  startUrl: 'http://localhost:4173',
  createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
  steps: [
    {
      id: 'step-001',
      order: 1,
      type: 'goto',
      label: '打开起始页面',
      url: 'http://localhost:4173',
      title: 'Demo',
      valuePolicy: 'notStored',
      sensitive: false,
      screenshot: 'screenshots/step-001-start.png',
      screenshotKind: 'viewport',
      riskLevel: 'low',
      requiresConfirmation: false,
      requiresManualReview: false,
      timestamp: new Date('2026-01-01T00:00:00.000Z').toISOString()
    },
    {
      id: 'step-002',
      order: 2,
      type: 'click',
      label: '点击搜索',
      url: 'http://localhost:4173',
      title: 'Demo',
      valuePolicy: 'notStored',
      sensitive: false,
      selectors: {
        primary: { kind: 'role', value: 'button', role: 'button', name: '搜索' },
        fallbacks: [{ kind: 'text', value: '搜索' }]
      },
      element: { tagName: 'BUTTON', text: '搜索' },
      screenshot: 'screenshots/step-002-click.png',
      screenshotKind: 'viewport',
      riskLevel: 'low',
      requiresConfirmation: false,
      requiresManualReview: false,
      timestamp: new Date('2026-01-01T00:00:01.000Z').toISOString()
    }
  ]
};

const metadata: FlowMetadata = {
  toolVersion: '0.1.0',
  browser: 'Playwright Chromium',
  viewport: { width: 1280, height: 720 },
  platform: 'test',
  screenshotCount: 2,
  containsPassword: false,
  containsCookies: false
};

test('writeFlowPackage creates a validated zip package', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autochar-export-'));
  const shots = path.join(dir, 'shots');
  fs.mkdirSync(shots);
  fs.writeFileSync(path.join(shots, 'step-001-start.png'), 'png');
  fs.writeFileSync(path.join(shots, 'step-002-click.png'), 'png');

  const zipPath = await writeFlowPackage({
    flow,
    metadata,
    notes: 'test notes',
    reviewMarkdown: '# Review\n\n- Step count: 2\n',
    screenshotsDir: shots,
    outputDir: dir,
    packageName: 'export-flow'
  });

  expect(fs.existsSync(zipPath)).toBe(true);
  const zip = new AdmZip(zipPath);
  expect(zip.getEntry('review.md')?.getData().toString('utf8')).toContain('# Review');
});
