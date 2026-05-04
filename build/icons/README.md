MVP uses Electron's default icon.

To replace the Windows icon later, place an `.ico` file in `build/icons/` and add the `icon` field to both Electron builder configs:

- `apps/recorder/electron-builder.yml`
- `apps/operator-console/electron-builder.yml`
