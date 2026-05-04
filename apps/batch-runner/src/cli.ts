import path from 'node:path';
import { runBatch } from './run-batch';

function value(args: string[], key: string): string | undefined {
  const index = args.indexOf(key);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const baseDir = process.env.INIT_CWD ?? process.cwd();
  const resolveUserPath = (inputPath: string) => path.isAbsolute(inputPath) ? inputPath : path.join(baseDir, inputPath);
  const scriptArg = value(args, '--script');
  const inputArg = value(args, '--input');
  const out = resolveUserPath(value(args, '--out') ?? path.join('results', 'result.csv'));
  const functionName = value(args, '--function') ?? 'runAutocharFlow';
  const maxRows = value(args, '--max-rows');
  const startRow = value(args, '--start-row');
  const dryRun = args.includes('--dry-run');
  const failFast = args.includes('--fail-fast');

  if (!scriptArg) throw new Error('Missing --script <file.mjs>');
  if (path.extname(scriptArg) !== '.mjs') {
    throw new Error('Batch runner only accepts .mjs scripts. Use converter to generate .mjs before running.');
  }
  if (!inputArg) throw new Error('Missing --input <file.csv|file.xlsx>');

  const script = resolveUserPath(scriptArg);
  const input = resolveUserPath(inputArg);

  const results = await runBatch({
    scriptPath: script,
    functionName,
    inputPath: input,
    out,
    dryRun,
    failFast,
    maxRows: maxRows ? Number(maxRows) : undefined,
    startRow: startRow ? Number(startRow) : undefined
  });

  console.log(`Wrote ${results.length} result rows to ${out}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
