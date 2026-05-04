import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import type { FlowPackage, FlowStep } from '@autochar/shared';
import { selectorSetToLocator } from './selector-to-locator';

export interface GenerateOptions {
  functionName: string;
  rowTypeName?: string;
}

export interface CompileGeneratedScriptInput {
  inputPath: string;
  outputPath: string;
}

function q(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function identifier(name: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(name);
}

function rowExpression(variable: string): string {
  return identifier(variable) ? `String(row.${variable} ?? '')` : `String(row[${q(variable)}] ?? '')`;
}

function fillExpression(step: FlowStep): string {
  if (step.variable) {
    return rowExpression(step.variable);
  }
  const variableMatch = step.value?.match(/^\{\{(.+)\}\}$/);
  if (variableMatch) {
    return rowExpression(variableMatch[1]);
  }
  return q(step.value ?? '');
}

function actionForStep(step: FlowStep): string[] {
  const lines: string[] = [];
  if (step.riskLevel === 'high' || step.requiresConfirmation) {
    lines.push(`  // MANUAL REVIEW: high-risk action "${step.label}" requires confirmation before execution.`);
  }
  if (step.requiresManualReview) {
    lines.push(`  // MANUAL REVIEW: selector or intent should be checked for "${step.label}".`);
  }

  if (step.type === 'goto') {
    lines.push(`  await page.goto(${q(step.value || step.url)});`);
    return lines;
  }

  if (step.type === 'navigation') {
    lines.push(`  await page.waitForURL(${q(step.value || step.url)});`);
    return lines;
  }

  if (step.type === 'manualIntervention') {
    lines.push(`  throw new Error(${q(`Manual intervention required: ${step.label}`)});`);
    return lines;
  }

  const locator = step.selectors ? selectorSetToLocator(step.selectors) : 'page.locator("body")';
  const action =
    step.type === 'fill'
      ? `${locator}.fill(${fillExpression(step)})`
      : step.type === 'select'
        ? `${locator}.selectOption(${fillExpression(step)})`
        : step.type === 'fileUpload'
          ? `${locator}.setInputFiles(${fillExpression(step)})`
          : step.type === 'assertion'
            ? `expect(${locator}).toBeVisible()`
            : `${locator}.click()`;

  if (step.networkHints?.length && step.type !== 'assertion') {
    const waiters = step.networkHints.map((hint) => `page.waitForResponse((response) => response.url().includes(${q(hint)}))`);
    lines.push(`  await Promise.all([`);
    for (const waiter of waiters) {
      lines.push(`    ${waiter},`);
    }
    lines.push(`    ${action}`);
    lines.push(`  ]);`);
  } else {
    lines.push(`  await ${action};`);
  }

  if (step.assertions?.length) {
    for (const assertion of step.assertions) {
      if (assertion.selector) {
        lines.push(`  await expect(${selectorSetToLocator(assertion.selector)}).toBeVisible();`);
      } else if (assertion.value) {
        lines.push(`  await expect(page.getByText(${q(assertion.value)})).toBeVisible();`);
      }
    }
  }
  return lines;
}

export function generatePlaywrightScript(flow: FlowPackage, options: GenerateOptions): string {
  const rowTypeName = options.rowTypeName ?? 'AutocharRow';
  const lines = [
    `import { expect, type Page } from '@playwright/test';`,
    '',
    `export type ${rowTypeName} = Record<string, string>;`,
    '',
    `export async function ${options.functionName}(page: Page, row: ${rowTypeName}): Promise<void> {`
  ];
  for (const step of flow.steps) {
    lines.push(`  // ${step.id}: ${step.label} (${step.url} | ${step.title})`);
    lines.push(...actionForStep(step));
  }
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

export async function compileGeneratedScript(input: CompileGeneratedScriptInput): Promise<string> {
  await fs.mkdir(path.dirname(input.outputPath), { recursive: true });
  await build({
    entryPoints: [input.inputPath],
    outfile: input.outputPath,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    bundle: false,
    sourcemap: false,
    logLevel: 'silent'
  });
  return input.outputPath;
}
