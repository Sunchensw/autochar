import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const browsersPath = path.join(root, 'ms-playwright');
const env = {
  ...process.env,
  PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT: process.env.PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT ?? '180000',
  PLAYWRIGHT_BROWSERS_PATH: browsersPath
};

const result = spawnSync('npx', ['playwright', 'install', 'chromium', '--no-shell'], {
  cwd: root,
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

if (!fs.existsSync(browsersPath)) {
  console.error(`Expected Playwright browsers at ${browsersPath}`);
  process.exit(1);
}

console.log(`Playwright Chromium installed under ${browsersPath}`);
