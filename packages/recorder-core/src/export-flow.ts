import fs from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import {
  validateBasicFlow,
  type FlowMetadata,
  type FlowPackage
} from '@autochar/shared';

export interface WriteFlowPackageInput {
  flow: FlowPackage;
  metadata: FlowMetadata;
  notes: string;
  reviewMarkdown?: string;
  screenshotsDir: string;
  outputDir: string;
  packageName?: string;
}

async function copyScreenshots(sourceDir: string, targetDir: string) {
  await fs.mkdir(targetDir, { recursive: true });
  const entries = await fs.readdir(sourceDir).catch(() => []);
  for (const entry of entries) {
    if (entry.toLowerCase().endsWith('.png')) {
      await fs.copyFile(path.join(sourceDir, entry), path.join(targetDir, entry));
    }
  }
}

export async function zipFlowPackage(packageDir: string): Promise<string> {
  const zipPath = `${packageDir}.flow.zip`;
  const zip = new AdmZip();
  zip.addLocalFolder(packageDir);
  await new Promise<void>((resolve, reject) => {
    zip.writeZip(zipPath, (error) => (error ? reject(error) : resolve()));
  });
  return zipPath;
}

export async function writeFlowPackage(input: WriteFlowPackageInput): Promise<string> {
  const safeName = (input.packageName || input.flow.name || 'autochar-flow').replace(/[^\w.-]+/g, '-');
  const packageDir = path.join(input.outputDir, safeName);
  await fs.rm(packageDir, { recursive: true, force: true });
  await fs.mkdir(packageDir, { recursive: true });
  await fs.writeFile(path.join(packageDir, 'flow.json'), `${JSON.stringify(input.flow, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(packageDir, 'metadata.json'), `${JSON.stringify(input.metadata, null, 2)}\n`, 'utf8');
  await copyScreenshots(input.screenshotsDir, path.join(packageDir, 'screenshots'));
  await fs.writeFile(path.join(packageDir, 'notes.txt'), input.notes || 'No notes.', 'utf8');
  if (input.reviewMarkdown?.trim()) {
    await fs.writeFile(path.join(packageDir, 'review.md'), input.reviewMarkdown, 'utf8');
  }

  const validation = validateBasicFlow({ flow: input.flow, packageDir });
  if (!validation.ok) {
    throw new Error(`Flow package validation failed:\n${validation.errors.join('\n')}`);
  }

  return zipFlowPackage(packageDir);
}
