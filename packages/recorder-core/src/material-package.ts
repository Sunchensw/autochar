import fs from 'node:fs/promises';
import path from 'node:path';
import {
  isSensitiveField,
  type FlowPackage,
  type FlowStep,
  type PageContextElement,
  type SelectorSet
} from '@autochar/shared';
import { safeDocumentName } from './operation-markdown';
import { buildTemplateWorkbook } from './xlsx-template';

export type MaterialControlType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'upload'
  | 'singleSelect'
  | 'multiSelect'
  | 'cascaderLevel'
  | 'unknown';

export interface MaterialOption {
  label: string;
  value?: string;
  key: string;
  parentKey?: string;
  path?: string[];
}

export interface MaterialField {
  id: string;
  column: string;
  controlType: MaterialControlType;
  required: boolean;
  pageTitle?: string;
  url?: string;
  area?: string;
  selector?: string;
  selectors?: SelectorSet;
  placeholder?: string;
  options: MaterialOption[];
  dependsOn: string[];
  optionSource?: string;
  sourceStepIds: string[];
  sensitive: boolean;
}

export interface MaterialProcessStep {
  order: number;
  label: string;
  type: FlowStep['type'] | 'button';
  pageTitle?: string;
  url?: string;
  selector?: string;
  selectors?: SelectorSet;
  riskLevel: FlowStep['riskLevel'];
  requiresConfirmation: boolean;
}

export interface MaterialOptionGroup {
  id: string;
  kind: 'cascader' | 'list';
  label: string;
  paths?: string[][];
  options?: MaterialOption[];
}

export interface MaterialPackage {
  documentType: 'autochar-ecommerce-material-package';
  version: '1.0.0';
  flowName: string;
  startUrl: string;
  createdAt: string;
  generatedAt: string;
  fields: MaterialField[];
  processSteps: MaterialProcessStep[];
  optionGroups: MaterialOptionGroup[];
  notes?: string;
}

export interface BuildMaterialPackageInput {
  flow: FlowPackage;
  notes?: string;
}

export interface WriteMaterialPackageInput extends BuildMaterialPackageInput {
  outputDir: string;
  documentName?: string;
}

export interface WriteMaterialPackageResult {
  outputDir: string;
  markdownPath: string;
  dictionaryPath: string;
  workbookPath: string;
}

interface FieldDraft {
  column: string;
  controlType: MaterialControlType;
  required?: boolean;
  pageTitle?: string;
  url?: string;
  area?: string;
  selector?: string;
  selectors?: SelectorSet;
  placeholder?: string;
  options?: Array<{ label: string; value?: string }>;
  dependsOn?: string[];
  optionSource?: string;
  sourceStepId?: string;
  sensitive?: boolean;
}

function cleanText(value: unknown, maxLength = 160): string {
  const text = typeof value === 'string' ? value : value == null ? '' : String(value);
  const cleaned = text.replace(/\s+/g, ' ').trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
}

function displayName(element: PageContextElement, fallback = ''): string {
  return cleanText(element.label || element.placeholder || element.name || element.text || element.id || fallback);
}

function fieldKey(column: string, area?: string): string {
  return `${cleanText(area, 80)}|${cleanText(column, 120)}`.toLowerCase();
}

function optionKey(label: string, pathParts: string[] = []): string {
  const source = [...pathParts, label].join('|');
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `opt_${(hash >>> 0).toString(36)}`;
}

function controlTypeFromElement(element: PageContextElement): MaterialControlType {
  const tag = element.tagName?.toLowerCase() ?? '';
  const type = element.type?.toLowerCase() ?? '';
  const role = element.role?.toLowerCase() ?? '';
  if (element.cascaderPath?.length || element.cascaderPaths?.length) return 'cascaderLevel';
  if (type === 'file') return 'upload';
  if (tag === 'textarea') return 'textarea';
  if (type === 'number') return 'number';
  if (['date', 'datetime-local', 'time'].includes(type)) return 'date';
  if (tag === 'select' || role === 'combobox' || role === 'listbox') return 'singleSelect';
  if (type === 'radio' || role === 'radio') return 'singleSelect';
  if (type === 'checkbox' || role === 'checkbox') return 'multiSelect';
  if (tag === 'input' || role === 'textbox' || element.contentEditable) return 'text';
  return 'unknown';
}

