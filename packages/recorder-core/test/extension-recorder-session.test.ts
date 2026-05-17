import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { validateBasicFlow } from '@autochar/shared';
import { ExtensionRecorderSession } from '../src';

const onePixelPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

function tempDir(name: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name));
}

describe('ExtensionRecorderSession', () => {
  test('records the first extension action as a start step plus interaction step', async () => {
    const workDir = tempDir('autochar-extension-session-');
    const session = new ExtensionRecorderSession({ workDir });

    await session.startRecording();
    await session.receiveEvent({
      type: 'click',
      label: 'Search',
      element: { tagName: 'BUTTON', role: 'button', text: 'Search', id: 'searchButton' },
      url: 'https://shop.jd.com/admin/products',
      title: 'JD Products',
      timestamp: '2026-05-08T10:00:00.000Z',
      screenshotDataUrl: onePixelPng,
      viewport: { width: 1440, height: 900 }
    });

    const flow = await session.stopRecording();
    expect(flow.startUrl).toBe('https://shop.jd.com/admin/products');
    expect(flow.steps).toHaveLength(2);
    expect(flow.steps[0]).toMatchObject({
      id: 'step-001',
      type: 'goto',
      screenshot: 'screenshots/step-001-start.png'
    });
    expect(flow.steps[1]).toMatchObject({
      id: 'step-002',
      type: 'click',
      label: 'Search',
      screenshot: 'screenshots/step-002-click.png',
      selectors: {
        primary: { kind: 'role', value: 'button', role: 'button', name: 'Search' }
      }
    });
    expect(fs.existsSync(path.join(workDir, 'screenshots', 'step-001-start.png'))).toBe(true);
    expect(fs.existsSync(path.join(workDir, 'screenshots', 'step-002-click.png'))).toBe(true);
    expect(validateBasicFlow({ flow, packageDir: workDir }).ok).toBe(true);
    expect(session.getState()).toMatchObject({
      isOpen: true,
      isRecording: false,
      stepCount: 2,
      screenshotCount: 2,
      lastAction: 'click'
    });
  });

  test('masks sensitive extension fill values before storing steps', async () => {
    const workDir = tempDir('autochar-extension-sensitive-');
    const session = new ExtensionRecorderSession({ workDir });

    await session.startRecording();
    await session.receiveEvent({
      type: 'fill',
      label: 'Password',
      value: 'super-secret-password',
      element: { tagName: 'INPUT', type: 'password', name: 'password', label: 'Password' },
      url: 'https://shop.jd.com/login',
      title: 'Login',
      timestamp: '2026-05-08T10:01:00.000Z',
      screenshotDataUrl: onePixelPng
    });

    const flow = await session.stopRecording();
    expect(flow.steps[1]).toMatchObject({
      type: 'fill',
      value: '************',
      valuePolicy: 'masked',
      sensitive: true
    });
  });

  test('does not mark non-sensitive asterisk values as masked', async () => {
    const workDir = tempDir('autochar-extension-asterisk-');
    const session = new ExtensionRecorderSession({ workDir });

    await session.startRecording();
    await session.receiveEvent({
      type: 'fill',
      label: 'Product title',
      value: '2* pack',
      element: { tagName: 'INPUT', name: 'title', placeholder: 'Product title' },
      url: 'https://shop.jd.com/admin/products/123/edit',
      title: 'Edit Product',
      timestamp: '2026-05-08T10:01:30.000Z',
      screenshotDataUrl: onePixelPng
    });

    const flow = await session.stopRecording();
    expect(flow.steps[1]).toMatchObject({
      type: 'fill',
      value: '2* pack',
      valuePolicy: 'plain',
      sensitive: false
    });
  });

  test('records extension navigation events once per page state', async () => {
    const workDir = tempDir('autochar-extension-navigation-');
    const session = new ExtensionRecorderSession({ workDir });

    await session.startRecording();
    await session.receiveEvent({
      type: 'navigation',
      label: 'Page loaded',
      element: { tagName: 'HTML' },
      url: 'https://shop.jd.com/admin/products',
      title: 'Products',
      timestamp: '2026-05-08T10:02:00.000Z',
      screenshotDataUrl: onePixelPng
    });
    await session.receiveEvent({
      type: 'navigation',
      label: 'Page loaded',
      element: { tagName: 'HTML' },
      url: 'https://shop.jd.com/admin/products',
      title: 'Products',
      timestamp: '2026-05-08T10:02:01.000Z',
      screenshotDataUrl: onePixelPng
    });
    await session.receiveEvent({
      type: 'navigation',
      label: 'Page changed',
      element: { tagName: 'HTML' },
      url: 'https://shop.jd.com/admin/products/123/edit',
      title: 'Edit Product',
      timestamp: '2026-05-08T10:02:02.000Z',
      screenshotDataUrl: onePixelPng
    });

    const flow = await session.stopRecording();
    expect(flow.steps.map((step) => step.type)).toEqual(['goto', 'navigation']);
    expect(flow.steps[1]).toMatchObject({
      id: 'step-002',
      type: 'navigation',
      value: 'https://shop.jd.com/admin/products/123/edit'
    });
  });

  test('exports extension recordings as a single AI operation Markdown document', async () => {
    const workDir = tempDir('autochar-extension-export-work-');
    const outputDir = tempDir('autochar-extension-export-out-');
    const session = new ExtensionRecorderSession({ workDir });

    await session.startRecording();
    await session.receiveEvent({
      type: 'click',
      label: 'Search',
      element: { tagName: 'BUTTON', role: 'button', text: 'Search' },
      url: 'https://shop.jd.com/admin/products',
      title: 'JD Products',
      timestamp: '2026-05-08T10:03:00.000Z',
      screenshotDataUrl: onePixelPng
    });
    await session.stopRecording();

    const documentPath = await session.exportRecording({
      name: 'JD extension recording',
      notes: 'Recorded from user browser.',
      outputDir
    });

    expect(fs.existsSync(documentPath)).toBe(true);
    expect(documentPath.endsWith('.autochar.md')).toBe(true);
    expect(fs.readdirSync(outputDir)).toEqual(['JD-extension-recording.autochar.md']);
    const markdown = fs.readFileSync(documentPath, 'utf8');
    expect(markdown).toContain('# Autochar AI Operation Document');
    expect(markdown).toContain('User browser extension');
    expect(markdown).toContain('JD extension recording');
  });

  test('exports extension recordings as an e-commerce material package', async () => {
    const workDir = tempDir('autochar-extension-material-work-');
    const outputDir = tempDir('autochar-extension-material-out-');
    const session = new ExtensionRecorderSession({ workDir });

    await session.startRecording();
    await session.receiveEvent({
      type: 'navigation',
      label: 'Page loaded',
      element: { tagName: 'HTML' },
      url: 'https://vis.vip.com/index.php#/app-i/pdc-admin/admin#/product/add',
      title: 'Vip product',
      timestamp: '2026-05-16T10:03:00.000Z',
      screenshotDataUrl: onePixelPng,
      pageContext: {
        summaryText: '商品分类 商品标题 保存',
        interactables: [
          {
            tagName: 'DIV',
            role: 'combobox',
            label: '商品分类',
            cascaderPaths: [['珠宝首饰', '饰品', '项链']]
          },
          {
            tagName: 'BUTTON',
            role: 'button',
            text: '保存'
          }
        ],
        forms: [
          {
            label: '商品资料',
            fields: [{ tagName: 'INPUT', type: 'text', label: '商品标题', name: 'title' }]
          }
        ],
        tables: [],
        warnings: []
      }
    });
    await session.stopRecording();

    const result = await session.exportMaterialPackage({
      name: 'VIP material',
      notes: 'Generate code later.',
      outputDir
    });

    expect(fs.existsSync(result.markdownPath)).toBe(true);
    expect(fs.existsSync(result.dictionaryPath)).toBe(true);
    expect(fs.existsSync(result.workbookPath)).toBe(true);
    expect(session.getState().materialPackagePath).toBe(result.outputDir);
    expect(fs.readdirSync(result.outputDir).sort()).toEqual(['field-dictionary.json', '字段模板.xlsx', '流程说明.md']);
  });
});
