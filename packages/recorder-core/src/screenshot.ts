import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';

export interface PageScreenshotState {
  url: string;
  title: string;
  scrollX: number;
  scrollY: number;
  navigationRevision: number;
}

export interface CapturePageScreenshotOptions {
  page: Pick<Page, 'screenshot'>;
  screenshotsDir: string;
  fileName: string;
  fullPage?: boolean;
}

export function buildStepScreenshotName(stepId: string): string {
  if (stepId === 'final') {
    return 'final.png';
  }
  return `${stepId}.png`;
}

export async function capturePageScreenshot(options: CapturePageScreenshotOptions): Promise<string> {
  await fs.mkdir(options.screenshotsDir, { recursive: true });
  const output = path.join(options.screenshotsDir, options.fileName);
  await options.page.screenshot({
    path: output,
    fullPage: options.fullPage ?? false
  });
  return output;
}

export function shouldCapturePageStateScreenshot(
  previous: PageScreenshotState | undefined,
  next: PageScreenshotState
): boolean {
  if (!previous) {
    return true;
  }
  return (
    previous.url !== next.url ||
    previous.title !== next.title ||
    previous.scrollX !== next.scrollX ||
    previous.scrollY !== next.scrollY ||
    previous.navigationRevision !== next.navigationRevision
  );
}