function controlTypeFromStep(step: FlowStep): MaterialControlType {
  if (step.type === 'fileUpload') return 'upload';
  if (step.type === 'select') return 'singleSelect';
  const element = step.element ?? {};
  return controlTypeFromElement(element as PageContextElement);
}

function isButtonLike(element: PageContextElement): boolean {
  const tag = element.tagName?.toLowerCase() ?? '';
  const type = element.type?.toLowerCase() ?? '';
  const role = element.role?.toLowerCase() ?? '';
  return tag === 'button' || role === 'button' || ['button', 'submit', 'reset'].includes(type);
}

function requiredFromElement(element: PageContextElement): boolean {
  if (element.required) return true;
  const text = [element.label, element.nearbyText, element.rowText, element.text].filter(Boolean).join(' ');
  return /(^|\s)\*|必填|required/i.test(text);
}

function fieldDraftFromElement(element: PageContextElement, step: FlowStep): FieldDraft | undefined {
  if (isSensitiveField(element)) return undefined;
  if (isButtonLike(element)) return undefined;
  const controlType = controlTypeFromElement(element);
  if (controlType === 'unknown' || controlType === 'cascaderLevel') return undefined;
  const column = displayName(element);
  if (!column) return undefined;
  return {
    column,
    controlType,
    required: requiredFromElement(element),
    pageTitle: step.title,
    url: step.url,
    area: element.area,
    selector: element.selector,
    placeholder: element.placeholder,
    options: element.options?.map((option) => ({ label: cleanText(option.label), value: option.value })).filter((option) => option.label),
    sensitive: false
  };
}

function fieldDraftFromStep(step: FlowStep): FieldDraft | undefined {
  if (!['fill', 'select', 'fileUpload'].includes(step.type)) return undefined;
  if (step.sensitive || isSensitiveField(step.element ?? {})) return undefined;
  const element = step.element ?? {};
  const column = cleanText(step.variable || element.label || element.placeholder || step.label || element.name);
  if (!column) return undefined;
  return {
    column,
    controlType: controlTypeFromStep(step),
    required: requiredFromElement(element as PageContextElement),
    pageTitle: step.title,
    url: step.url,
    area: element.area,
    selector: element.selector,
    selectors: step.selectors,
    placeholder: element.placeholder,
    sourceStepId: step.id,
    sensitive: false
  };
}

