import { JSDOM } from 'jsdom';
import { describe, expect, test } from 'vitest';
import { buildPageContextScript } from '../src';
import type { PageContextSnapshot } from '@autochar/shared';

function capture(html: string): PageContextSnapshot {
  const dom = new JSDOM(html, {
    url: 'https://example.test/admin/product',
    runScripts: 'outside-only'
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'getBoundingClientRect', {
    value: () => ({ width: 120, height: 24, top: 0, left: 0, right: 120, bottom: 24 }),
    configurable: true
  });
  return dom.window.eval(buildPageContextScript()) as PageContextSnapshot;
}

describe('page context capture', () => {
  test('captures select options and field state for template generation', () => {
    const context = capture(`
      <form aria-label="商品属性">
        <label for="craft">主工艺</label>
        <select id="craft" name="craft" required>
          <option value="">请选择</option>
          <option value="gold" selected>足金</option>
          <option value="inlay" disabled>镶嵌</option>
        </select>
        <label><input id="male" type="checkbox" checked> 男士</label>
      </form>
    `);

    const craft = context.forms[0].fields.find((field: { name?: string }) => field.name === 'craft');
    expect(craft).toMatchObject({
      label: '主工艺',
      required: true,
      selectedText: '足金',
      options: [
        { label: '请选择', value: '', disabled: false, selected: false },
        { label: '足金', value: 'gold', disabled: false, selected: true },
        { label: '镶嵌', value: 'inlay', disabled: true, selected: false }
      ]
    });

    const checkbox = context.forms[0].fields.find((field: { id?: string }) => field.id === 'male');
    expect(checkbox).toMatchObject({
      type: 'checkbox',
      checked: true
    });
  });
});
