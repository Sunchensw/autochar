import { describe, expect, test } from 'vitest';
import { ExtensionReceiverServer } from '../src/extension-receiver';

describe('ExtensionReceiverServer', () => {
  test('accepts authorized extension events and forwards them to the recorder', async () => {
    const received: unknown[] = [];
    const receiver = new ExtensionReceiverServer({
      preferredPort: 0,
      token: 'test-token',
      onEvent: async (event) => {
        received.push(event);
      }
    });
    await receiver.start();

    try {
      const response = await fetch(`${receiver.info().receiverUrl}/events`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-autochar-token': 'test-token'
        },
        body: JSON.stringify({
          type: 'click',
          label: 'Search',
          url: 'https://shop.jd.com/admin/products',
          title: 'Products'
        })
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(received).toEqual([
        {
          type: 'click',
          label: 'Search',
          url: 'https://shop.jd.com/admin/products',
          title: 'Products'
        }
      ]);
    } finally {
      await receiver.close();
    }
  });

  test('rejects extension events without the receiver token', async () => {
    const received: unknown[] = [];
    const receiver = new ExtensionReceiverServer({
      preferredPort: 0,
      token: 'test-token',
      onEvent: async (event) => {
        received.push(event);
      }
    });
    await receiver.start();

    try {
      const response = await fetch(`${receiver.info().receiverUrl}/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'click',
          label: 'Search',
          url: 'https://shop.jd.com/admin/products',
          title: 'Products'
        })
      });

      expect(response.status).toBe(401);
      expect(received).toEqual([]);
    } finally {
      await receiver.close();
    }
  });

  test('returns health and CORS preflight responses for extension setup checks', async () => {
    const receiver = new ExtensionReceiverServer({
      preferredPort: 0,
      token: 'test-token',
      onEvent: async () => undefined
    });
    await receiver.start();

    try {
      const health = await fetch(`${receiver.info().receiverUrl}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({ ok: true, mode: 'extension-receiver' });

      const preflight = await fetch(`${receiver.info().receiverUrl}/events`, {
        method: 'OPTIONS',
        headers: {
          origin: 'chrome-extension://autochar',
          'access-control-request-method': 'POST'
        }
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
      expect(preflight.headers.get('access-control-allow-headers')).toContain('x-autochar-token');
    } finally {
      await receiver.close();
    }
  });
});