function collectCascaderPaths(flow: FlowPackage): string[][] {
  const paths: string[][] = [];
  for (const step of flow.steps) {
    const contexts = [
      ...(step.pageContext?.interactables ?? []),
      ...(step.pageContext?.forms ?? []).flatMap((form) => form.fields ?? [])
    ];
    for (const element of contexts) {
      for (const item of element.cascaderPaths ?? []) {
        const cleaned = item.map((value) => cleanText(value, 80)).filter(Boolean);
        if (cleaned.length) paths.push(cleaned);
      }
      if (element.cascaderPath?.length) {
        const cleaned = element.cascaderPath.map((value) => cleanText(value, 80)).filter(Boolean);
        if (cleaned.length) paths.push(cleaned);
      }
    }
  }
  const seen = new Set<string>();
  return paths.filter((item) => {
    const key = item.join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cascaderFields(paths: string[][]): FieldDraft[] {
  const maxLevel = Math.min(3, Math.max(0, ...paths.map((path) => path.length)));
  const labels = ['一级分类', '二级分类', '三级分类'];
  return Array.from({ length: maxLevel }).map((_, index) => ({
    column: labels[index] ?? `${index + 1}级分类`,
    controlType: 'cascaderLevel' as const,
    required: true,
    options: [],
    optionSource: '选项库',
    dependsOn: labels.slice(0, index)
  }));
}

function normalizeOptions(options: Array<{ label: string; value?: string }> | undefined, parentPath: string[] = []): MaterialOption[] {
  const seen = new Set<string>();
  return (options ?? [])
    .map((option) => ({
      label: cleanText(option.label),
      value: option.value ? cleanText(option.value) : undefined,
      key: optionKey(option.label, parentPath)
    }))
    .filter((option) => {
      if (!option.label || seen.has(option.label)) return false;
      seen.add(option.label);
      return true;
    });
}

function materialFieldsFromDrafts(drafts: FieldDraft[]): MaterialField[] {
  const seen = new Map<string, MaterialField>();
  for (const draft of drafts) {
    if (draft.sensitive) continue;
    const key = fieldKey(draft.column, draft.area);
    const existing = seen.get(key);
    if (existing) {
      existing.sourceStepIds = Array.from(new Set([...existing.sourceStepIds, draft.sourceStepId].filter(Boolean) as string[]));
      existing.selectors = existing.selectors ?? draft.selectors;
      existing.selector = existing.selector ?? draft.selector;
      existing.options = existing.options.length ? existing.options : normalizeOptions(draft.options);
      existing.required = existing.required || Boolean(draft.required);
      continue;
    }
    const id = `field-${String(seen.size + 1).padStart(3, '0')}`;
    seen.set(key, {
      id,
      column: draft.column,
      controlType: draft.controlType,
      required: Boolean(draft.required),
      pageTitle: draft.pageTitle,
      url: draft.url,
      area: draft.area,
      selector: draft.selector,
      selectors: draft.selectors,
      placeholder: draft.placeholder,
      options: normalizeOptions(draft.options),
      dependsOn: draft.dependsOn ?? [],
      optionSource: draft.optionSource,
      sourceStepIds: draft.sourceStepId ? [draft.sourceStepId] : [],
      sensitive: false
    });
  }
  return Array.from(seen.values());
}

function processStepFromFlowStep(step: FlowStep): MaterialProcessStep | undefined {
  if (!['click', 'navigation', 'assertion', 'manualIntervention'].includes(step.type)) return undefined;
  return {
    order: step.order,
    label: cleanText(step.label || step.element?.text || step.type),
    type: step.type,
    pageTitle: step.title,
    url: step.url,
    selector: step.element?.selector,
    selectors: step.selectors,
    riskLevel: step.riskLevel,
    requiresConfirmation: step.requiresConfirmation
  };
}

function processStepFromElement(element: PageContextElement, owner: FlowStep, offset: number): MaterialProcessStep | undefined {
  if (!isButtonLike(element)) return undefined;
  const label = displayName(element, 'button');
  if (!label) return undefined;
  return {
    order: owner.order * 1000 + offset,
    label,
    type: 'button',
    pageTitle: owner.title,
    url: owner.url,
    selector: element.selector,
    riskLevel: /保存|提交|审核|删除|发布|确认/.test(label) ? 'high' : 'low',
    requiresConfirmation: /保存|提交|审核|删除|发布|确认/.test(label)
  };
}

function collectProcessSteps(flow: FlowPackage): MaterialProcessStep[] {
  const steps: MaterialProcessStep[] = [];
  const seen = new Set<string>();
  for (const step of flow.steps) {
    const fromStep = processStepFromFlowStep(step);
    if (fromStep) steps.push(fromStep);
    (step.pageContext?.interactables ?? []).forEach((element, index) => {
      const processStep = processStepFromElement(element, step, index);
      if (processStep) steps.push(processStep);
    });
  }
  return steps
    .filter((step) => {
      const key = `${step.label}|${step.url}|${step.selector ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.order - b.order);
}

export function buildMaterialPackage(input: BuildMaterialPackageInput): MaterialPackage {
  const cascaderPathList = collectCascaderPaths(input.flow);
  const drafts: FieldDraft[] = [...cascaderFields(cascaderPathList)];

  for (const step of input.flow.steps) {
    const fromStep = fieldDraftFromStep(step);
    if (fromStep) drafts.push(fromStep);
    for (const form of step.pageContext?.forms ?? []) {
      for (const field of form.fields ?? []) {
        const fromField = fieldDraftFromElement({ ...field, area: field.area || form.label || form.name || form.id }, step);
        if (fromField) drafts.push(fromField);
      }
    }
    for (const element of step.pageContext?.interactables ?? []) {
      const fromElement = fieldDraftFromElement(element, step);
      if (fromElement) drafts.push(fromElement);
    }
  }

  const fields = materialFieldsFromDrafts(drafts);
  const optionGroups: MaterialOptionGroup[] = [];
  if (cascaderPathList.length) {
    optionGroups.push({
      id: 'category-cascader',
      kind: 'cascader',
      label: '分类级联选项',
      paths: cascaderPathList
    });
  }
  for (const field of fields) {
    if (field.controlType !== 'cascaderLevel' && field.options.length) {
      optionGroups.push({
        id: `${field.id}-options`,
        kind: 'list',
        label: field.column,
        options: field.options
      });
      field.optionSource = '选项库';
    }
  }

  return {
    documentType: 'autochar-ecommerce-material-package',
    version: '1.0.0',
    flowName: input.flow.name,
    startUrl: input.flow.startUrl,
    createdAt: input.flow.createdAt,
    generatedAt: new Date().toISOString(),
    fields,
    processSteps: collectProcessSteps(input.flow),
    optionGroups,
    notes: input.notes
  };
}

export function buildMaterialMarkdown(material: MaterialPackage): string {
  const fieldRows = material.fields.map((field) =>
    `| ${field.column} | ${field.controlType} | ${field.required ? '是' : '否'} | ${field.dependsOn.join('、') || '-'} | ${field.optionSource ?? '-'} |`
  );
  const processRows = material.processSteps.map((step) =>
    `| ${step.order} | ${step.type} | ${step.label} | ${step.requiresConfirmation ? '是' : '否'} |`
  );
  const cascader = material.fields.filter((field) => field.controlType === 'cascaderLevel').map((field) => field.column);

  return [
    '# 电商后台自动化材料包',
    '',
    '## 基本信息',
    `- 流程名称: ${material.flowName}`,
    `- 起始 URL: ${material.startUrl}`,
    `- 生成时间: ${material.generatedAt}`,
    material.notes ? `- 备注: ${material.notes}` : '',
    '',
    '## 使用方式',
    '- 字段值来自 `字段模板.xlsx`，未来 AI 代码应逐行读取 Excel 后再按字段字典定位页面控件。',
    '- `field-dictionary.json` 是给 AI/执行器使用的控件地图，包含 selector、控件类型、选项来源和依赖关系。',
    '- 不要把保存、提交、删除、审核按钮当作 Excel 数据列；这些按钮只属于流程步骤。',
    cascader.length ? `- 分类联动顺序: ${cascader.join(' -> ')}。` : '',
    '',
    '## Excel 字段',
    '| 字段 | 控件类型 | 必填 | 依赖字段 | 选项来源 |',
    '| --- | --- | --- | --- | --- |',
    fieldRows.length ? fieldRows.join('\n') : '| - | - | - | - | - |',
    '',
    '## 流程步骤',
    '| 顺序 | 类型 | 动作 | 需要确认 |',
    '| --- | --- | --- | --- |',
    processRows.length ? processRows.join('\n') : '| - | - | - | - |',
    '',
    '## 失败处理建议',
    '- 控件找不到时先根据页面区域和 selector 候选重新定位，不要盲目点击同名按钮。',
    '- Excel 字段为空时跳过对应填写动作，不要清空页面已有内容。',
    '- 保存、提交审核、删除、发布等高风险步骤执行前需要确认页面数据已经按 Excel 填写完成。',
    ''
  ].filter((line) => line !== '').join('\n');
}

export async function writeMaterialPackage(input: WriteMaterialPackageInput): Promise<WriteMaterialPackageResult> {
  const material = buildMaterialPackage(input);
  const packageDir = path.join(input.outputDir, `${safeDocumentName(input.documentName || input.flow.name)}-materials`);
  await fs.mkdir(packageDir, { recursive: true });

  const markdownPath = path.join(packageDir, '流程说明.md');
  const dictionaryPath = path.join(packageDir, 'field-dictionary.json');
  const workbookPath = path.join(packageDir, '字段模板.xlsx');

  await fs.writeFile(markdownPath, buildMaterialMarkdown(material), 'utf8');
  await fs.writeFile(dictionaryPath, JSON.stringify(material, null, 2), 'utf8');
  await fs.writeFile(workbookPath, buildTemplateWorkbook({ fields: material.fields, optionGroups: material.optionGroups }), 'binary');

  return {
    outputDir: packageDir,
    markdownPath,
    dictionaryPath,
    workbookPath
  };
}
