import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  buildMaterialMarkdown,
  buildMaterialPackage,
  writeMaterialPackage
} from '../src';
import type { FlowPackage } from '@autochar/shared';

const flow: FlowPackage = {
  schemaVersion: '1.0.0',
  name: 'Vip product listing',
  startUrl: 'https://vis.vip.com/index.php#/app-i/pdc-admin/admin#/product/add',
  createdAt: '2026-05-16T00:00:00.000Z',
  steps: [
    {
      id: 'step-001',
      order: 1,
      type: 'goto',
      label: 'Open create product page',
      url: 'https://vis.vip.com/index.php#/app-i/pdc-admin/admin#/product/add',
      title: '唯品会供应商平台',
      valuePolicy: 'notStored',
      sensitive: false,
      screenshot: 'screenshots/step-001-start.png',
      screenshotKind: 'viewport',
      riskLevel: 'low',
      requiresConfirmation: false,
      requiresManualReview: false,
      timestamp: '2026-05-16T00:00:00.000Z',
      pageContext: {
        summaryText: '商品分类 商品属性 保存 保存并提交审核',
        interactables: [
          {
            tagName: 'DIV',
            role: 'combobox',
            label: '商品分类',
            text: '请选择分类',
            area: '商品分类',
            selector: '.category-cascader',
            cascaderPaths: [
              ['珠宝首饰', '珠宝首饰', '黄金吊坠/项链计价类'],
              ['珠宝首饰', '珠宝首饰', '黄金戒指计价类'],
              ['珠宝首饰', '饰品', '项链'],
              ['珠宝首饰', '饰品', '耳饰']
            ]
          },
          {
            tagName: 'BUTTON',
            role: 'button',
            text: '保存',
            selector: 'button.save'
          },
          {
            tagName: 'BUTTON',
            role: 'button',
            text: '保存并提交审核',
            selector: 'button.submit'
          }
        ],
        forms: [
          {
            label: '商品属性',
            fields: [
              {
                tagName: 'INPUT',
                type: 'text',
                label: '商品标题',
                name: 'title',
                selector: 'input[name="title"]',
                nearbyText: '* 商品标题 属性必填'
              },
              {
                tagName: 'INPUT',
                type: 'password',
                label: '后台密码',
                name: 'password',
                selector: 'input[name="password"]'
              },
              {
                tagName: 'SELECT',
                label: '主工艺',
                role: 'combobox',
                selector: 'select[name="craft"]',
                options: [
                  { label: '足金', value: 'gold' },
                  { label: '镶嵌', value: 'inlay' }
                ]
              },
              {
                tagName: 'INPUT',
                type: 'file',
                label: '商品图片',
                selector: 'input[type="file"]'
              }
            ]
          }
        ],
        tables: [],
        warnings: []
      }
    },
    {
      id: 'step-002',
      order: 2,
      type: 'fill',
      label: '商品标题',
      url: 'https://vis.vip.com/index.php#/app-i/pdc-admin/admin#/product/add',
      title: '唯品会供应商平台',
      value: '{{商品标题}}',
      variable: '商品标题',
      valuePolicy: 'plain',
      sensitive: false,
      selectors: {
        primary: { kind: 'label', value: '商品标题' },
        fallbacks: [{ kind: 'css', value: 'input[name="title"]' }]
      },
      element: {
        tagName: 'INPUT',
        label: '商品标题',
        name: 'title',
        area: '商品属性'
      },
      screenshot: 'screenshots/step-002-fill.png',
      screenshotKind: 'viewport',
      riskLevel: 'low',
      requiresConfirmation: false,
      requiresManualReview: false,
      timestamp: '2026-05-16T00:00:01.000Z'
    }
  ]
};

describe('e-commerce material package', () => {
  test('turns page fields into Excel columns and keeps buttons as process steps', () => {
    const material = buildMaterialPackage({ flow });

    expect(material.fields.map((field) => field.column)).toEqual([
      '一级分类',
      '二级分类',
      '三级分类',
      '商品标题',
      '主工艺',
      '商品图片'
    ]);
    expect(material.fields.find((field) => field.column === '二级分类')?.dependsOn).toEqual(['一级分类']);
    expect(material.fields.find((field) => field.column === '三级分类')?.dependsOn).toEqual(['一级分类', '二级分类']);
    expect(material.fields.some((field) => field.column === '后台密码')).toBe(false);
    expect(material.fields.some((field) => field.column === '保存')).toBe(false);
    expect(material.processSteps.map((step) => step.label)).toContain('保存');
    expect(material.processSteps.map((step) => step.label)).toContain('保存并提交审核');
  });

  test('writes workflow Markdown, field dictionary JSON, and linked-dropdown Excel template', async () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autochar-material-package-'));

    const result = await writeMaterialPackage({
      flow,
      outputDir,
      documentName: 'Vip product listing',
      notes: 'Generate code from this package later.'
    });

    expect(path.basename(result.markdownPath)).toBe('流程说明.md');
    expect(path.basename(result.dictionaryPath)).toBe('field-dictionary.json');
    expect(path.basename(result.workbookPath)).toBe('字段模板.xlsx');
    expect(fs.existsSync(result.markdownPath)).toBe(true);
    expect(fs.existsSync(result.dictionaryPath)).toBe(true);
    expect(fs.existsSync(result.workbookPath)).toBe(true);

    const dictionary = JSON.parse(fs.readFileSync(result.dictionaryPath, 'utf8'));
    expect(dictionary.fields.map((field: { column: string }) => field.column)).toContain('三级分类');
    expect(dictionary.fields.find((field: { column: string }) => field.column === '三级分类').dependsOn).toEqual([
      '一级分类',
      '二级分类'
    ]);

    const markdown = fs.readFileSync(result.markdownPath, 'utf8');
    expect(markdown).toContain('# 电商后台自动化材料包');
    expect(markdown).toContain('Excel 字段');
    expect(markdown).toContain('保存并提交审核');

    const xlsxText = fs.readFileSync(result.workbookPath).toString('utf8');
    expect(xlsxText).toContain('字段模板');
    expect(xlsxText).toContain('选项库');
    expect(xlsxText).toContain('state="hidden"');
    expect(xlsxText).toContain('dataValidations');
    expect(xlsxText).toContain('INDIRECT');
    expect(xlsxText).toContain('<formula1>INDIRECT($G2)</formula1>');
    expect(xlsxText).toContain('<formula1>INDIRECT($H2)</formula1>');
    expect(xlsxText).toContain('<definedName name="opt_l3_12kq1jx">&apos;字段模板&apos;!');
    expect(xlsxText).toContain('fullCalcOnLoad="1"');
    expect(xlsxText).toContain('一级分类_选项');
    expect(xlsxText).toContain('黄金吊坠/项链计价类');
  });

  test('builds process text that tells future AI code to use Excel fields', () => {
    const markdown = buildMaterialMarkdown(buildMaterialPackage({ flow }));

    expect(markdown).toContain('字段值来自 `字段模板.xlsx`');
    expect(markdown).toContain('一级分类 -> 二级分类 -> 三级分类');
    expect(markdown).toContain('不要把保存、提交、删除、审核按钮当作 Excel 数据列');
  });
});
