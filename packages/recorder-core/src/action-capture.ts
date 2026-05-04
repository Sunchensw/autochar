import { isSensitiveField, maskSensitiveValue } from '@autochar/shared';

export type CapturedActionType = 'click' | 'fill' | 'select' | 'fileUpload' | 'submit';

export interface CapturedAction {
  type: CapturedActionType;
  label: string;
  value?: string;
  element: Record<string, string | undefined>;
  url: string;
  title: string;
  timestamp: string;
}

export function buildCaptureScript(): string {
  return `
(() => {
  if (window.__autocharCaptureInstalled) return;
  window.__autocharCaptureInstalled = true;
  const pending = new Map();
  const text = (el) => (el.innerText || el.textContent || '').trim();
  const metadata = (el) => ({
    tagName: el.tagName,
    type: el.getAttribute('type') || '',
    name: el.getAttribute('name') || '',
    id: el.getAttribute('id') || '',
    label: el.getAttribute('aria-label') || text(el.closest('label') || el),
    placeholder: el.getAttribute('placeholder') || '',
    text: text(el),
    testId: el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-qa') || ''
  });
  const send = (payload) => {
    if (typeof window.__autocharCapture === 'function') {
      window.__autocharCapture(payload);
    }
  };
  const base = (type, el, value) => ({
    type,
    label: el.getAttribute('aria-label') || el.getAttribute('placeholder') || text(el) || el.name || el.id || type,
    value,
    element: metadata(el),
    url: location.href,
    title: document.title,
    timestamp: new Date().toISOString()
  });
  const flush = (el) => {
    const item = pending.get(el);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(el);
    send(item.payload);
  };
  document.addEventListener('click', (event) => {
    const el = event.target && event.target.closest ? event.target.closest('button,a,[role="button"],input,textarea,select,[data-testid],[data-test],[data-qa]') : event.target;
    if (!el) return;
    if (el.matches('input,textarea,select')) return;
    send(base('click', el, undefined));
  }, true);
  document.addEventListener('input', (event) => {
    const el = event.target;
    if (!el || !el.matches || !el.matches('input,textarea')) return;
    const isFile = (el.getAttribute('type') || '').toLowerCase() === 'file';
    const value = isFile ? Array.from(el.files || []).map((file) => file.name).join(',') : el.value;
    const payload = base(isFile ? 'fileUpload' : 'fill', el, value);
    const existing = pending.get(el);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => flush(el), 400);
    pending.set(el, { payload, timer });
  }, true);
  document.addEventListener('change', (event) => {
    const el = event.target;
    if (!el || !el.matches) return;
    flush(el);
    if (el.matches('select')) send(base('select', el, el.value));
  }, true);
  document.addEventListener('blur', (event) => flush(event.target), true);
  document.addEventListener('submit', (event) => send(base('submit', event.target, undefined)), true);
})();`;
}

function normalizeElement(input: unknown): Record<string, string | undefined> {
  if (!input || typeof input !== 'object') return {};
  const source = input as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key, typeof value === 'string' ? value : undefined])
  );
}

export function normalizeCapturedAction(raw: unknown): CapturedAction | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const input = raw as Record<string, unknown>;
  const rawType = input.type;
  const type =
    rawType === 'input' ? 'fill' : rawType === 'change' ? 'select' : typeof rawType === 'string' ? rawType : '';
  if (!['click', 'fill', 'select', 'fileUpload', 'submit'].includes(type)) {
    return null;
  }
  if (typeof input.url !== 'string' || typeof input.title !== 'string') {
    return null;
  }
  const element = normalizeElement(input.element);
  let value = typeof input.value === 'string' ? input.value : undefined;
  if (type === 'fileUpload' && value) {
    value = value
      .split(',')
      .map((item) => item.split(/[\\/]/).pop())
      .filter(Boolean)
      .join(',');
  }
  if (value && isSensitiveField(element)) {
    value = maskSensitiveValue(value);
  }
  return {
    type: type as CapturedActionType,
    label: typeof input.label === 'string' && input.label ? input.label : type,
    value,
    element,
    url: input.url,
    title: input.title,
    timestamp: typeof input.timestamp === 'string' ? input.timestamp : new Date().toISOString()
  };
}
