import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  FlowMetadata,
  FlowPackage,
  FlowStep,
  PageContextSnapshot,
  SelectorCandidate
} from '@autochar/shared';

export interface BuildOperationMarkdownInput {
  flow: FlowPackage;
  metadata?: FlowMetadata;
  notes?: string;
}

export interface WriteOperationMarkdownInput extends BuildOperationMarkdownInput {
  outputDir: string;
  documentName?: string;
}

const sensitiveTextPattern = /(password|passwd|pwd|secret|token|cookie|authorization|验证码|密码|口令|令牌)/i;
const browserStoragePattern = /(localStorage|sessionStorage)/gi;

function cleanText(value: unknown, maxLength = 600): string {
  const raw = typeof value === 'string' ? value : value == null ? '' : String(value);
  if (!raw.trim()) return '';
  const normalized = raw
    .replace(/\s+/g, ' ')
    .replace(/\b(cookie|token|authorization)\s*[:=]\s*[^\s;]+/gi, '[sensitive-redacted]')
    .replace(browserStoragePattern, '[browser-storage]')
    .trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function cleanNotes(notes?: string): string {
  const lines = cleanText(notes ?? '', 2000)
    .split(/\r?\n|;/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !sensitiveTextPattern.test(line) && !line.includes('[browser-storage]'));
  return lines.join('\n');
}

function bullet(value: string): string {
  return value ? `- ${value}` : '';
}

function formatSelector(selector: SelectorCandidate): string {
  const parts = [`${selector.kind}="${cleanText(selector.value, 180)}"`];
  if (selector.role) parts.push(`role="${cleanText(selector.role, 80)}"`);
  if (selector.name) parts.push(`name="${cleanText(selector.name, 160)}"`);
  return parts.join(' ');
}

function formatSelectors(step: FlowStep): string {
  if (!step.selectors?.primary) return '无 selector 候选，需要人工根据页面结构确认。';
  const fallbacks = step.selectors.fallbacks?.length
    ? `; fallbacks: ${step.selectors.fallbacks.map(formatSelector).join(' | ')}`
    : '';
  return `primary: ${formatSelector(step.selectors.primary)}${fallbacks}`;
}

function targetDescription(step: FlowStep): string {
  const element = step.element ?? {};
  const parts = [
    cleanText(element.tagName, 80),
    element.role ? `role "${cleanText(element.role, 80)}"` : '',
    element.label ? `label "${cleanText(element.label, 160)}"` : '',
    element.placeholder ? `placeholder "${cleanText(element.placeholder, 160)}"` : '',
    element.name ? `name "${cleanText(element.name, 120)}"` : '',
    element.id ? `id "${cleanText(element.id, 120)}"` : '',
    element.text && !step.sensitive ? `text "${cleanText(element.text, 180)}"` : ''
  ].filter(Boolean);
  if (parts.length) return parts.join(', ');
  return cleanText(step.label, 180) || '当前页面目标元素';
}

function displayValue(step: FlowStep): string {
  if (step.sensitive || step.valuePolicy === 'masked') return '[已屏蔽]';
  if (step.valuePolicy === 'notStored') return '[未保存]';
  return cleanText(step.value, 240);
}

function variableToken(step: FlowStep): string {
  if (step.sensitive || step.valuePolicy === 'masked') return '';
  if (step.variable) return `{{${cleanText(step.variable, 80)}}}`;
  const value = cleanText(step.value, 160);
  return /^\{\{[^{}]+\}\}$/.test(value) ? value : '';
}

function pageArea(step: FlowStep): string {
  const element = step.element ?? {};
  const rowText = cleanText(element.rowText, 240);
  const area = cleanText(element.area, 160);
  if (rowText && area) return `${rowText} / ${area}`;
  return rowText || area || '未识别';
}

function stepNearbyText(step: FlowStep): string {
  const element = step.element ?? {};
  return cleanText(element.nearbyText || element.rowText || element.text || step.pageContext?.summaryText, 280) || '未识别';
}

function summarizePageContext(context?: PageContextSnapshot): string[] {
  if (!context) return [];
  const lines: string[] = [];
  if (context.summaryText) lines.push(`页面主要文本: ${cleanText(context.summaryText, 700)}`);
  if (context.interactables?.length) {
    const items = context.interactables
      .slice(0, 12)
      .map((item) => cleanText(item.label || item.text || item.role || item.selector || item.tagName, 120))
      .filter(Boolean);
    if (items.length) lines.push(`主要可交互元素: ${items.join(' | ')}`);
  }
  if (context.forms?.length) {
    const forms = context.forms
      .slice(0, 6)
      .map((form, index) => {
        const label = cleanText(form.label || form.name || form.id || `form-${index + 1}`, 120);
        const fields = form.fields
          ?.slice(0, 10)
          .map((field) => cleanText(field.label || field.placeholder || field.name || field.type, 80))
          .filter(Boolean)
          .join(', ');
        return fields ? `${label} (${fields})` : label;
      })
      .filter(Boolean);
    if (forms.length) lines.push(`表单: ${forms.join(' | ')}`);
  }
  if (context.tables?.length) {
    const tables = context.tables
      .slice(0, 5)
      .map((table, index) => {
        const label = cleanText(table.caption || `table-${index + 1}`, 120);
        const headers = table.headers?.length ? ` headers: ${table.headers.map((item) => cleanText(item, 80)).join(', ')}` : '';
        const firstRow = table.rows?.[0]?.length ? ` first row: ${table.rows[0].map((item) => cleanText(item, 80)).join(', ')}` : '';
        return `${label}${headers}${firstRow}`;
      })
      .filter(Boolean);
    if (tables.length) lines.push(`表格: ${tables.join(' | ')}`);
  }
  for (const warning of context.warnings ?? []) {
    lines.push(`页面提示: ${cleanText(warning, 180)}`);
  }
  return lines;
}

function uniquePageSummaries(flow: FlowPackage): string[] {
  const seen = new Set<string>();
  const summaries: string[] = [];
  for (const step of flow.steps) {
    const key = `${step.title}|${step.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const contextLines = summarizePageContext(step.pageContext);
    summaries.push([
      `### ${cleanText(step.title || 'Untitled page', 140)}`,
      bullet(`URL: ${cleanText(step.url, 300)}`),
      ...contextLines.map((line) => bullet(line))
    ].filter(Boolean).join('\n'));
  }
  return summaries;
}

