import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import AdmZip from 'adm-zip';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { compileGeneratedScript, generatePlaywrightScript } from '@autochar/flow-converter';
import { parseFlowPackage, validateBasicFlow, type FlowPackage } from '@autochar/shared';

process.env.PLAYWRIGHT_BROWSERS_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'ms-playwright')
  : path.resolve(process.cwd(), 'ms-playwright');

let mainWindow: BrowserWindow | undefined;
let currentFlow: FlowPackage | undefined;
let currentPackageDir: string | undefined;
let currentScript: { tsPath: string; mjsPath: string; functionName: string } | undefined;
let currentInputPath: string | undefined;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 1060,
    minHeight: 720,
    title: 'Autochar Operator Console',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'ui', 'index.html'));
}

function slug(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[^\w]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'autochar-flow';
}

function functionNameFor(flow: FlowPackage): string {
  if (flow.name.toLowerCase().includes('product title')) {
    return 'updateProductTitle';
  }
  const words = flow.name.replace(/[^\w]+/g, ' ').trim().split(/\s+/);
  const [first = 'run', ...rest] = words;
  return `${first.charAt(0).toLowerCase()}${first.slice(1)}${rest
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join('')}`;
}

async function existingDir(candidate: string): Promise<string | undefined> {
  const stat = await fs.stat(candidate).catch(() => undefined);
  return stat?.isDirectory() ? candidate : undefined;
}

async function readFlowFromSelection(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.zip' || ext === '.flow.zip') {
    const packageDir = path.join(app.getPath('userData'), 'imported', `${Date.now()}-${path.basename(filePath, ext)}`);
    await fs.mkdir(packageDir, { recursive: true });
    new AdmZip(filePath).extractAllTo(packageDir, true);
    const flow = parseFlowPackage(JSON.parse(await fs.readFile(path.join(packageDir, 'flow.json'), 'utf8')));
    return { flow, packageDir };
  }
  const flow = parseFlowPackage(JSON.parse(await fs.readFile(filePath, 'utf8')));
  const dir = path.dirname(filePath);
  const sameDirPackage = (await existingDir(path.join(dir, 'screenshots'))) ? dir : undefined;
  return { flow, packageDir: sameDirPackage };
}

function summarize(flow: FlowPackage, packageDir?: string) {
  const validation = validateBasicFlow({ flow, packageDir });
  const steps = flow.steps.map((step) => {
    const screenshotPath = packageDir && step.screenshot ? path.join(packageDir, step.screenshot) : '';
    return {
      id: step.id,
      type: step.type,
      label: step.label,
      selector: step.selectors?.primary ? `${step.selectors.primary.kind}: ${step.selectors.primary.value}` : '',
      sensitive: step.sensitive,
      highRisk: step.riskLevel === 'high' || step.requiresConfirmation,
      screenshotUrl: screenshotPath ? pathToFileURL(screenshotPath).href : '',
      screenshotPath
    };
  });
  return {
    flowName: flow.name,
    validation,
    steps,
    highRiskCount: steps.filter((step) => step.highRisk).length,
    sensitiveCount: steps.filter((step) => step.sensitive).length
  };
}

ipcMain.handle('owner:import-flow', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: '导入 flow package 或 flow.json',
    filters: [
      { name: 'Flow Package', extensions: ['flow.zip', 'zip', 'json'] }
    ],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths[0]) return undefined;
  const imported = await readFlowFromSelection(result.filePaths[0]);
  currentFlow = imported.flow;
  currentPackageDir = imported.packageDir;
  currentScript = undefined;
  return summarize(imported.flow, imported.packageDir);
});

ipcMain.handle('owner:validate-flow', async () => {
  if (!currentFlow) throw new Error('No flow imported.');
  return validateBasicFlow({ flow: currentFlow, packageDir: currentPackageDir });
});

ipcMain.handle('owner:generate-script', async () => {
  if (!currentFlow) throw new Error('No flow imported.');
  const validation = validateBasicFlow({ flow: currentFlow, packageDir: currentPackageDir });
  if (!validation.ok) {
    throw new Error(`Flow validation failed:\n${validation.errors.join('\n')}`);
  }
  const generatedDir = app.isPackaged
    ? path.join(app.getPath('userData'), 'generated')
    : path.resolve('generated');
  await fs.mkdir(generatedDir, { recursive: true });
  const name = slug(currentFlow.name);
  const functionName = functionNameFor(currentFlow);
  const tsPath = path.join(generatedDir, `${name}.ts`);
  const mjsPath = path.join(generatedDir, `${name}.mjs`);
  await fs.writeFile(tsPath, generatePlaywrightScript(currentFlow, { functionName }), 'utf8');
  await compileGeneratedScript({ inputPath: tsPath, outputPath: mjsPath });
  currentScript = { tsPath, mjsPath, functionName };
  return currentScript;
});

ipcMain.handle('owner:select-input', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: '选择 CSV/XLSX 数据文件',
    filters: [{ name: 'Data', extensions: ['csv', 'xlsx'] }],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths[0]) return undefined;
  currentInputPath = result.filePaths[0];
  return currentInputPath;
});

ipcMain.handle('owner:run-dry-run', async (_event, options: { maxRows: number; startRow: number; failFast: boolean }) => {
  if (!currentScript || !currentInputPath) throw new Error('Generate a script and select input first.');
  const { runBatch } = await import('@autochar/batch-runner');
  const out = path.join(app.isPackaged ? app.getPath('userData') : process.cwd(), 'results', 'result.csv');
  return runBatch({
    scriptPath: currentScript.mjsPath,
    functionName: currentScript.functionName,
    inputPath: currentInputPath,
    out,
    dryRun: true,
    maxRows: options.maxRows || 3,
    startRow: options.startRow || 1,
    failFast: options.failFast
  });
});

ipcMain.handle('owner:run-batch', async (_event, options: { maxRows: number; startRow: number; failFast: boolean; confirmed: boolean }) => {
  if (!options.confirmed) throw new Error('Formal execution requires confirmation.');
  if (!currentScript || !currentInputPath) throw new Error('Generate a script and select input first.');
  const { runBatch } = await import('@autochar/batch-runner');
  const out = path.join(app.isPackaged ? app.getPath('userData') : process.cwd(), 'results', 'result.csv');
  return runBatch({
    scriptPath: currentScript.mjsPath,
    functionName: currentScript.functionName,
    inputPath: currentInputPath,
    out,
    dryRun: false,
    maxRows: options.maxRows || 3,
    startRow: options.startRow || 1,
    failFast: options.failFast
  });
});

ipcMain.handle('owner:open-result', async () => {
  const result = path.join(app.isPackaged ? app.getPath('userData') : process.cwd(), 'results', 'result.csv');
  await shell.openPath(result);
});

ipcMain.handle('owner:open-screenshot', async (_event, screenshotPath: string) => {
  if (screenshotPath) await shell.openPath(screenshotPath);
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
