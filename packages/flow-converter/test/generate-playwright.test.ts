import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { compileGeneratedScript, generatePlaywrightScript } from '../src';
import { parseFlowPackage } from '@autochar/shared';

test('generates Playwright TypeScript and compiles to mjs', async () => {
  const flowPath = path.resolve('examples/product-title-flow.json');
  const flow = parseFlowPackage(JSON.parse(await fs.readFile(flowPath, 'utf8')));
  const source = generatePlaywrightScript(flow, { functionName: 'updateProductTitle' });

  expect(source).toContain('updateProductTitle');
  expect(source).toContain("page.getByPlaceholder('请输入商品名称')");
  expect(source).toContain('MANUAL REVIEW');

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'autochar-converter-'));
  const inputPath = path.join(dir, 'product-title-update.ts');
  const outputPath = path.join(dir, 'product-title-update.mjs');
  await fs.writeFile(inputPath, source, 'utf8');

  await compileGeneratedScript({ inputPath, outputPath });

  await expect(fs.access(outputPath)).resolves.toBeUndefined();
});

test('generates frame locators for iframe steps', async () => {
  const flowPath = path.resolve('examples/product-title-flow.json');
  const flow = parseFlowPackage(JSON.parse(await fs.readFile(flowPath, 'utf8')));
  const frameFlow = {
    ...flow,
    steps: [
      {
        ...flow.steps[1],
        type: 'click' as const,
        value: undefined,
        variable: undefined,
        framePath: ['iframe#product-editor'],
        selectors: {
          primary: { kind: 'css' as const, value: 'button.save' },
          fallbacks: [{ kind: 'text' as const, value: 'Save' }]
        }
      }
    ]
  };

  const source = generatePlaywrightScript(frameFlow, { functionName: 'saveInsideFrame' });

  expect(source).toContain("page.frameLocator('iframe#product-editor').locator('button.save').click()");
});
