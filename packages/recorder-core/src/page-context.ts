import { pageContextSnapshotSchema, type PageContextSnapshot } from '@autochar/shared';
import type { Page } from 'playwright';

export function isAllowedRecordingUrl(url: string): boolean {
  return /^(https?:\/\/|raw:)/i.test(url);
}

export function buildPageContextScript(): string {
  return `
(() => {
  const MAX_TEXT = 4000;
  const MAX_INTERACTABLES = 120;
  const MAX_FORMS = 20;
  const MAX_TABLES = 10;
  const MAX_ROWS = 5;
  const MAX_CELLS = 8;
  const sensitivePattern = /(password|passwd|pwd|secret|token|cookie|authorization|验证码|密码|口令|令牌)/i;
  const warningPattern = /(captcha|验证码|风控|二次验证|mfa|otp|登录失效|login expired|risk control|human verification)/i;
  const text = (el) => String((el && (el.innerText || el.textContent)) || '').replace(/\\s+/g, ' ').trim();
  const attr = (el, name) => (el && el.getAttribute && el.getAttribute(name)) || '';
  const clean = (value, max = 320) => {
    const raw = String(value || '').replace(/\\s+/g, ' ').trim();
    if (!raw) return '';
    const redacted = raw
      .replace(/\\b(cookie|token|authorization)\\s*[:=]\\s*[^\\s;]+/gi, '[sensitive-redacted]')
      .replace(/(localStorage|sessionStorage)/gi, '[browser-storage]');
    return redacted.length > max ? redacted.slice(0, max - 1) + '…' : redacted;
  };
  const isVisible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const style = window.getComputedStyle ? window.getComputedStyle(el) : undefined;
    if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const labelledBy = (el) => attr(el, 'aria-labelledby')
    .split(/\\s+/)
    .map((id) => text(document.getElementById(id)))
    .filter(Boolean)
    .join(' ');
  const labelText = (el) => {
    if (!el) return '';
    const explicit = attr(el, 'aria-label') || labelledBy(el);
    if (explicit) return clean(explicit, 160);
    const id = attr(el, 'id');
    if (id && window.CSS && CSS.escape) {
      const label = document.querySelector('label[for="' + CSS.escape(id) + '"]');
      if (text(label)) return clean(text(label), 160);
    }
    return clean(text(el.closest && el.closest('label')), 160);
  };
  const roleOf = (el) => {
    if (!el) return '';
    const role = attr(el, 'role');
    if (role) return role;
    const tag = (el.tagName || '').toLowerCase();
    const type = attr(el, 'type').toLowerCase();
    if (tag === 'button') return 'button';
    if (tag === 'a' && attr(el, 'href')) return 'link';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      if (['button', 'submit', 'reset'].includes(type)) return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      return 'textbox';
    }
    return '';
  };
  const cssSelector = (el) => {
    const tag = (el.tagName || 'element').toLowerCase();
    const id = attr(el, 'id');
    const name = attr(el, 'name');
    const testId = attr(el, 'data-testid') || attr(el, 'data-test') || attr(el, 'data-qa');
    const esc = (value) => window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\\\]/g, '\\\\$&');
    if (testId) return '[data-testid="' + esc(testId) + '"]';
    if (id) return tag + '#' + esc(id);
    if (name) return tag + '[name="' + esc(name) + '"]';
    return tag;
  };
  const areaOf = (el) => {
    const area = el.closest && el.closest('[aria-label], section, main, aside, nav, form, dialog, [role="dialog"], [role="main"], [role="region"]');
    return clean(labelText(area) || attr(area, 'aria-label') || attr(area, 'role') || (area && area.tagName), 120);
  };
  const rowTextOf = (el) => clean(text(el.closest && el.closest('tr')), 280);
  const nearbyTextOf = (el) => {
    const host = el.closest && (el.closest('tr') || el.closest('label') || el.closest('form') || el.parentElement);
    return clean(text(host), 280);
  };
  const elementSummary = (el) => {
    const type = attr(el, 'type');
    const label = labelText(el);
    const item = {
      tagName: (el.tagName || '').toUpperCase(),
      type,
      name: clean(attr(el, 'name'), 120),
      id: clean(attr(el, 'id'), 120),
      label,
      placeholder: clean(attr(el, 'placeholder'), 160),
      role: roleOf(el),
      text: sensitivePattern.test([type, label, attr(el, 'name'), attr(el, 'id')].join(' ')) ? '' : clean(text(el), 220),
      href: clean(attr(el, 'href'), 260),
      selector: cssSelector(el),
      nearbyText: nearbyTextOf(el),
      rowText: rowTextOf(el),
      area: areaOf(el)
    };
    return Object.fromEntries(Object.entries(item).filter(([, value]) => value));
  };
  const interactableSelector = [
    'button',
    'a[href]',
    'input:not([type="hidden"])',
    'textarea',
    'select',
    'summary',
    '[role]',
    '[onclick]',
    '[tabindex]:not([tabindex="-1"])',
    '[aria-haspopup]',
    '[aria-expanded]',
    '[aria-controls]',
    '[data-testid]',
    '[data-test]',
    '[data-qa]'
  ].join(',');
  const interactables = Array.from(document.querySelectorAll(interactableSelector))
    .filter(isVisible)
    .slice(0, MAX_INTERACTABLES)
    .map(elementSummary);
  const fieldSelector = 'input:not([type="hidden"]), textarea, select, [contenteditable], [role="textbox"]';
  const forms = Array.from(document.querySelectorAll('form'))
    .filter(isVisible)
    .slice(0, MAX_FORMS)
    .map((form) => ({
      name: clean(attr(form, 'name'), 120),
      id: clean(attr(form, 'id'), 120),
      label: clean(labelText(form) || attr(form, 'aria-label'), 160),
      fields: Array.from(form.querySelectorAll(fieldSelector)).filter(isVisible).slice(0, 40).map(elementSummary)
    }));
  const tables = Array.from(document.querySelectorAll('table'))
    .filter(isVisible)
    .slice(0, MAX_TABLES)
    .map((table) => {
      const headers = Array.from(table.querySelectorAll('thead th, tr:first-child th'))
        .slice(0, MAX_CELLS)
        .map((cell) => clean(text(cell), 120))
        .filter(Boolean);
      const rows = Array.from(table.querySelectorAll('tbody tr, tr'))
        .slice(0, MAX_ROWS)
        .map((row) => Array.from(row.querySelectorAll('th,td')).slice(0, MAX_CELLS).map((cell) => clean(text(cell), 160)).filter(Boolean))
        .filter((row) => row.length);
      return {
        caption: clean(text(table.querySelector('caption')), 160),
        headers,
        rows
      };
    });
  const bodyText = clean(text(document.body || document.documentElement), MAX_TEXT);
  const warnings = [];
  if (warningPattern.test(bodyText)) warnings.push('页面出现验证码、风控、二次验证或登录失效提示，需要人工介入。');
  return {
    summaryText: bodyText,
    interactables,
    forms,
    tables,
    warnings
  };
})()`;
}

export async function capturePageContextFromPage(page: Page): Promise<PageContextSnapshot> {
  const raw = await page.evaluate(buildPageContextScript());
  return pageContextSnapshotSchema.parse(raw);
}
