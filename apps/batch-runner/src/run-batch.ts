import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { pageNeedsManualIntervention, waitForManualResume } from './manual-intervention';
import { readRows } from './read-input';
import { writeCsvResults, type BatchResult } from './write-result';

export type BatchScriptFunction = (
  page: Page,
  row: Record<string, string>,
  context: { rowIndex: number; dryRun: boolean; outputDir: string }
) => Promise<void>;

export interface BatchRunOptions {
  scriptPath?: string;
  functionName?: string;
  inputPath?: string;
  rows?: Record<string, string>[];
  out?: string;
  dryRun?: boolean;
  maxRows?: number;
  startRow?: number;
  failFast?: boolean;
  outputDir?: string;
  scriptFunction?: BatchScriptFunction;
}

async function loadScriptFunction(options: BatchRunOptions): Promise<BatchScriptFunction> {
  if (options.scriptFunction) {
    return options.scriptFunction;
  }
  if (!options.scriptPath) {
    throw new Error('Missing scriptPath.');
  }
  if (path.extname(options.scriptPath) !== '.mjs') {
    throw new Error('Batch runner only accepts .mjs scripts. Use flow-converter to generate a .mjs file first.');
  }
  const module = await import(pathToFileURL(path.resolve(options.scriptPath)).href);
  const fn = module[options.functionName ?? 'runAutocharFlow'];
  if (typeof fn !== 'function') {
    throw new Error(`Function ${options.functionName ?? 'runAutocharFlow'} was not exported by ${options.scriptPath}.`);
  }
  return fn as BatchScriptFunction;
}

function selectRows(rows: Record<string, string>[], startRow = 1, maxRows?: number) {
  const startIndex = Math.max(0, startRow - 1);
  return rows.slice(startIndex, maxRows ? startIndex + maxRows : undefined).map((row, index) => ({
    row,
    rowNumber: startIndex + index + 1
  }));
}

async function screenshotFailure(page: Page | undefined, outputDir: string, rowNumber: number): Promise<string> {
  if (!page) return '';
  const screenshotDir = path.join(outputDir, 'screenshots');
  await fs.mkdir(screenshotDir, { recursive: true });
  const screenshot = path.join(screenshotDir, `row-${String(rowNumber).padStart(3, '0')}-error.png`);
  await page.screenshot({ path: screenshot }).catch(() => undefined);
  return screenshot;
}

export async function runBatch(options: BatchRunOptions): Promise<BatchResult[]> {
  const allRows = options.rows ?? (options.inputPath ? await readRows(options.inputPath) : []);
  const selectedRows = selectRows(allRows, options.startRow ?? 1, options.maxRows);
  const outputDir = options.outputDir ?? path.resolve('results');
  const results: BatchResult[] = [];
  const dryRun = options.dryRun ?? false;
  const shouldLaunchBrowser = !dryRun && !options.scriptFunction;
  const scriptFn = dryRun ? undefined : await loadScriptFunction(options);
  let browser: Browser | undefined;

  if (shouldLaunchBrowser) {
    browser = await chromium.launch({ headless: false });
  }

  try {
    for (const item of selectedRows) {
      const started = Date.now();
      let page: Page | undefined;
      if (dryRun) {
        results.push({
          row: item.rowNumber,
          status: 'dry-run',
          message: 'Skipped script execution in dry-run.',
          currentUrl: '',
          screenshot: '',
          time: new Date().toISOString(),
          durationMs: Date.now() - started
        });
        continue;
      }

      try {
        page = browser ? await browser.newPage() : (undefined as unknown as Page);
        await scriptFn?.(page as Page, item.row, { rowIndex: item.rowNumber, dryRun, outputDir });
        if (browser && page && (await pageNeedsManualIntervention(page))) {
          await waitForManualResume(`Row ${item.rowNumber} requires manual intervention.`);
        }
        results.push({
          row: item.rowNumber,
          status: 'success',
          message: 'OK',
          currentUrl: page && 'url' in page ? page.url() : '',
          screenshot: '',
          time: new Date().toISOString(),
          durationMs: Date.now() - started
        });
      } catch (error) {
        const screenshot = await screenshotFailure(page, outputDir, item.rowNumber);
        results.push({
          row: item.rowNumber,
          status: 'failed',
          message: error instanceof Error ? error.message : String(error),
          currentUrl: page && 'url' in page ? page.url() : '',
          screenshot,
          time: new Date().toISOString(),
          durationMs: Date.now() - started
        });
        if (options.failFast) {
          break;
        }
      } finally {
        await page?.close?.().catch(() => undefined);
      }
    }
  } finally {
    await browser?.close();
  }

  if (options.out) {
    await writeCsvResults(results, options.out);
  }
  return results;
}
