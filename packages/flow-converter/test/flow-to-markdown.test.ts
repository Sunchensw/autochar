import { describe, expect, test } from 'vitest';
import { flowToReviewMarkdown } from '../src';
import type { FlowPackage } from '@autochar/shared';

const flow: FlowPackage = {
  schemaVersion: '1.0.0',
  name: 'Product review flow',
  startUrl: 'https://example.test/admin',
  createdAt: '2026-01-01T00:00:00.000Z',
  steps: [
    {
      id: 'step-001',
      order: 1,
      type: 'goto',
      label: 'Open admin',
      url: 'https://example.test/admin',
      title: 'Admin',
      valuePolicy: 'notStored',
      sensitive: false,
      screenshot: 'screenshots/step-001-start.png',
      screenshotKind: 'viewport',
      riskLevel: 'low',
      requiresConfirmation: false,
      requiresManualReview: false,
      timestamp: '2026-01-01T00:00:00.000Z'
    },
    {
      id: 'step-002',
      order: 2,
      type: 'fill',
      label: 'Password',
      url: 'https://example.test/admin/login',
      title: 'Login',
      value: 'secret-password',
      valuePolicy: 'masked',
      sensitive: true,
      selectors: {
        primary: { kind: 'label', value: 'Password' },
        fallbacks: [{ kind: 'css', value: 'input#password' }]
      },
      element: { tagName: 'INPUT', type: 'password', label: 'Password', id: 'password' },
      screenshot: 'screenshots/step-002-fill.png',
      screenshotKind: 'viewport',
      riskLevel: 'low',
      requiresConfirmation: false,
      requiresManualReview: false,
      timestamp: '2026-01-01T00:00:01.000Z'
    },
    {
      id: 'step-003',
      order: 3,
      type: 'click',
      label: 'Save',
      url: 'https://example.test/admin/products/1',
      title: 'Product',
      valuePolicy: 'notStored',
      sensitive: false,
      framePath: ['iframe#product-editor'],
      selectors: {
        primary: { kind: 'role', value: 'button', role: 'button', name: 'Save' },
        fallbacks: [{ kind: 'text', value: 'Save' }]
      },
      element: { tagName: 'BUTTON', text: 'Save', role: 'button' },
      screenshot: 'screenshots/step-003-click.png',
      screenshotKind: 'viewport',
      riskLevel: 'high',
      requiresConfirmation: true,
      requiresManualReview: false,
      timestamp: '2026-01-01T00:00:02.000Z'
    }
  ]
};

describe('flowToReviewMarkdown', () => {
  test('renders review-friendly markdown and redacts sensitive values', () => {
    const markdown = flowToReviewMarkdown(flow);

    expect(markdown).toContain('# Autochar 录制流程审核');
    expect(markdown).toContain('- 流程名称: Product review flow');
    expect(markdown).toContain('## 步骤明细');
    expect(markdown).toContain('### 2. Password');
    expect(markdown).toContain('- 输入值: 已隐藏');
    expect(markdown).not.toContain('secret-password');
    expect(markdown).toContain('- 主选择器: role=button name=Save');
    expect(markdown).toContain('- iframe: iframe#product-editor');
    expect(markdown).toContain('- 截图: screenshots/step-003-click.png');
    expect(markdown).toContain('- 风险: high，需要人工确认');
  });
});
