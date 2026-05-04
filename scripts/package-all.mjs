import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function run(script) {
  const result = spawnSync('node', [script], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function exes(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((file) => file.endsWith('.exe')).map((file) => path.join(dir, file));
}

run('scripts/package-user.mjs');
run('scripts/package-owner.mjs');

console.log('Packaged EXE files:');
for (const exe of [...exes(path.join(process.cwd(), 'release', 'user')), ...exes(path.join(process.cwd(), 'release', 'owner'))]) {
  console.log(exe);
}
