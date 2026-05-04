import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function findExe(dir, needle) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith('.exe') && file.includes(needle))
    .map((file) => path.join(dir, file));
}

run('node', ['scripts/ensure-playwright-browsers.mjs']);
run('npm', ['run', 'build', '-w', '@autochar/shared']);
run('npm', ['run', 'build', '-w', '@autochar/flow-converter']);
run('npm', ['run', 'build', '-w', '@autochar/batch-runner']);
run('npm', ['run', 'build', '-w', '@autochar/operator-console']);
run('npm', ['run', 'dist:setup', '-w', '@autochar/operator-console']);
run('npm', ['run', 'dist:portable', '-w', '@autochar/operator-console']);

const outputDir = path.join(process.cwd(), 'release', 'owner');
const exes = findExe(outputDir, 'Autochar-Operator-Console');
if (!exes.length) {
  console.error(`No Autochar Operator Console EXE found in ${outputDir}`);
  process.exit(1);
}

console.log('Autochar Operator Console EXE files:');
for (const exe of exes) {
  console.log(exe);
}
