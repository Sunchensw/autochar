import fs from 'node:fs/promises';
import path from 'node:path';
import { parseFlowPackage } from '@autochar/shared';
import { compileGeneratedScript, generatePlaywrightScript } from './generate-playwright';

function getArg(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const baseDir = process.env.INIT_CWD ?? process.cwd();
  const resolveUserPath = (value: string) => path.isAbsolute(value) ? value : path.join(baseDir, value);
  const flowPathArg = getArg(args, '--flow');
  const outPath = resolveUserPath(getArg(args, '--out') ?? path.join('generated', 'autochar-flow.ts'));
  const compiledOut = resolveUserPath(getArg(args, '--compiled-out') ?? outPath.replace(/\.ts$/, '.mjs'));
  const functionName = getArg(args, '--function') ?? 'runAutocharFlow';

  if (!flowPathArg) {
    throw new Error('Missing --flow <flow.json>');
  }

  const flowPath = resolveUserPath(flowPathArg);
  const flow = parseFlowPackage(JSON.parse(await fs.readFile(flowPath, 'utf8')));
  const source = generatePlaywrightScript(flow, { functionName });
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, source, 'utf8');
  await compileGeneratedScript({ inputPath: outPath, outputPath: compiledOut });

  console.log(`Generated TypeScript: ${outPath}`);
  console.log(`Generated executable module: ${compiledOut}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
