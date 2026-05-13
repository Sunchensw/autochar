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
run('npm', ['run', 'build', '-w', '@autochar/recorder-core']);
run('npm', ['run', 'build', '-w', '@autochar/recorder']);
run('npm', ['run', 'dist:setup', '-w', '@autochar/recorder']);
run('npm', ['run', 'dist:portable', '-w', '@autochar/recorder']);

const outputDir = path.join(process.cwd(), 'release', 'user');
const exes = findExe(outputDir, 'Autochar-Recorder');
if (!exes.length) {
  console.error(`No Autochar Recorder EXE found in ${outputDir}`);
  process.exit(1);
}

console.log('Autochar Recorder EXE files:');
for (const exe of exes) {
  console.log(exe);
}
