import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { expect, test } from 'vitest';
import { readRows } from '../src';

test('reads CSV rows', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autochar-csv-'));
  const file = path.join(dir, 'input.csv');
  fs.writeFileSync(file, 'sku,newTitle\n10001,春季新品标题\n');

  await expect(readRows(file)).resolves.toEqual([{ sku: '10001', newTitle: '春季新品标题' }]);
});

test('reads XLSX rows', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autochar-xlsx-'));
  const file = path.join(dir, 'input.xlsx');
  const worksheet = XLSX.utils.json_to_sheet([{ sku: '10002', newTitle: '夏季新品标题' }]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Rows');
  XLSX.writeFile(workbook, file);

  await expect(readRows(file)).resolves.toEqual([{ sku: '10002', newTitle: '夏季新品标题' }]);
});
