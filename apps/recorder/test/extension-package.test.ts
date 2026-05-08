import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const extensionDir = path.resolve(__dirname, '..', '..', 'recorder-extension');

describe('recorder extension package', () => {
  test('ships a Manifest V3 extension with local receiver permissions', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background.service_worker).toBe('background.js');
    expect(manifest.action.default_popup).toBe('popup.html');
    expect(manifest.host_permissions).toContain('http://127.0.0.1:*/*');
    expect(manifest.host_permissions).toContain('http://localhost:*/*');
    expect(manifest.content_scripts[0]).toMatchObject({
      matches: ['<all_urls>'],
      js: ['content-script.js'],
      all_frames: true
    });
  });

  test('includes all files referenced by the extension manifest', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
    const referenced = [
      manifest.background.service_worker,
      manifest.action.default_popup,
      ...manifest.content_scripts.flatMap((script: { js: string[] }) => script.js)
    ];

    for (const file of referenced) {
      expect(fs.existsSync(path.join(extensionDir, file))).toBe(true);
    }
  });
});
