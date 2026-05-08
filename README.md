# Autochar MVP

## Chrome/Edge 扩展录制

遇到京东等后台提示“未用认证软件”时，优先使用扩展录制入口，不要让 Playwright 新开 Chromium 登录后台。

完整操作说明见 `docs/certified-browser-backend-manual.md`。

1. 运行 `npm run recorder`。
2. 在 Autochar Recorder 中点击“开始扩展录制”。
3. 复制页面中的本地接收地址和连接令牌。
4. 在 Chrome/Edge 扩展管理页启用开发者模式，加载 `apps/recorder-extension` 这个已解压扩展目录。
5. 点击浏览器工具栏里的 Autochar Recorder 扩展图标，填入接收地址和令牌，保存并测试连接。
6. 在用户自己的、已通过平台认证的 Chrome/Edge 后台页面正常操作。
7. 回到 Autochar Recorder 点击“停止录制”，确认步骤后导出 `.flow.zip`。

扩展只采集用户操作、页面元素元数据和可见页截图；不会导出密码、验证码、token、cookie、localStorage 或 sessionStorage。

Autochar 是一个本地 Playwright 录制器和运营控制台 MVP，用于用户已获授权的电商后台自动化流程。

## 应用说明

`Autochar Recorder` 是给普通用户使用的 Windows 应用。它负责打开受控 Chromium 浏览器、录制用户手动操作、保存页面截图、填写备注，并导出 `.flow.zip` 流程包。它不包含流程转换、脚本编辑、CSV/XLSX 选择或批量执行入口。

`Autochar Operator Console` 是本人端/运营端 Windows 应用。它可以导入 `.flow.zip` 或 `flow.json`，校验流程，预览步骤截图，生成 Playwright TypeScript 初稿和可加载的 `.mjs`，选择 CSV/XLSX 数据文件，运行 dry-run，执行已确认的正式任务，并查看执行结果。

## 安全边界

- 不实现验证码、短信验证、人机验证、风控绕过、stealth、代理池或密码采集。
- 密码、验证码、token、cookie、`localStorage` 和 `sessionStorage` 默认不导出。
- 录制器不调用 `context.storageState()`，也不读取 cookie 或浏览器存储。
- 批量执行遇到验证码、风控、登录失效等关键词时会暂停并等待人工处理。
- 保存、删除、发布、改价、库存调整等高风险动作会标记为需要人工复核。

## 普通用户录制流程

1. 开发环境运行 `npm run recorder`，或安装 `release/user/Autochar-Recorder-Setup.exe`。
2. 输入已获授权的后台 URL，并打开 Chromium。
3. 点击开始录制，手动完成流程，停止录制，填写备注并导出。
4. 导出的 `.flow.zip` 包含 `flow.json`、`metadata.json`、`notes.txt` 和 `screenshots/*.png`。
5. 如果 `validateBasicFlow` 校验失败，导出会被阻止。

## 本人端操作流程

1. 开发环境运行 `npm run operator`，或安装 `release/owner/Autochar-Operator-Console-Setup.exe`。
2. 导入 `.flow.zip` 或 `flow.json`。
3. 复核校验结果、步骤 selector、敏感字段、高风险步骤和页面截图。
4. 生成 TypeScript 脚本初稿和编译后的 `.mjs`。
5. 选择 CSV/XLSX 数据文件，先运行 dry-run；只有勾选正式执行确认后，才能执行正式任务。

## 常用命令

```powershell
npm install
npm run prepare:browsers
npm run typecheck
npm test
npm run build
npm run convert -- --flow examples/product-title-flow.json --out generated/product-title-update.ts --compiled-out generated/product-title-update.mjs --function updateProductTitle
npm run batch -- --script generated/product-title-update.mjs --function updateProductTitle --input examples/product-title-update.csv --out results/result.csv --dry-run --max-rows 3
npm run package:user
npm run package:owner
```

`npm run prepare:browsers` 会把 Playwright Chromium 安装到 `ms-playwright/`。两个 Electron 应用都会通过 `extraResources` 把该目录打进安装包资源目录。

## Demo Admin

运行 `npm run demo`，然后打开 `http://localhost:4173`。本地 demo 后台提供商品搜索、编辑和保存流程，可用于验证录制器和生成脚本。

## 输出文件

用户端 EXE：

```text
release/user/Autochar-Recorder-Setup.exe
release/user/Autochar-Recorder-Portable.exe
```

本人端 EXE：

```text
release/owner/Autochar-Operator-Console-Setup.exe
release/owner/Autochar-Operator-Console-Portable.exe
```
