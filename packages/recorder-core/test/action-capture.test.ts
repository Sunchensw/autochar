import { JSDOM } from 'jsdom';
import { describe, expect, test, vi } from 'vitest';
import { buildCaptureScript } from '../src';

function installCapture(html: string) {
  const dom = new JSDOM(html, {
    url: 'https://example.test/admin/products',
    runScripts: 'outside-only'
  });
  const payloads: Array<Record<string, unknown>> = [];
  Object.defineProperty(dom.window, '__autocharCapture', {
    value: (payload: Record<string, unknown>) => payloads.push(payload),
    configurable: true
  });
  dom.window.eval(buildCaptureScript());
  return { dom, payloads };
}

function click(element: Element) {
  const view = element.ownerDocument.defaultView;
  if (!view) throw new Error('Missing window');
  element.dispatchEvent(new view.MouseEvent('click', { bubbles: true, cancelable: true }));
}

describe('buildCaptureScript', () => {
  test('captures pointerdown as a click fallback when click never arrives', async () => {
    vi.useFakeTimers();
    try {
      const { dom, payloads } = installCapture('<button id="save">Save</button>');
      const button = dom.window.document.querySelector('#save')!;

      button.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
      await vi.advanceTimersByTimeAsync(350);

      expect(payloads.at(-1)).toMatchObject({
        type: 'click',
        label: 'Save',
        element: {
          id: 'save',
          role: 'button'
        }
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test('uses composed event path to capture open shadow dom clicks', () => {
    const { dom, payloads } = installCapture('<div id="host"></div>');
    const host = dom.window.document.querySelector('#host')!;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<button id="shadow-save">Shadow save</button>';

    shadow.querySelector('button')!.dispatchEvent(
      new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, composed: true })
    );

    expect(payloads.at(-1)).toMatchObject({
      type: 'click',
      label: 'Shadow save',
      element: {
        id: 'shadow-save',
        role: 'button'
      }
    });
  });

  test('captures custom widget option clicks', () => {
    const { dom, payloads } = installCapture(`
      <div role="listbox">
        <div role="option" aria-selected="false" data-testid="status-pending">Pending review</div>
      </div>
    `);

    click(dom.window.document.querySelector('[role="option"]')!);

    expect(payloads).toHaveLength(2);
    expect(payloads[1]).toMatchObject({
      type: 'click',
      label: 'Pending review',
      element: {
        role: 'option',
        text: 'Pending review',
        testId: 'status-pending'
      }
    });
  });

  test('captures checkbox input clicks instead of ignoring all inputs', () => {
    const { dom, payloads } = installCapture(`
      <label><input id="active" type="checkbox" name="active"> Active</label>
    `);

    click(dom.window.document.querySelector('#active')!);

    expect(payloads).toHaveLength(2);
    expect(payloads[1]).toMatchObject({
      type: 'click',
      label: 'Active',
      element: {
        tagName: 'INPUT',
        type: 'checkbox',
        name: 'active',
        id: 'active'
      }
    });
  });

  test('captures contenteditable input as fill', () => {
    const { dom, payloads } = installCapture(`
      <div id="rich-title" contenteditable="true" aria-label="Product title">Old title</div>
    `);
    const editor = dom.window.document.querySelector('#rich-title')!;

    editor.textContent = 'New product title';
    editor.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    editor.dispatchEvent(new dom.window.FocusEvent('blur', { bubbles: true }));

    expect(payloads).toHaveLength(2);
    expect(payloads[1]).toMatchObject({
      type: 'fill',
      label: 'Product title',
      value: 'New product title',
      element: {
        id: 'rich-title',
        label: 'Product title',
        role: 'textbox',
        contentEditable: 'true'
      }
    });
  });

  test('reports capture readiness when the injected script installs', () => {
    const { payloads } = installCapture('<button>Save</button>');

    expect(payloads[0]).toMatchObject({
      type: 'debug',
      label: 'capture ready'
    });
  });
});
