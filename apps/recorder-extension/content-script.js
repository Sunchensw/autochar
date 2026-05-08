(() => {
  if (window.__autocharExtensionCaptureInstalled) return;
  window.__autocharExtensionCaptureInstalled = true;

  const pending = new Map();
  const pendingClicks = new WeakMap();
  const seenEvents = new WeakSet();
  const text = (el) => ((el && (el.innerText || el.textContent)) || '').replace(/\s+/g, ' ').trim();
  const attr = (el, name) => (el && el.getAttribute && el.getAttribute(name)) || '';
  const isTopFrame = () => {
    try {
      return window.top === window;
    } catch {
      return false;
    }
  };
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
    .split(/\s+/)
    .map((id) => text(document.getElementById(id)))
    .filter(Boolean)
    .join(' ');
  const labelText = (el) => {
    if (!el) return '';
    const explicit = attr(el, 'aria-label') || labelledBy(el);
    if (explicit) return explicit;
    const id = attr(el, 'id');
    if (id && window.CSS && CSS.escape) {
      const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (text(label)) return text(label);
    }
    return text(el.closest && el.closest('label'));
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
  const editableFrom = (target) => {
    const el = elementFrom(target);
    if (!el) return null;
    if (isEditable(el)) return el;
    return el.closest && el.closest('[contenteditable], [role="textbox"]');
  };
  const valueOf = (el) => {
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return el.value || '';
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
    chrome.runtime.sendMessage({
      kind: 'autochar-event',
      event: {
        ...payload,
        url: location.href,
        title: document.title,
        timestamp: new Date().toISOString(),
        viewport: {
          width: Math.round(window.innerWidth),
          height: Math.round(window.innerHeight)
        }
      }
    }).catch(() => undefined);
  };
  const base = (type, el, value) => ({
    type,
    label: labelText(el) || attr(el, 'placeholder') || text(el) || attr(el, 'value') || el.name || el.id || type,
    value,
    element: metadata(el)
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
    const { el } = clickableFrom(event);
    if (!el) return;
    if (isEditable(el) || el.matches('textarea,select')) return;
    if (el.matches('input')) {
      const type = attr(el, 'type').toLowerCase();
      if (!['button', 'submit', 'reset', 'checkbox', 'radio'].includes(type)) return;
    }
    const payload = base('click', el, undefined);
    if (source === 'pointerdown' || source === 'mousedown') {
      queueClickFallback(el, payload);
      return;
    }
    sendClick(el, payload);
  };
  const onInput = (event) => {
    if (seenEvents.has(event)) return;
    seenEvents.add(event);
    const raw = elementFromEvent(event);
    const el = editableFrom(raw) || raw;
    if (!el || !el.matches) return;
    const type = attr(el, 'type').toLowerCase();
    const isFile = el.matches('input') && type === 'file';
    if (el.matches('input') && ['checkbox', 'radio'].includes(type)) return;
    if (!isFile && !isEditable(el)) return;
    const value = isFile ? Array.from(el.files || []).map((file) => file.name).join(',') : valueOf(el);
    queueFill(el, base(isFile ? 'fileUpload' : 'fill', el, value));
  };
  const onChange = (event) => {
    if (seenEvents.has(event)) return;
    seenEvents.add(event);
    const el = elementFromEvent(event);
    if (!el || !el.matches) return;
    flush(el);
    if (el.matches('select')) send(base('select', el, el.value));
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
  const sendNavigation = (label) => {
    if (!isTopFrame()) return;
    send({
      type: 'navigation',
      label,
      element: metadata(document.documentElement || document.body)
    });
  };
  const watchNavigation = () => {
    if (!isTopFrame()) return;
    let lastUrl = location.href;
    const notifyIfChanged = (label) => {
      setTimeout(() => {
        if (location.href === lastUrl) return;
        lastUrl = location.href;
        sendNavigation(label);
      }, 50);
    };
    for (const method of ['pushState', 'replaceState']) {
      const original = history[method];
      history[method] = function autocharHistoryPatch(...args) {
        const result = original.apply(this, args);
        notifyIfChanged(method);
        return result;
      };
    }
    window.addEventListener('popstate', () => notifyIfChanged('popstate'), true);
  };
  const add = (target, type, listener) => target.addEventListener(type, listener, true);
  [window, document].forEach((target) => {
    add(target, 'pointerdown', (event) => captureClickElement(event, 'pointerdown'));
    add(target, 'mousedown', (event) => captureClickElement(event, 'mousedown'));
    add(target, 'click', (event) => captureClickElement(event, 'click'));
    add(target, 'input', onInput);
    add(target, 'change', onChange);
    add(target, 'blur', onBlur);
    add(target, 'submit', onSubmit);
  });
  watchNavigation();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => sendNavigation('Page loaded'), { once: true });
  } else {
    setTimeout(() => sendNavigation('Page loaded'), 0);
  }
})();
