import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { detectHighRiskAction } from './risk';
import { isSensitiveField } from './sensitive';

export const selectorCandidateSchema = z.object({
  kind: z.enum(['testId', 'role', 'label', 'placeholder', 'name', 'id', 'text', 'css']),
  value: z.string().min(1),
  role: z.string().optional(),
  name: z.string().optional(),
  uniqueAtRecordTime: z.boolean().optional(),
  countAtRecordTime: z.number().int().nonnegative().optional()
});

export const selectorSetSchema = z.object({
  primary: selectorCandidateSchema,
  fallbacks: z.array(selectorCandidateSchema).default([])
});

export const pageContextElementSchema = z
  .object({
    tagName: z.string().optional(),
    type: z.string().optional(),
    name: z.string().optional(),
    id: z.string().optional(),
    label: z.string().optional(),
    placeholder: z.string().optional(),
    role: z.string().optional(),
    text: z.string().optional(),
    href: z.string().optional(),
    selector: z.string().optional(),
    nearbyText: z.string().optional(),
    rowText: z.string().optional(),
    area: z.string().optional()
  })
  .passthrough();

export const pageContextFormSchema = z
  .object({
    name: z.string().optional(),
    id: z.string().optional(),
    label: z.string().optional(),
    fields: z.array(pageContextElementSchema).default([])
  })
  .passthrough();

export const pageContextTableSchema = z
  .object({
    caption: z.string().optional(),
    headers: z.array(z.string()).default([]),
    rows: z.array(z.array(z.string())).default([])
  })
  .passthrough();

export const pageContextSnapshotSchema = z.object({
  summaryText: z.string().optional(),
  interactables: z.array(pageContextElementSchema).default([]),
  forms: z.array(pageContextFormSchema).default([]),
  tables: z.array(pageContextTableSchema).default([]),
  warnings: z.array(z.string()).default([])
});

export const flowStepSchema = z.object({
  id: z.string().min(1),
  order: z.number().int().positive(),
  type: z.enum([
    'goto',
    'click',
    'fill',
    'select',
    'fileUpload',
    'navigation',
    'assertion',
    'manualIntervention'
  ]),
  label: z.string().min(1),
  url: z.string().min(1),
  title: z.string().default(''),
  framePath: z.array(z.string()).optional(),
  value: z.string().optional(),
  variable: z.string().optional(),
  valuePolicy: z.enum(['plain', 'masked', 'notStored']).default('notStored'),
  sensitive: z.boolean().default(false),
  selectors: selectorSetSchema.optional(),
  element: z.record(z.string(), z.string().optional()).optional(),
  pageContext: pageContextSnapshotSchema.optional(),
  networkHints: z.array(z.string()).optional(),
  assertions: z
    .array(
      z.object({
        kind: z.string(),
        value: z.string().optional(),
        selector: selectorSetSchema.optional()
      })
    )
    .optional(),
  screenshot: z.string().optional(),
  screenshotKind: z.enum(['viewport', 'fullPage']).default('viewport'),
  riskLevel: z.enum(['low', 'medium', 'high']).default('low'),
  requiresConfirmation: z.boolean().default(false),
  requiresManualReview: z.boolean().default(false),
  timestamp: z.string().min(1)
});

export const flowPackageSchema = z.object({
  schemaVersion: z.string().min(1),
  name: z.string().min(1),
  startUrl: z.string().min(1),
  createdAt: z.string().min(1),
  steps: z.array(flowStepSchema)
});

export const metadataSchema = z.object({
  toolVersion: z.string().min(1),
  browser: z.string().min(1),
  viewport: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive()
  }),
  platform: z.string().min(1),
  screenshotCount: z.number().int().nonnegative(),
  containsPassword: z.boolean(),
  containsCookies: z.boolean()
});

export type SelectorCandidate = z.infer<typeof selectorCandidateSchema>;
export type SelectorSet = z.infer<typeof selectorSetSchema>;
export type PageContextElement = z.infer<typeof pageContextElementSchema>;
export type PageContextForm = z.infer<typeof pageContextFormSchema>;
export type PageContextTable = z.infer<typeof pageContextTableSchema>;
export type PageContextSnapshot = z.infer<typeof pageContextSnapshotSchema>;
export type FlowStep = z.infer<typeof flowStepSchema>;
export type FlowPackage = z.infer<typeof flowPackageSchema>;
export type FlowMetadata = z.infer<typeof metadataSchema>;

export interface FlowValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface ValidateBasicFlowInput {
  flow: unknown;
  packageDir?: string;
}

const interactionTypes = new Set(['click', 'fill', 'select', 'fileUpload', 'assertion']);

export function parseFlowPackage(input: unknown): FlowPackage {
  return flowPackageSchema.parse(input);
}

export function parseMetadata(input: unknown): FlowMetadata {
  return metadataSchema.parse(input);
}

function screenshotExists(packageDir: string, screenshot: string): boolean {
  const normalized = screenshot.replace(/\\/g, '/');
  const candidate = normalized.startsWith('screenshots/')
    ? path.join(packageDir, ...normalized.split('/'))
    : path.join(packageDir, 'screenshots', normalized);
  return candidate.toLowerCase().endsWith('.png') && fs.existsSync(candidate);
}

export function validateBasicFlow(input: ValidateBasicFlowInput): FlowValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const parsed = flowPackageSchema.safeParse(input.flow);

  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      warnings
    };
  }

  const flow = parsed.data;

  flow.steps.forEach((step, index) => {
    const expectedId = `step-${String(index + 1).padStart(3, '0')}`;
    if (step.id !== expectedId) {
      errors.push(`Step ${step.id} should be ${expectedId}.`);
    }
    if (step.order !== index + 1) {
      errors.push(`Step ${step.id} order should be ${index + 1}.`);
    }

    if (!step.screenshot) {
      errors.push(`Step ${step.id} is missing a screenshot reference.`);
    } else if (input.packageDir && !screenshotExists(input.packageDir, step.screenshot)) {
      errors.push(`Step ${step.id} screenshot does not exist: ${step.screenshot}`);
    }

    if (interactionTypes.has(step.type)) {
      if (!step.selectors?.primary) {
        errors.push(`Step ${step.id} is missing a primary selector.`);
      }
      if (!step.selectors?.fallbacks?.length) {
        errors.push(`Step ${step.id} is missing a fallback selector.`);
      }
    }

    const sensitiveByElement = isSensitiveField({
      type: step.element?.type,
      name: step.element?.name,
      id: step.element?.id,
      label: step.element?.label,
      placeholder: step.element?.placeholder
    });
    if ((step.sensitive || sensitiveByElement) && step.valuePolicy === 'plain') {
      errors.push(`Step ${step.id} is sensitive but uses valuePolicy plain.`);
    }

    const highRiskText = [step.label, step.value, step.element?.text].filter(Boolean).join(' ');
    if (detectHighRiskAction(highRiskText)) {
      if (step.riskLevel !== 'high') {
        errors.push(`Step ${step.id} contains a high-risk action but riskLevel is not high.`);
      }
      if (!step.requiresConfirmation) {
        errors.push(`Step ${step.id} contains a high-risk action but requiresConfirmation is false.`);
      }
    }

    if (step.selectors?.primary.uniqueAtRecordTime === false) {
      warnings.push(`Step ${step.id} primary selector was not unique at record time.`);
    }
  });

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}
