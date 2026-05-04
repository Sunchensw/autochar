import path from 'node:path';
import fs from 'node:fs/promises';
import * as XLSX from 'xlsx';

export async function readRows(filePath: string): Promise<Record<string, string>[]> {
  const ext = path.extname(filePath).toLowerCase();
  if (!['.csv', '.xlsx'].includes(ext)) {
    throw new Error('Input file must be .csv or .xlsx');
  }
  const workbook =
    ext === '.csv'
      ? XLSX.read(await fs.readFile(filePath, 'utf8'), { type: 'string', raw: false })
      : XLSX.readFile(filePath, { raw: false });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) {
    return [];
  }
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[firstSheet], {
    defval: '',
    raw: false
  });
  return rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value == null ? '' : String(value)]))
  );
}
