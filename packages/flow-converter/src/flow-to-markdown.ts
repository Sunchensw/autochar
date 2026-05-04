import { isSensitiveField, type FlowPackage, type FlowStep, type SelectorCandidate } from '@autochar/shared';

export interface FlowReviewMarkdownOptions {
  includeTimestamps?: boolean;
}

function clean(value: string | undefined): string {
  return (value || '-').replace(/\s+/g, ' ').trim() || '-';
}

function formatSelector(candidate: SelectorCandidate): string {
  if (candidate.kind === 'role') {
    const role = candidate.role || candidate.value;
    return candidate.name ? `role=${role} name=${candidate.name}` : `role=${role}`;
  }
  return `${candidate.kind}=${candidate.value}`;
}

function sensitiveText(step: FlowStep): string {
  return [
    step.label,
    step.value,
    step.element?.type,
    step.element?.name,
    step.element?.id,
    step.element?.label,
    step.element?.placeholder,
    step.element?.text
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function isSensitiveStep(step: FlowStep): boolean {
  const text = sensitiveText(step);
  return (
    step.sensitive ||
    step.valuePolicy === 'masked' ||
    isSensitiveField(step.element ?? {}) ||
    /password|passwd|pwd|captcha|验证码|token|cookie|localstorage|sessionstorage/.test(text)
  );
}

function formatValue(step: FlowStep): string | undefined {
  if (!step.value) return undefined;
  if (isSensitiveStep(step)) return '已隐藏';
  if (step.valuePolicy === 'notStored') return '不导出';
  return step.value;
}

function riskLine(step: FlowStep): string {
  const flags = [];
  if (step.requiresConfirmation) flags.push('需要人工确认');
  if (step.requiresManualReview) flags.push('需要人工复核');
  return flags.length ? `${step.riskLevel}，${flags.join('，')}` : step.riskLevel;
}

function stepLines(step: FlowStep, options: FlowReviewMarkdownOptions): string[] {
  const lines = [
    `### ${step.order}. ${clean(step.label)}`,
    `- 步骤 ID: ${step.id}`,
    `- 操作类型: ${step.type}`,
    `- 页面标题: ${clean(step.title)}`,
    `- URL: ${clean(step.url)}`,
    `- 值策略: ${step.valuePolicy}`,
    `- 风险: ${riskLine(step)}`
  ];

  if (step.framePath?.length) {
    lines.push(`- iframe: ${step.framePath.join(' > ')}`);
  }

  if (step.selectors) {
    lines.push(`- 主选择器: ${formatSelector(step.selectors.primary)}`);
    lines.push(`- 备用选择器: ${step.selectors.fallbacks.map(formatSelector).join(', ') || '-'}`);
  }

  const value = formatValue(step);
  if (value !== undefined) {
    lines.push(`- 输入值: ${value}`);
  }

  lines.push(`- 截图: ${step.screenshot || '-'}`);

  if (options.includeTimestamps) {
    lines.push(`- 记录时间: ${step.timestamp}`);
  }

  return lines;
}

export function flowToReviewMarkdown(
  flow: FlowPackage,
  options: FlowReviewMarkdownOptions = {}
): string {
  const lines = [
    '# Autochar 录制流程审核',
    '',
    '## 基本信息',
    `- 流程名称: ${clean(flow.name)}`,
    `- 起始 URL: ${clean(flow.startUrl)}`,
    `- 创建时间: ${flow.createdAt}`,
    `- 步骤数: ${flow.steps.length}`,
    '',
    '## 审核重点',
    '- 检查步骤是否覆盖完整业务流程。',
    '- 检查每一步截图是否对应当前页面状态。',
    '- 检查高风险步骤是否确实需要执行。',
    '- 密码、验证码、token、cookie 和浏览器存储内容默认不在此文本中展示。',
    '',
    '## 步骤明细'
  ];

  for (const step of flow.steps) {
    lines.push('', ...stepLines(step, options));
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}