function formatStep(step: FlowStep): string {
  const variable = variableToken(step);
  const lines = [
    `### 步骤 ${step.order}`,
    bullet(`动作类型: ${step.type}`),
    bullet(`用户实际动作: ${cleanText(step.label, 260)}`),
    bullet(`页面标题: ${cleanText(step.title, 200) || 'Untitled page'}`),
    bullet(`URL: ${cleanText(step.url, 320)}`),
    bullet(`目标元素: ${targetDescription(step)}`),
    bullet(`selector 候选: ${formatSelectors(step)}`),
    bullet(`输入变量/值: ${variable || displayValue(step)}`),
    bullet(`附近文本: ${stepNearbyText(step)}`),
    bullet(`所在表格行/页面区域: ${pageArea(step)}`),
    bullet(`风险等级: ${step.riskLevel}`),
    bullet(`人工复核: ${step.requiresManualReview ? '是' : '否'}`),
    bullet(`需要确认: ${step.requiresConfirmation ? '是' : '否'}`)
  ];
  return lines.filter(Boolean).join('\n');
}

function variablesTable(flow: FlowPackage): string {
  const rows = flow.steps
    .map((step) => {
      const token = variableToken(step);
      if (!token) return '';
      return `| ${token} | ${step.id} | ${cleanText(step.label, 160)} | ${step.sensitive ? '是' : '否'} |`;
    })
    .filter(Boolean);
  if (!rows.length) return '无明确变量。录制中的敏感输入不会写入文档。';
  return ['| 变量 | 来源步骤 | 用途 | 是否敏感 |', '| --- | --- | --- | --- |', ...rows].join('\n');
}

function riskLines(flow: FlowPackage): string {
  const lines: string[] = [];
  for (const step of flow.steps) {
    if (step.sensitive) {
      lines.push(`- ${step.id}: 涉及敏感输入，值已屏蔽，需要人工在实际页面输入。`);
    }
    if (step.riskLevel === 'high' || step.requiresConfirmation || step.requiresManualReview) {
      lines.push(`- ${step.id}: ${cleanText(step.label, 180)}，风险等级 ${step.riskLevel}，人工复核 ${step.requiresManualReview ? '是' : '否'}。`);
    }
    for (const warning of step.pageContext?.warnings ?? []) {
      lines.push(`- ${step.id}: ${cleanText(warning, 220)}`);
    }
  }
  return lines.length ? Array.from(new Set(lines)).join('\n') : '- 未发现高风险动作。仍建议执行前人工核对目标页面和变量。';
}

