import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { parseFlowPackage, validateBasicFlow, type FlowPackage } from '../src';

function validFlow(): FlowPackage {
  return {
    schemaVersion: '1.0.0',
    name: 'Product title update',
    startUrl: 'http://localhost:4173',
    createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    steps: [
      {
        id: 'step-001',
        order: 1,
        type: 'goto',
        label: '打开商品列表页',
        url: 'http://localhost:4173',
        title: 'Autochar Demo Admin',
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
        type: 'fill',
        label: '输入商品关键词',
        url: 'http://localhost:4173',
        title: 'Autochar Demo Admin',
        value: '{{sku}}',
        variable: 'sku',
        valuePolicy: 'plain',
        sensitive: false,
        selectors: {
          primary: { kind: 'placeholder', value: '请输入商品名称', uniqueAtRecordTime: true, countAtRecordTime: 1 },
          fallbacks: [{ kind: 'css', value: 'input[name="sku"]' }]
        },
        element: { tagName: 'INPUT', name: 'sku', placeholder: '请输入商品名称' },
        screenshot: 'screenshots/step-002-fill.png',
        screenshotKind: 'viewport',
        riskLevel: 'low',
        requiresConfirmation: false,
        requiresManualReview: false,
        timestamp: new Date('2026-01-01T00:00:01.000Z').toISOString()
      }
    ]
  };
}

test('valid flow parses', () => {
  expect(parseFlowPackage(validFlow()).name).toBe('Product title update');
});

test('missing schemaVersion or steps fails schema validation', () => {
  expect(() => parseFlowPackage({ name: 'missing', steps: [] })).toThrow();
  expect(() => parseFlowPackage({ schemaVersion: '1', name: 'missing' })).toThrow();
});

test('validateBasicFlow accepts complete screenshots and selectors', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autochar-flow-'));
  fs.mkdirSync(path.join(dir, 'screenshots'));
  fs.writeFileSync(path.join(dir, 'screenshots', 'step-001-start.png'), 'png');
  fs.writeFileSync(path.join(dir, 'screenshots', 'step-002-fill.png'), 'png');

  const result = validateBasicFlow({ flow: validFlow(), packageDir: dir });

  expect(result.ok).toBe(true);
  expect(result.errors).toEqual([]);
});

test('validateBasicFlow reports missing screenshot, fallback selector, and sensitive plain text', () => {
  const flow = validFlow();
  flow.steps[1] = {
    ...flow.steps[1],
    sensitive: true,
    valuePolicy: 'plain',
    selectors: {
      primary: { kind: 'id', value: 'password' },
      fallbacks: []
    },
    element: { type: 'password', name: 'password' },
    screenshot: undefined
  };

  const result = validateBasicFlow({ flow });

  expect(result.ok).toBe(false);
  expect(result.errors.join('\n')).toContain('missing a screenshot');
  expect(result.errors.join('\n')).toContain('missing a fallback selector');
  expect(result.errors.join('\n')).toContain('valuePolicy plain');
});
