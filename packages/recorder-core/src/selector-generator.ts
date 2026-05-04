import type { SelectorCandidate, SelectorSet } from '@autochar/shared';

export function cssEscapeValue(value: string): string {
  return value.replace(/["\\]/g, '\\$&').replace(/\n/g, '\\a ');
}

function textOf(element: Element): string | undefined {
  const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
  return text || undefined;
}

function attr(element: Element, name: string): string | undefined {
  return element.getAttribute(name) || undefined;
}

function labelFor(element: Element): string | undefined {
  const aria = attr(element, 'aria-label');
  if (aria) {
    return aria;
  }
  const id = attr(element, 'id');
  if (id && element.ownerDocument) {
    const label = element.ownerDocument.querySelector(`label[for="${cssEscapeValue(id)}"]`);
    if (label?.textContent?.trim()) {
      return label.textContent.trim();
    }
  }
  const wrappingLabel = element.closest('label');
  return wrappingLabel?.textContent?.trim() || undefined;
}

function inferRole(element: Element): string | undefined {
  const explicit = attr(element, 'role');
  if (explicit) {
    return explicit;
  }
  const tag = element.tagName.toLowerCase();
  const type = attr(element, 'type')?.toLowerCase();
  if (tag === 'button') return 'button';
  if (tag === 'a' && attr(element, 'href')) return 'link';
  if (tag === 'select') return 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'input') {
    if (['button', 'submit', 'reset'].includes(type ?? '')) return 'button';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    return 'textbox';
  }
  return undefined;
}

function countCss(element: Element, selector: string): number | undefined {
  try {
    return element.ownerDocument?.querySelectorAll(selector).length;
  } catch {
    return undefined;
  }
}

function candidate(
  kind: SelectorCandidate['kind'],
  value: string,
  element: Element,
  extra: Partial<SelectorCandidate> = {}
): SelectorCandidate {
  const count = kind === 'css' ? countCss(element, value) : undefined;
  return {
    kind,
    value,
    uniqueAtRecordTime: count === undefined ? undefined : count === 1,
    countAtRecordTime: count,
    ...extra
  };
}

function cssFallback(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const id = attr(element, 'id');
  if (id) {
    return `${tag}#${cssEscapeValue(id)}`;
  }
  const name = attr(element, 'name');
  if (name) {
    return `${tag}[name="${cssEscapeValue(name)}"]`;
  }
  const testId = attr(element, 'data-testid') || attr(element, 'data-test') || attr(element, 'data-qa');
  if (testId) {
    return `${tag}[data-testid="${cssEscapeValue(testId)}"]`;
  }
  const parent = element.parentElement;
  if (!parent) {
    return tag;
  }
  const siblings = Array.from(parent.children).filter((child) => child.tagName === element.tagName);
  const index = siblings.indexOf(element) + 1;
  return `${parent.tagName.toLowerCase()} > ${tag}:nth-of-type(${Math.max(index, 1)})`;
}

export function getElementMetadata(element: Element): Record<string, string | undefined> {
  return {
    tagName: element.tagName,
    type: attr(element, 'type'),
    name: attr(element, 'name'),
    id: attr(element, 'id'),
    label: labelFor(element),
    placeholder: attr(element, 'placeholder'),
    role: inferRole(element),
    text: textOf(element),
    testId: attr(element, 'data-testid') || attr(element, 'data-test') || attr(element, 'data-qa')
  };
}

export function generateSelectorSet(element: Element): SelectorSet {
  const metadata = getElementMetadata(element);
  const candidates: SelectorCandidate[] = [];
  const testId = metadata.testId;
  const role = metadata.role;
  const accessibleName = metadata.label || metadata.text || attr(element, 'value');
  const placeholder = metadata.placeholder;
  const name = metadata.name;
  const id = metadata.id;
  const text = metadata.text;
  const fallback = cssFallback(element);

  if (testId) candidates.push(candidate('testId', testId, element));
  if (role && accessibleName) {
    candidates.push(candidate('role', role, element, { role, name: accessibleName }));
  }
  if (metadata.label) candidates.push(candidate('label', metadata.label, element));
  if (placeholder) candidates.push(candidate('placeholder', placeholder, element));
  if (name) candidates.push(candidate('name', name, element));
  if (id) candidates.push(candidate('id', id, element));
  if (text && ['button', 'link', 'menuitem'].includes(role ?? '')) {
    candidates.push(candidate('text', text, element));
  }
  candidates.push(candidate('css', fallback, element));

  const deduped = candidates.filter(
    (item, index, list) => list.findIndex((other) => other.kind === item.kind && other.value === item.value) === index
  );

  return {
    primary: deduped[0],
    fallbacks: deduped.slice(1)
  };
}