function sanitizeStructuredStep(step: FlowStep) {
  return {
    id: step.id,
    order: step.order,
    type: step.type,
    label: cleanText(step.label, 260),
    url: cleanText(step.url, 320),
    title: cleanText(step.title, 200),
    framePath: step.framePath,
    value: step.sensitive || step.valuePolicy === 'masked' ? '[masked]' : displayValue(step),
    variable: variableToken(step) || undefined,
    valuePolicy: step.valuePolicy,
    sensitive: step.sensitive,
    selectors: step.selectors,
    target: targetDescription(step),
    nearbyText: stepNearbyText(step),
    pageArea: pageArea(step),
    riskLevel: step.riskLevel,
    requiresConfirmation: step.requiresConfirmation,
    requiresManualReview: step.requiresManualReview,
    timestamp: step.timestamp,
    pageContext: step.pageContext
  };
}

function structuredData(input: BuildOperationMarkdownInput) {
  return {
    documentType: 'autochar-ai-operation-document',
    documentVersion: '1.0.0',
    safetyBoundary: {
      allowedUrlSchemes: ['http', 'https', 'raw'],
      disabledCapabilities: ['customHooks', 'customScripts', 'stealth', 'proxy', 'storageExport'],
      dataNotWritten: ['passwordValues', 'captchaValues', 'tokens', 'siteCredentials', 'browserStorage']
    },
    flow: {
      schemaVersion: input.flow.schemaVersion,
      name: cleanText(input.flow.name, 180),
      startUrl: cleanText(input.flow.startUrl, 320),
      createdAt: input.flow.createdAt
    },
    metadata: input.metadata,
    notes: cleanNotes(input.notes),
    steps: input.flow.steps.map(sanitizeStructuredStep)
  };
}

export function safeDocumentName(input: string): string {
  const safe = (input || 'Autochar Recording')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 90);
  return safe || 'Autochar-Recording';
}

export function buildOperationMarkdown(input: BuildOperationMarkdownInput): string {
  const notes = cleanNotes(input.notes);
  const pageSummaries = uniquePageSummaries(input.flow);
  const metadata = input.metadata;
  const sections = [
    '# Autochar AI Operation Document',
    '',
    '## 基本信息',
    bullet(`流程名称: ${cleanText(input.flow.name, 180)}`),
    bullet(`起始 URL: ${cleanText(input.flow.startUrl, 320)}`),
    bullet(`创建时间: ${input.flow.createdAt}`),
    bullet(`录制浏览器: ${cleanText(metadata?.browser, 120) || 'Unknown'}`),
    bullet(`视口: ${metadata ? `${metadata.viewport.width}x${metadata.viewport.height}` : 'Unknown'}`),
    bullet(`步骤数量: ${input.flow.steps.length}`),
    notes ? bullet(`备注: ${notes}`) : '',
    '',
    '## 安全边界',
    '- 本文档只描述用户已经授权的页面操作，不包含可执行脚本。',
    '- URL 默认只允许 http、https、raw 三类来源。',
    '- hooks、自定义执行脚本、stealth、proxy、浏览器存储导出默认禁用。',
    '- 密码值、验证码值、令牌、站点凭据、浏览器本地/会话存储不会写入文档。',
    '- 出现验证码、风控、二次验证或登录失效时记录为人工介入步骤。',
    '',
    '## 页面结构摘要',
    pageSummaries.length ? pageSummaries.join('\n\n') : '未采集到页面结构摘要。',
    '',
    '## 操作步骤',
    input.flow.steps.map(formatStep).join('\n\n'),
    '',
    '## 变量表',
    variablesTable(input.flow),
    '',
    '## 风险与人工介入',
    riskLines(input.flow),
    '',
    '## Structured Data',
    '```json',
    JSON.stringify(structuredData(input), null, 2),
    '```',
    ''
  ];
  return sections.filter((line) => line !== undefined).join('\n');
}

export async function writeOperationMarkdown(input: WriteOperationMarkdownInput): Promise<string> {
  await fs.mkdir(input.outputDir, { recursive: true });
  const filePath = path.join(input.outputDir, `${safeDocumentName(input.documentName || input.flow.name)}.autochar.md`);
  await fs.writeFile(filePath, buildOperationMarkdown(input), 'utf8');
  return filePath;
}
