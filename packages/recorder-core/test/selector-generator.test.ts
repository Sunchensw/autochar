import { JSDOM } from 'jsdom';
import { describe, expect, test } from 'vitest';
import { cssEscapeValue, generateSelectorSet } from '../src';

function elementFrom(html: string, selector: string): Element {
  const dom = new JSDOM(html);
  const element = dom.window.document.querySelector(selector);
  if (!element) throw new Error(`Missing element ${selector}`);
  return element;
}

describe('generateSelectorSet', () => {
  test('prefers data-testid', () => {
    const element = elementFrom('<input data-testid="sku-input" name="sku">', 'input');
    const set = generateSelectorSet(element);
    expect(set.primary).toMatchObject({ kind: 'testId', value: 'sku-input' });
    expect(set.fallbacks.length).toBeGreaterThan(0);
  });

  test('uses placeholder selector for inputs', () => {
    const element = elementFrom('<input placeholder="请输入商品名称" name="sku">', 'input');
    const set = generateSelectorSet(element);
    expect(set.primary.kind).toBe('placeholder');
    expect(set.primary.value).toBe('请输入商品名称');
  });

  test('generates role or text selector for button', () => {
    const element = elementFrom('<button>搜索</button>', 'button');
    const set = generateSelectorSet(element);
    expect(['role', 'text']).toContain(set.primary.kind);
  });

  test('generates css fallback for unstable elements', () => {
    const element = elementFrom('<div><span>Item</span></div>', 'span');
    const set = generateSelectorSet(element);
    expect(set.fallbacks.some((item) => item.kind === 'css') || set.primary.kind === 'css').toBe(true);
  });
});

test('cssEscapeValue escapes quotes', () => {
  expect(cssEscapeValue('a"b')).toBe('a\\"b');
});
