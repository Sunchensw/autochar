import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { Page } from 'playwright';
import { detectManualIntervention } from '@autochar/shared';

export async function pageNeedsManualIntervention(page: Page): Promise<boolean> {
  const bodyText = await page.locator('body').innerText({ timeout: 1000 }).catch(() => '');
  return detectManualIntervention(bodyText);
}

export async function waitForManualResume(message: string): Promise<void> {
  const rl = readline.createInterface({ input, output });
  await rl.question(`${message}\n请人工处理后按 Enter 继续...`);
  rl.close();
}
