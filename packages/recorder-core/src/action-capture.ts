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
  const quickDebug = (label) => {
    try {
      if (typeof window.__autocharCapture === 'function') {
        window.__autocharCapture({
          type: 'debug',
          label,
          element: { tagName: document.documentElement ? document.documentElement.tagName : 'HTML' },
          url: location.href,
          title: document.title,
          timestamp: new Date().toISOString()
        });
      }
    } catch (_) {}
  };
  if (window.__autocharCaptureInstalled) {
    quickDebug('capture already installed');
    return;
  }
  window.__autocharCaptureInstalled = true;
  const pending = new Map();
  const pendingClicks = new WeakMap();
  const seenEvents = new WeakSet();
  const text = (el) => ((el && (el.innerText || el.textContent)) || '').replace(/\\s+/g, ' ').trim();
  const attr = (el, name) => (el && el.getAttribute && el.getAttribute(name)) || '';
  const elementFrom = (target) => {
    if (!target) return null;
    if (target.nodeType === 1) return target;
    return target.parentElement || null;
  };
  const elementFromEvent = (event) => {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    for (const item of path) {
      const el = elementFrom(item);
      if (el) return el;
    }
    return elementFrom(event.target);
  };
  const labelledBy = (el) => attr(el, 'aria-labelledby')
    .split(/\\s+/)
    .map((id) => text(document.getElementById(id)))
    .filter(Boolean)
    .join(' ');
  const labelText = (el) => {
    if (!el) return '';
    const explicit = attr(el, 'aria-label') || labelledBy(el);
    if (explicit) return explicit;
    const id = attr(el, 'id');
    if (id && window.CSS && CSS.escape) {
      const label = document.querySelector('label[for="' + CSS.escape(id) + '"]');
      if (text(label)) return text(label);
    }
    return text(el.closest && el.closest('label'));
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
    if (isEditable(el)) return 'textbox';
    return '';
  };
  const isEditable = (el) => {
    if (!el || !el.matches) return false;
    const tag = (el.tagName || '').toLowerCase();
    const type = attr(el, 'type').toLowerCase();
    const contentEditable = attr(el, 'contenteditable').toLowerCase();
    if (tag === 'textarea') return true;
    if (
      el.hasAttribute &&
      el.hasAttribute('contenteditable') &&
      (contentEditable === '' || contentEditable === 'true' || contentEditable === 'plaintext-only')
    ) return true;
    if (attr(el, 'role') === 'textbox' && tag !== 'input') return true;
    if (tag !== 'input') return false;
    return !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'hidden'].includes(type);
  };
  const editableFrom = (target) => {
    const el = elementFrom(target);
    if (!el) return null;
    if (isEditable(el)) return el;
    return el.closest && el.closest('[contenteditable], [role="textbox"]');
  };
  const valueOf = (el) => {
    if ((el.tagName || '').toLowerCase() === 'input' || (el.tagName || '').toLowerCase() === 'textarea') {
      return el.value || '';
    }
    return text(el);
  };
  const metadata = (el) => ({
    tagName: (el && el.tagName) || '',
    type: attr(el, 'type'),
    name: attr(el, 'name'),
    id: attr(el, 'id'),
    label: labelText(el),
    placeholder: attr(el, 'placeholder'),
    role: roleOf(el),
    contentEditable: attr(el, 'contenteditable'),
    ariaSelected: attr(el, 'aria-selected'),
    ariaChecked: attr(el, 'aria-checked'),
    title: attr(el, 'title'),
    href: attr(el, 'href'),
    text: text(el),
    testId: attr(el, 'data-testid') || attr(el, 'data-test') || attr(el, 'data-qa')
  });
  const send = (payload) => {
    if (typeof window.__autocharCapture === 'function') {
      window.__autocharCapture(payload);
    }
  };
  const debug = (message, el) => send({
    type: 'debug',
    label: message,
    element: metadata(el || document.body),
    url: location.href,
    title: document.title,
    timestamp: new Date().toISOString()
  });
  const base = (type, el, value) => ({
    type,
    label: labelText(el) || attr(el, 'placeholder') || text(el) || attr(el, 'value') || el.name || el.id || type,
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
  const queueFill = (el, payload) => {
    const existing = pending.get(el);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => flush(el), 400);
    pending.set(el, { payload, timer });
  };
  const clickableFrom = (event) => {
    const target = elementFromEvent(event);
    const el = target && target.closest ? target.closest(clickableSelector) : target;
    return { target, el };
  };
  const sendClick = (el, payload) => {
    const pendingClick = pendingClicks.get(el);
    if (pendingClick) {
      clearTimeout(pendingClick.timer);
      pendingClicks.delete(el);
    }
    send(payload);
  };
  const queueClickFallback = (el, payload) => {
    const existing = pendingClicks.get(el);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      pendingClicks.delete(el);
      send(payload);
    }, 300);
    pendingClicks.set(el, { payload, timer });
  };
  const captureClickElement = (event, source) => {
    if (seenEvents.has(event)) return;
    seenEvents.add(event);
    const { target, el } = clickableFrom(event);
    if (!el) {
      debug('ignored ' + source + ': no clickable element', target);
      return;
    }
    if (isEditable(el) || el.matches('textarea,select')) {
      debug('ignored ' + source + ': editable focus', el);
      return;
    }
    if (el.matches('input')) {
      const type = attr(el, 'type').toLowerCase();
      if (!['button', 'submit', 'reset', 'checkbox', 'radio'].includes(type)) {
        debug('ignored ' + source + ': non-clickable input', el);
        return;
      }
    }
    const payload = base('click', el, undefined);
    if (source === 'pointerdown' || source === 'mousedown') {
      queueClickFallback(el, payload);
      return;
    }
    sendClick(el, payload);
  };
  const clickableSelector = [
    'button',
    'a[href]',
    'input',
    'summary',
    'label',
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
  const onInput = (event) => {
    if (seenEvents.has(event)) return;
    seenEvents.add(event);
    const raw = elementFromEvent(event);
    const el = editableFrom(raw) || raw;
    if (!el || !el.matches) return;
    const type = attr(el, 'type').toLowerCase();
    const isFile = el.matches('input') && type === 'file';
    if (el.matches('input') && ['checkbox', 'radio'].includes(type)) return;
    if (!isFile && !isEditable(el)) {
      debug('ignored input: not editable', el);
      return;
    }
    const value = isFile ? Array.from(el.files || []).map((file) => file.name).join(',') : valueOf(el);
    const payload = base(isFile ? 'fileUpload' : 'fill', el, value);
    queueFill(el, payload);
  };
  const onChange = (event) => {
    if (seenEvents.has(event)) return;
    seenEvents.add(event);
    const el = elementFromEvent(event);
    if (!el || !el.matches) return;
    flush(el);
    if (el.matches('select')) {
      send(base('select', el, el.value));
    } else if (!el.matches('input[type="checkbox"],input[type="radio"]')) {
      debug('ignored change: unsupported element', el);
    }
  };
  const onBlur = (event) => {
    if (seenEvents.has(event)) return;
    seenEvents.add(event);
    const target = elementFromEvent(event);
    const el = editableFrom(target) || target;
    if (el) flush(el);
  };
  const onSubmit = (event) => {
    if (seenEvents.has(event)) return;
    seenEvents.add(event);
    send(base('submit', elementFromEvent(event), undefined));
  };
  const add = (target, type, listener) => {
    target.addEventListener(type, listener, true);
  };
  [window, document].forEach((target) => {
    add(target, 'pointerdown', (event) => captureClickElement(event, 'pointerdown'));
    add(target, 'mousedown', (event) => captureClickElement(event, 'mousedown'));
    add(target, 'click', (event) => captureClickElement(event, 'click'));
    add(target, 'input', onInput);
    add(target, 'change', onChange);
    add(target, 'blur', onBlur);
    add(target, 'submit', onSubmit);
  });
  debug('capture ready', document.documentElement || document.body);
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
