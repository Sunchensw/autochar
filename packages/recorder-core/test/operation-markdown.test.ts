import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { buildOperationMarkdown, writeOperationMarkdown } from '../src';
import type { FlowMetadata, FlowPackage } from '@autochar/shared';

const metadata: FlowMetadata = {
  toolVersion: '0.1.0',
  browser: 'Playwright Chromium',
  viewport: { width: 1280, height: 720 },
  platform: 'test',
  screenshotCount: 2,
  containsPassword: true,
  containsCookies: false
};

const flow: FlowPackage = {
  schemaVersion: '1.0.0',
  name: 'JD Product Update',
  startUrl: 'https://shop.jd.com/admin/products',
  createdAt: '2026-01-01T00:00:00.000Z',
  steps: [
    {
      id: 'step-001',
      order: 1,
      type: 'goto',
      label: 'Open product page',
      url: 'https://shop.jd.com/admin/products',
      title: 'Products',
      valuePolicy: 'notStored',
      sensitive: false,
      screenshot: 'screenshots/step-001-start.png',
      screenshotKind: 'viewport',
      riskLevel: 'low',
      requiresConfirmation: false,
      requiresManualReview: false,
      timestamp: '2026-01-01T00:00:00.000Z',
      pageContext: {
        summaryText: 'Products Search SKU Update title',
        interactables: [
          {
            tagName: 'BUTTON',
            role: 'button',
            label: 'Search',
            text: 'Search',
            selector: 'button#search'
          }
        ],
        forms: [
          {
            name: 'productFilter',
            fields: [
              { label: 'SKU', placeholder: 'SKU', name: 'sku', type: 'text' },
              { label: 'Password', name: 'password', type: 'password' }
            ]
          }
        ],
        tables: [
          {
            caption: 'Product table',
            headers: ['SKU', 'Title'],
            rows: [['10001', 'Old title']]
          }
        ],
        warnings: []
      }
    },
    {
      id: 'step-002',
      order: 2,
      type: 'fill',
      label: 'Product title',
      url: 'https://shop.jd.com/admin/products/10001/edit',
      title: 'Edit Product',
      value: '{{newTitle}}',
      variable: 'newTitle',
      valuePolicy: 'plain',
      sensitive: false,
      selectors: {
        primary: { kind: 'label', value: 'Product title' },
        fallbacks: [
          { kind: 'placeholder', value: 'Product title' },
          { kind: 'name', value: 'title' },
          { kind: 'css', value: 'input[name="title"]' }
        ]
      },
      element: {
        tagName: 'INPUT',
        name: 'title',
        label: 'Product title',
        placeholder: 'Product title',
        nearbyText: 'SKU 10001 Old title',
        rowText: '10001 Old title',
        area: 'Product editor'
      },
      screenshot: 'screenshots/step-002-fill.png',
      screenshotKind: 'viewport',
      riskLevel: 'low',
      requiresConfirmation: false,
      requiresManualReview: false,
      timestamp: '2026-01-01T00:00:01.000Z'
    },
    {
      id: 'step-003',
      order: 3,
      type: 'fill',
      label: 'Password',
      url: 'https://shop.jd.com/login',
      title: 'Login',
      value: 'secret-value',
      valuePolicy: 'masked',
      sensitive: true,
      selectors: {
        primary: { kind: 'label', value: 'Password' },
        fallbacks: [{ kind: 'css', value: 'input[name="password"]' }]
      },
      element: { tagName: 'INPUT', type: 'password', label: 'Password', name: 'password' },
      screenshot: 'screenshots/step-003-fill.png',
      screenshotKind: 'viewport',
      riskLevel: 'medium',
      requiresConfirmation: false,
      requiresManualReview: true,
      timestamp: '2026-01-01T00:00:02.000Z'
    }
  ]
};

describe('Autochar operation Markdown', () => {
  test('builds the fixed AI-friendly document sections', () => {
    const markdown = buildOperationMarkdown({ flow, metadata, notes: 'Recorded from user browser.' });

    expect(markdown).toContain('# Autochar AI Operation Document');
    expect(markdown).toContain('## 基本信息');
    expect(markdown).toContain('## 安全边界');
    expect(markdown).toContain('## 页面结构摘要');
    expect(markdown).toContain('## 操作步骤');
    expect(markdown).toContain('## 变量表');
    expect(markdown).toContain('## 风险与人工介入');
    expect(markdown).toContain('## Structured Data');
  });

  test('describes every step with action, target context, selectors, variables, and review risk', () => {
    const markdown = buildOperationMarkdown({ flow, metadata });

    expect(markdown).toContain('步骤 2');
    expect(markdown).toContain('动作类型: fill');
    expect(markdown).toContain('用户实际动作: Product title');
    expect(markdown).toContain('页面标题: Edit Product');
    expect(markdown).toContain('目标元素: INPUT, label "Product title"');
    expect(markdown).toContain('selector 候选');
    expect(markdown).toContain('{{newTitle}}');
    expect(markdown).toContain('附近文本: SKU 10001 Old title');
    expect(markdown).toContain('所在表格行/页面区域: 10001 Old title / Product editor');
    expect(markdown).toContain('风险等级: low');
    expect(markdown).toContain('人工复核: 否');
  });

  test('does not write sensitive values or browser secrets into Markdown', () => {
    const markdown = buildOperationMarkdown({
      flow,
      metadata,
      notes: 'cookie=abc; token=hidden; localStorage password secret-value'
    });

    expect(markdown).not.toContain('secret-value');
    expect(markdown).not.toContain('cookie=abc');
    expect(markdown).not.toContain('token=hidden');
    expect(markdown).not.toContain('localStorage');
  });

  test('emits parseable structured JSON', () => {
    const markdown = buildOperationMarkdown({ flow, metadata });
    const json = markdown.match(/```json\n([\s\S]*?)\n```/)?.[1];

    expect(json).toBeTruthy();
    expect(() => JSON.parse(json!)).not.toThrow();
    expect(JSON.parse(json!).steps).toHaveLength(3);
  });

  test('writes a single .autochar.md file', async () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autochar-operation-doc-'));

    const filePath = await writeOperationMarkdown({
      flow,
      metadata,
      notes: 'Exported from recorder.',
      outputDir,
      documentName: 'JD Product Update'
    });

    expect(filePath.endsWith('.autochar.md')).toBe(true);
    expect(path.basename(filePath)).toBe('JD-Product-Update.autochar.md');
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readdirSync(outputDir)).toEqual(['JD-Product-Update.autochar.md']);
  });
});
