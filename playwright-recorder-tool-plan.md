# Playwright 录制器工具 Codex 一次性实施计划

> **给 Codex 的执行要求：** 直接按本文档生成可运行的 MVP 代码。不要把本文件继续扩写成普通产品方案；执行时应创建文件、安装依赖、实现功能、补测试、运行验证命令。当前仓库可按空 Node/TypeScript 项目处理。

**目标：** 一次性生成一个本地 Playwright 操作录制器 MVP，并最终打包出两个 Windows EXE 软件：一个给普通用户使用的录制器 EXE，一个给我本人使用的运营/开发者控制台 EXE。

**架构：** 使用 npm workspaces 组织 `apps/*` 和 `packages/*`。用户端 EXE 是 Electron 录制器，只负责打开受控 Chromium、录制操作、导出流程包，不包含批量执行入口。本人端 EXE 是 Electron 运营控制台，集成流程包导入、Playwright 脚本生成、CSV/XLSX 数据选择、dry-run、正式执行、结果查看和失败截图入口。底层共享 `recorder-core`、`flow-converter`、`batch-runner`、`shared` 包。

**技术栈：** Node.js 20+、TypeScript、Electron、electron-builder、Playwright、Zod、Vitest、Express、CSV、XLSX、adm-zip、tsup、esbuild。

---

## 1. 执行边界

Codex 实现时必须遵守：

- 工具只用于用户已获授权的电商后台自动化。
- 不实现验证码、短信验证、人机验证、风控校验的绕过能力。
- 不实现 stealth 指纹伪装、代理池账号切换、自动密码采集。
- 密码、验证码、token、cookie、localStorage、sessionStorage 默认不导出。
- 用户端不调用 `context.storageState()`，不读取 cookies、localStorage、sessionStorage；MVP 默认不导出任何登录态。
- 出现验证码、短信验证、安全验证、风控校验、人机验证、滑块验证、身份验证、二次验证、登录失效、重新登录等关键词时，批量执行器必须暂停并提示人工处理。
- 保存、删除、发布、改价、库存调整等高风险动作必须在生成代码和批量执行日志中标记人工复核。

---

## 2. EXE 交付物边界

最终必须打包出两个独立的 Windows EXE 软件。

### 2.1 给普通用户使用的 EXE

**软件名：** `Autochar Recorder`

**输出文件：**

```text
release/user/Autochar-Recorder-Setup.exe
release/user/Autochar-Recorder-Portable.exe
```

**包含能力：**

- 输入已获授权的后台 URL。
- 打开 Playwright Chromium 浏览器。
- 手动登录。
- 开始录制。
- 停止录制。
- 填写流程名称和备注。
- 导出 `.flow.zip` 流程包。
- 自动把录制过程中的页面截图放入导出的流程包。
- 查看录制步骤数量、截图数量、最后一步动作、导出路径和安全提示。

**不包含能力：**

- 不包含 flow converter。
- 不包含 batch runner。
- 不包含 CSV/XLSX 批量执行入口。
- 不包含脚本编辑器。
- 不包含任何验证码、风控、登录态绕过能力。

普通用户拿到这个 EXE 后，只能录制并导出包含 `flow.json`、`metadata.json`、`screenshots/`、`notes.txt` 的流程包，不能直接批量执行后台操作。

### 2.1.1 用户端流程包质量要求

用户端 EXE 导出的 `.flow.zip` 是后续转换、复核和批量执行的输入，但 MVP 阶段只做必要质量约束，避免把第一版做得过重。

`.flow.zip` 解压后必须包含：

```text
flow.json
metadata.json
screenshots/
  step-001-start.png
  step-002-fill.png
  step-003-click.png
  final.png
notes.txt
```

质量要求：

- `flow.json` 必须通过 schema 校验。
- `flow.json` 必须包含 `schemaVersion`、`name`、`startUrl`、`createdAt`、`steps`。
- step id 必须稳定递增，例如 `step-001`、`step-002`。
- 每个交互 step 必须包含主 selector、至少一个备用 selector、元素元数据、页面 URL、页面标题、时间戳和截图引用。
- 输入类 step 必须明确 `valuePolicy`：`plain`、`masked` 或 `notStored`。
- 敏感字段必须为 `masked` 或 `notStored`，不能出现明文密码、验证码、token、cookie。
- 每个 step 的截图引用必须能在 `screenshots/` 中找到实际 PNG 文件。
- `metadata.json` 必须记录 `toolVersion`、`browser`、`viewport`、`platform`、`screenshotCount`、`containsPassword`、`containsCookies`。
- 如果基础校验失败，用户端 EXE 必须阻止导出，并提示用户重新录制或补充必要信息。

### 2.2 给我本人使用的 EXE

**软件名：** `Autochar Operator Console`

**输出文件：**

```text
release/owner/Autochar-Operator-Console-Setup.exe
release/owner/Autochar-Operator-Console-Portable.exe
```

**包含能力：**

- 导入用户发来的 `.flow.zip` 或 `flow.json`。
- 校验流程包。
- 查看步骤、截图、敏感字段和高风险动作。
- 生成 Playwright TypeScript 脚本初稿。
- 选择 CSV/XLSX 数据文件。
- 运行 dry-run。
- 执行已复核脚本。
- 暂停处理验证码、短信验证、风控、登录失效等人工介入场景。
- 查看 `result.csv`、失败原因、当前 URL、失败截图和执行耗时。

**本人端安全要求：**

- 正式执行前必须先允许 dry-run。
- 遇到 `riskLevel: "high"` 或 `requiresConfirmation: true` 的步骤时，UI 必须显示醒目的人工复核提示。
- 正式执行按钮必须要求用户勾选“我已确认目标后台、数据文件和高风险动作”。
- 批量执行默认 `maxRows=3`，用户可以手动调整。

---

## 3. 最终文件结构

Codex 应创建以下文件：

```text
package.json
tsconfig.base.json
vitest.config.ts
.gitignore
README.md

packages/shared/package.json
packages/shared/src/flow-schema.ts
packages/shared/src/sensitive.ts
packages/shared/src/risk.ts
packages/shared/src/index.ts
packages/shared/test/flow-schema.test.ts
packages/shared/test/sensitive-risk.test.ts

packages/recorder-core/package.json
packages/recorder-core/src/selector-generator.ts
packages/recorder-core/src/action-capture.ts
packages/recorder-core/src/recorder-session.ts
packages/recorder-core/src/screenshot.ts
packages/recorder-core/src/export-flow.ts
packages/recorder-core/src/index.ts
packages/recorder-core/test/selector-generator.test.ts
packages/recorder-core/test/screenshot.test.ts
packages/recorder-core/test/export-flow.test.ts

apps/recorder/package.json
apps/recorder/tsconfig.json
apps/recorder/src/main.ts
apps/recorder/src/preload.ts
apps/recorder/src/ui/index.html
apps/recorder/src/ui/app.js
apps/recorder/src/ui/style.css
apps/recorder/electron-builder.yml

packages/flow-converter/package.json
packages/flow-converter/src/cli.ts
packages/flow-converter/src/selector-to-locator.ts
packages/flow-converter/src/generate-playwright.ts
packages/flow-converter/src/index.ts
packages/flow-converter/test/generate-playwright.test.ts

apps/batch-runner/package.json
apps/batch-runner/src/cli.ts
apps/batch-runner/src/read-input.ts
apps/batch-runner/src/run-batch.ts
apps/batch-runner/src/write-result.ts
apps/batch-runner/src/manual-intervention.ts
apps/batch-runner/test/read-input.test.ts
apps/batch-runner/test/run-batch.test.ts

apps/operator-console/package.json
apps/operator-console/tsconfig.json
apps/operator-console/src/main.ts
apps/operator-console/src/preload.ts
apps/operator-console/src/ui/index.html
apps/operator-console/src/ui/app.js
apps/operator-console/src/ui/style.css
apps/operator-console/electron-builder.yml

apps/demo-admin/package.json
apps/demo-admin/src/server.ts
apps/demo-admin/src/public/index.html
apps/demo-admin/src/public/app.js
apps/demo-admin/src/public/style.css

scripts/package-user.mjs
scripts/package-owner.mjs
scripts/package-all.mjs
scripts/ensure-playwright-browsers.mjs
build/icons/README.md

examples/product-title-update.csv
examples/product-title-flow.json
```

---

## 4. 根项目任务

### Task 1: 创建 npm workspace 和基础配置

**Files:**

- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `README.md`

**实现要求：**

- 根 `package.json` 使用 npm workspaces。
- 根脚本必须包含：
  - `build`: 编译所有 workspace。
  - `test`: 运行全部 Vitest 测试。
  - `typecheck`: 对所有 workspace 执行 TypeScript 类型检查。
  - `demo`: 启动本地 demo 后台。
  - `recorder`: 构建并启动用户端 Electron 录制器。
  - `operator`: 构建并启动本人端 Electron 运营控制台。
  - `convert`: 调用 flow converter CLI。
  - `batch`: 调用 batch runner CLI。
  - `package:user`: 打包用户端 EXE。
  - `package:owner`: 打包本人端 EXE。
  - `package:all`: 同时打包两个 EXE。
- 根构建工具统一使用 `tsup`，所有 workspace 的 TypeScript 构建产物输出到 `dist/`。
- 开发期可以使用 `tsx` 启动 CLI；打包后的 EXE 和 batch runner 不能依赖 `tsx` 动态执行。
- Playwright Chromium 必须安装到仓库内固定目录 `ms-playwright/`，再通过 electron-builder `extraResources` 打进 EXE。
- 根依赖使用 workspace 内部包名引用。
- `.gitignore` 必须忽略 `node_modules/`、`dist/`、`recordings/`、`generated/`、`results/`、`.env`、`ms-playwright/`、Playwright 测试产物。
- `README.md` 必须写清楚两个 EXE 的区别、普通用户录制流程、本人端导入/转换/批量执行流程、打包命令和安全边界。

**推荐根脚本：**

```json
{
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "vitest run",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "demo": "npm run start -w @autochar/demo-admin",
    "recorder": "npm run start -w @autochar/recorder",
    "operator": "npm run start -w @autochar/operator-console",
    "convert": "npm run start -w @autochar/flow-converter --",
    "batch": "npm run start -w @autochar/batch-runner --",
    "prepare:browsers": "node scripts/ensure-playwright-browsers.mjs",
    "package:user": "node scripts/package-user.mjs",
    "package:owner": "node scripts/package-owner.mjs",
    "package:all": "node scripts/package-all.mjs"
  }
}
```

**验证命令：**

```powershell
npm install
npm run typecheck
npm test
```

**验收标准：**

- `npm install` 成功。
- `npm run typecheck` 能执行到各 workspace。
- `npm test` 能发现并运行测试文件。

---

## 5. 共享数据结构任务

### Task 2: 实现 flow schema、敏感字段检测和风险检测

**Files:**

- Create: `packages/shared/package.json`
- Create: `packages/shared/src/flow-schema.ts`
- Create: `packages/shared/src/sensitive.ts`
- Create: `packages/shared/src/risk.ts`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/test/flow-schema.test.ts`
- Create: `packages/shared/test/sensitive-risk.test.ts`

**实现要求：**

`packages/shared/src/flow-schema.ts` 必须导出：

- `selectorCandidateSchema`
- `selectorSetSchema`
- `flowStepSchema`
- `flowPackageSchema`
- `metadataSchema`
- `parseFlowPackage(input: unknown): FlowPackage`
- `parseMetadata(input: unknown): FlowMetadata`
- `validateBasicFlow(input: ValidateBasicFlowInput): FlowValidationResult`
- TypeScript 类型：
  - `SelectorCandidate`
  - `SelectorSet`
  - `FlowStep`
  - `FlowPackage`
  - `FlowMetadata`
  - `FlowValidationResult`
  - `ValidateBasicFlowInput`

`FlowStep` 支持以下动作类型：

```text
goto
click
fill
select
fileUpload
navigation
assertion
manualIntervention
```

`FlowStep` 必须支持以下字段：

```text
id
order
type
label
url
title
framePath
value
variable
valuePolicy
sensitive
selectors
element
networkHints
assertions
screenshot
screenshotKind
riskLevel
requiresConfirmation
requiresManualReview
timestamp
```

`SelectorCandidate` 必须支持以下字段：

```text
kind
value
role
name
uniqueAtRecordTime
countAtRecordTime
```

`valuePolicy` 只允许：

```text
plain
masked
notStored
```

`ValidateBasicFlowInput` 结构：

```text
flow
packageDir
```

其中 `packageDir` 可选；导出流程和本人端导入 `.flow.zip` 后必须传入解压后的目录，用于检查截图文件是否真实存在。

`packages/shared/src/sensitive.ts` 必须导出：

- `SENSITIVE_KEYWORDS`
- `maskSensitiveValue(value: string): string`
- `isSensitiveField(input: { type?: string; name?: string; id?: string; label?: string; placeholder?: string }): boolean`

敏感关键词至少包含：

```text
password
pwd
passcode
验证码
短信码
token
secret
cookie
authorization
```

`packages/shared/src/risk.ts` 必须导出：

- `RISK_KEYWORDS`
- `HIGH_RISK_ACTION_KEYWORDS`
- `detectManualIntervention(text: string): boolean`
- `detectHighRiskAction(text: string): boolean`

风险关键词至少包含：

```text
验证码
短信验证
安全验证
风控校验
人机验证
滑块验证
身份验证
二次验证
登录失效
重新登录
删除
发布
改价
库存
保存
```

`validateBasicFlow` 必须覆盖：

- step id 连续递增。
- 每个交互 step 至少有一个主 selector 和一个 fallback selector。
- 每个交互 step 有截图引用。
- 如果传入 `packageDir`，每个 step 的截图引用都必须能在 `packageDir/screenshots/` 下找到实际 PNG 文件。
- 敏感字段不能使用 `valuePolicy: "plain"`。
- 高风险动作必须设置 `riskLevel: "high"` 和 `requiresConfirmation: true`。

**测试要求：**

- 合法 `flow.json` 能通过 `parseFlowPackage`。
- 缺少 `schemaVersion` 或 `steps` 时校验失败。
- password 类型输入会被 `isSensitiveField` 识别。
- 验证码、短信验证、登录失效会被 `detectManualIntervention` 识别。
- 删除、发布、改价、库存、保存会被 `detectHighRiskAction` 识别。
- `validateBasicFlow` 能发现缺失截图、缺失 fallback selector、敏感明文。

**验证命令：**

```powershell
npm test -- packages/shared
npm run typecheck -w @autochar/shared
```

**验收标准：**

- shared 包测试全部通过。
- shared 包没有 TypeScript 类型错误。

---

## 6. Recorder Core 任务

### Task 3: 实现 selector 生成器

**Files:**

- Create: `packages/recorder-core/package.json`
- Create: `packages/recorder-core/src/selector-generator.ts`
- Create: `packages/recorder-core/src/index.ts`
- Create: `packages/recorder-core/test/selector-generator.test.ts`

**实现要求：**

`selector-generator.ts` 必须导出：

- `getElementMetadata(element: Element): Record<string, string | undefined>`
- `generateSelectorSet(element: Element): SelectorSet`
- `cssEscapeValue(value: string): string`

选择器优先级：

```text
1. data-testid / data-test / data-qa
2. role + accessible name
3. label / placeholder
4. name / id
5. button/link/menuitem 的可见文本
6. 稳定 CSS fallback
```

生成的 `SelectorSet` 必须包含：

- `primary`
- `fallbacks`

候选 selector kind 必须支持：

```text
testId
role
label
placeholder
name
id
text
css
```

**测试要求：**

- 带 `data-testid="sku-input"` 的元素优先生成 `testId`。
- 带 `placeholder="请输入商品名称"` 的 input 生成 placeholder selector。
- `<button>搜索</button>` 生成 role 或 text selector。
- 没有稳定属性的元素生成 css fallback。

**验证命令：**

```powershell
npm test -- packages/recorder-core/test/selector-generator.test.ts
```

**验收标准：**

- selector 生成测试全部通过。

### Task 4: 实现浏览器事件捕获

**Files:**

- Create: `packages/recorder-core/src/action-capture.ts`
- Modify: `packages/recorder-core/src/index.ts`

**实现要求：**

`action-capture.ts` 必须导出：

- `buildCaptureScript(): string`
- `normalizeCapturedAction(raw: unknown): CapturedAction | null`
- TypeScript 类型 `CapturedAction`

注入脚本必须在浏览器页面中监听：

- `click`
- `input`
- `change`
- `submit`

捕获结果必须包含：

```text
type
label
value
element
url
title
timestamp
```

输入捕获规则：

- 对普通输入框记录最后值。
- `input` 事件必须做 300-500ms debounce，避免每个字符都生成一个 step。
- 同一个元素连续输入必须合并为一个 `fill` step。
- 元素 `blur` 或 `change` 时必须 flush 最后一条输入。
- 对 password、验证码、短信码、token 等敏感字段记录掩码值。
- 对 select 记录选中的 value。
- 对 file input 只记录文件名，不记录完整本地路径。

**测试要求：**

- `normalizeCapturedAction` 能拒绝非法对象。
- 普通 fill action 能转换为合法结构。
- password action 的 value 被掩码。

**验证命令：**

```powershell
npm test -- packages/recorder-core
```

**验收标准：**

- action capture 测试全部通过。

### Task 5: 实现录制会话和导出 flow package

**Files:**

- Create: `packages/recorder-core/src/recorder-session.ts`
- Create: `packages/recorder-core/src/screenshot.ts`
- Create: `packages/recorder-core/src/export-flow.ts`
- Create: `packages/recorder-core/test/screenshot.test.ts`
- Create: `packages/recorder-core/test/export-flow.test.ts`
- Modify: `packages/recorder-core/src/index.ts`

**实现要求：**

`recorder-session.ts` 必须导出：

- `RecorderSession`
- `RecorderSessionOptions`
- `RecordingState`

`RecorderSession` 必须提供：

- `open(startUrl: string): Promise<void>`
- `startRecording(): Promise<void>`
- `stopRecording(): Promise<FlowPackage>`
- `exportRecording(options: ExportRecordingOptions): Promise<string>`
- `close(): Promise<void>`

`screenshot.ts` 必须导出：

- `capturePageScreenshot(options: CapturePageScreenshotOptions): Promise<string>`
- `buildStepScreenshotName(stepId: string): string`
- TypeScript 类型 `CapturePageScreenshotOptions`

截图规则：

- 用户端 EXE 录制时必须为关键页面状态保存截图。
- 打开起始 URL 后保存 `screenshots/step-001-start.png`。
- 每个用户动作被记录为 step 后，保存一张页面截图，例如 `screenshots/step-002-fill.png`、`screenshots/step-003-click.png`。
- 停止录制时保存最终页面截图，例如 `screenshots/final.png`。
- 默认保存 viewport 截图；如果实现 full-page 截图开关，默认关闭。
- 截图路径必须写入对应 step 的 `screenshot` 字段。
- `screenshotKind` 使用 `viewport` 或 `fullPage`。
- 录制过程中的截图失败不能终止录制，但必须在 `notes.txt` 中记录失败原因。
- 导出前如果关键 step 缺失截图，必须阻止导出普通 `.flow.zip`。
- 非关键截图失败可以继续导出，但必须写入 `notes.txt`。
- 截图可能包含页面可见内容，用户端导出前必须显示提示。

录制会话必须：

- 启动 Playwright Chromium。
- 在开发期从 Playwright 默认浏览器缓存启动；在打包后的 EXE 中必须从 `process.resourcesPath/ms-playwright` 启动。
- 打开用户输入的 URL。
- 用 `page.exposeBinding` 或等价方式接收页面注入脚本发回的动作。
- 在页面导航后重新注入捕获脚本。
- 为每个步骤生成递增 id：`step-001`、`step-002`。
- 保存 `goto`、`click`、`fill`、`select`、`fileUpload`、`navigation`。
- 不调用 `context.storageState()`，不读取 cookies、localStorage、sessionStorage。
- 为每个已记录步骤调用 `capturePageScreenshot`，并把返回的相对路径写入 step。
- 维护截图数量，用于用户端 UI 展示。
- 对高风险动作设置 `riskLevel: "high"` 和 `requiresConfirmation: true`。
- 对疑似脆弱 selector 设置 `requiresManualReview: true`。

`export-flow.ts` 必须导出：

- `writeFlowPackage(input: WriteFlowPackageInput): Promise<string>`
- `zipFlowPackage(packageDir: string): Promise<string>`
- TypeScript 类型 `WriteFlowPackageInput`

导出目录必须包含：

```text
flow.json
metadata.json
screenshots/
  step-001-start.png
  step-002-fill.png
  step-003-click.png
  final.png
notes.txt
```

导出流程必须按以下顺序执行：

```text
1. 写入 flow.json
2. 写入 metadata.json
3. 复制 screenshots PNG
4. 写入 notes.txt
5. 运行 `validateBasicFlow({ flow, packageDir })`
6. 确认每个 step.screenshot 指向的 PNG 都存在
7. 生成普通 .flow.zip
```

**测试要求：**

- `writeFlowPackage` 能写入 `flow.json`、`metadata.json`、`notes.txt`。
- 写出的 `flow.json` 能被 shared schema 重新解析。
- `writeFlowPackage` 会把录制阶段生成的截图复制到导出目录的 `screenshots/`。
- 如果任一交互 step 缺失截图，`writeFlowPackage` 必须返回错误并阻止导出。
- `zipFlowPackage` 能生成 `.flow.zip`。
- `.flow.zip` 内必须包含 `screenshots/` 下的 PNG 文件。

**验证命令：**

```powershell
npm test -- packages/recorder-core/test/screenshot.test.ts
npm test -- packages/recorder-core/test/export-flow.test.ts
npm run typecheck -w @autochar/recorder-core
```

**验收标准：**

- recorder-core 包测试全部通过。
- 录制核心没有 TypeScript 类型错误。
- 导出的 flow package 中实际包含页面截图 PNG。
- 导出的 flow package 必须通过 `validateBasicFlow`。

---

## 7. 用户端 Electron 录制器任务

### Task 6: 实现用户端录制器 EXE 应用

**Files:**

- Create: `apps/recorder/package.json`
- Create: `apps/recorder/tsconfig.json`
- Create: `apps/recorder/src/main.ts`
- Create: `apps/recorder/src/preload.ts`
- Create: `apps/recorder/src/ui/index.html`
- Create: `apps/recorder/src/ui/app.js`
- Create: `apps/recorder/src/ui/style.css`
- Create: `apps/recorder/electron-builder.yml`

**实现要求：**

UI 必须包含：

- 后台 URL 输入框。
- “打开浏览器”按钮。
- “开始录制”按钮。
- “停止录制”按钮。
- “导出流程包”按钮。
- 流程名称输入框。
- 备注输入框。
- 状态栏：显示当前状态、步骤数量、截图数量、最后一步动作。
- 基础校验状态：显示 `未校验`、`通过` 或 `失败`。
- 基础问题列表：显示缺失截图、selector 不足、敏感字段风险等。
- 最近页面截图预览区域。
- 安全提示：说明不会保存明文密码和验证码。
- 截图提示：说明导出的页面截图可能包含当前页面可见内容，导出前需要用户确认。

Electron main 进程必须实现 IPC：

- `recorder:open`
- `recorder:start`
- `recorder:stop`
- `recorder:export`
- `recorder:close`
- `recorder:get-preview-screenshot`

`apps/recorder/package.json` 必须包含：

- `name`: `@autochar/recorder`
- `productName`: `Autochar Recorder`
- `main`: `dist/main.js`
- `scripts.build`: 编译 TypeScript 到 `dist/`
- `scripts.start`: 先 build，再启动 Electron。
- `scripts.dist:setup`: 使用 electron-builder 打包安装版。
- `scripts.dist:portable`: 使用 electron-builder 打包 portable 版。
- `build` 必须使用 `tsup`，输出 CommonJS main/preload 到 `dist/`。

`apps/recorder/electron-builder.yml` 必须：

- 设置 `appId: com.autochar.recorder`
- 设置 `productName: Autochar Recorder`
- 输出到 `../../release/user`
- 生成 `nsis` 安装包和 `portable` 可执行文件。
- artifact 名称分别包含 `Autochar-Recorder-Setup` 和 `Autochar-Recorder-Portable`。
- 只打包用户端录制器所需文件，不暴露 converter、batch runner 和 owner console UI。
- `files` 只包含 `dist/**`、`src/ui/**`、必要的 `package.json` 和生产依赖。
- `extraResources` 必须把仓库根目录的 `ms-playwright/` 复制到安装包资源目录 `ms-playwright/`。
- 用户端运行时必须设置 `process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.resourcesPath, 'ms-playwright')`。
- 如果启动时找不到 Chromium，UI 必须提示“浏览器资源缺失，请重新安装 Autochar Recorder”。
- 不要把 `examples/`、`generated/`、`results/`、owner console UI 或 batch runner UI 打进用户端 EXE。

UI 行为：

- 未打开浏览器前禁用开始录制。
- 未开始录制前禁用停止录制。
- 停止录制后允许导出。
- 如果本次录制没有任何截图，导出按钮必须提示用户重新录制或继续导出无截图包。
- 导出前必须弹出确认，提示 `.flow.zip` 将包含页面截图。
- 导出前必须先运行基础校验。
- 基础校验失败时，禁止导出普通 `.flow.zip`。
- 导出成功后显示导出路径。
- 导出成功后显示截图数量和 `screenshots/` 已写入流程包。
- 导出成功后显示基础校验通过。
- 发生错误时在状态栏显示错误消息。

**验证命令：**

```powershell
npm run build -w @autochar/recorder
npm run recorder
npm run package:user
```

**验收标准：**

- Electron 窗口能打开。
- 用户能输入 URL 并打开 Playwright Chromium。
- 用户能开始录制、停止录制并导出 flow package。
- 导出的 `.flow.zip` 中包含 `screenshots/` 目录和页面截图 PNG。
- 用户端 UI 能显示基础校验状态。
- `release/user/` 下生成用户端安装版和 portable 版 EXE。

---

## 8. Flow Converter 任务

### Task 7: 实现 flow 到 Playwright 脚本转换

**Files:**

- Create: `packages/flow-converter/package.json`
- Create: `packages/flow-converter/src/selector-to-locator.ts`
- Create: `packages/flow-converter/src/generate-playwright.ts`
- Create: `packages/flow-converter/src/cli.ts`
- Create: `packages/flow-converter/src/index.ts`
- Create: `packages/flow-converter/test/generate-playwright.test.ts`

**实现要求：**

`selector-to-locator.ts` 必须导出：

- `selectorCandidateToLocator(candidate: SelectorCandidate): string`
- `selectorSetToLocator(selectorSet: SelectorSet): string`

转换规则：

- `testId` -> `page.getByTestId('...')`
- `role` -> `page.getByRole('button', { name: '...' })`
- `label` -> `page.getByLabel('...')`
- `placeholder` -> `page.getByPlaceholder('...')`
- `text` -> `page.getByText('...')`
- `css` -> `page.locator('...')`

`generate-playwright.ts` 必须导出：

- `generatePlaywrightScript(flow: FlowPackage, options: GenerateOptions): string`
- `compileGeneratedScript(input: CompileGeneratedScriptInput): Promise<string>`

生成代码必须：

- 导入 `Page` 和 `expect`。
- 导出 row 类型。
- 导出一个 async 函数。
- 对 `goto` 生成 `await page.goto(...)`。
- 对 `fill` 使用 `row.variableName` 或固定值。
- 对 `click` 使用 locator click。
- 对有 `networkHints` 的步骤生成 `Promise.all([page.waitForResponse(...), action])`。
- 对 `assertions` 生成 `expect`。
- 对 `riskLevel: "high"` 或 `requiresConfirmation: true` 生成人工复核注释。
- 对 `requiresManualReview: true` 生成人工复核注释。

CLI 必须支持：

```powershell
npm run convert -- --flow examples/product-title-flow.json --out generated/product-title-update.ts --compiled-out generated/product-title-update.mjs --function updateProductTitle
```

转换规则：

- converter 先生成可读的 TypeScript 初稿 `.ts`。
- converter 再使用 `esbuild` 把 `.ts` 编译为 batch runner 可加载的 `.mjs`。
- 本人端和 batch runner 只执行 `.mjs`，不能直接执行 `.ts`。
- 生成目录默认位于用户数据目录或仓库 `generated/`，不得从 `.flow.zip` 内直接执行任何代码。

**测试要求：**

- 能把示例 flow 生成 TypeScript 文件。
- 能把生成的 TypeScript 编译为 `.mjs`。
- 生成文件包含 `updateProductTitle`。
- 生成文件包含 `page.getByPlaceholder('请输入商品名称')`。
- 高风险保存步骤会生成人工复核注释。

**验证命令：**

```powershell
npm test -- packages/flow-converter
npm run typecheck -w @autochar/flow-converter
```

**验收标准：**

- converter 包测试全部通过。
- CLI 能从 `examples/product-title-flow.json` 生成 `generated/product-title-update.ts` 和 `generated/product-title-update.mjs`。

---

## 9. Batch Runner 任务

### Task 8: 实现 CSV/XLSX 批量执行器

**Files:**

- Create: `apps/batch-runner/package.json`
- Create: `apps/batch-runner/src/read-input.ts`
- Create: `apps/batch-runner/src/write-result.ts`
- Create: `apps/batch-runner/src/manual-intervention.ts`
- Create: `apps/batch-runner/src/run-batch.ts`
- Create: `apps/batch-runner/src/cli.ts`
- Create: `apps/batch-runner/test/read-input.test.ts`
- Create: `apps/batch-runner/test/run-batch.test.ts`

**实现要求：**

`read-input.ts` 必须导出：

- `readRows(filePath: string): Promise<Record<string, string>[]>`

支持：

- `.csv`
- `.xlsx`

`write-result.ts` 必须导出：

- `writeCsvResults(results: BatchResult[], outputPath: string): Promise<void>`

结果字段：

```text
row
status
message
currentUrl
screenshot
time
durationMs
```

`manual-intervention.ts` 必须导出：

- `pageNeedsManualIntervention(page: Page): Promise<boolean>`
- `waitForManualResume(message: string): Promise<void>`

`run-batch.ts` 必须导出：

- `runBatch(options: BatchRunOptions): Promise<BatchResult[]>`

批量执行规则：

- 默认串行执行。
- 支持 `dryRun`。
- 支持 `maxRows`。
- 支持 `startRow`。
- 支持 `failFast`。
- 每行失败时保存截图到 `results/screenshots/row-XXX-error.png`。
- 单行失败默认继续下一行。
- 检测到人工介入关键词时暂停，等待用户在终端按 Enter 后继续。

CLI 必须支持：

```powershell
npm run batch -- --script generated/product-title-update.mjs --function updateProductTitle --input examples/product-title-update.csv --out results/result.csv --dry-run --max-rows 3
```

脚本加载规则：

- `--script` 只接受 `.mjs` 文件。
- 如果传入 `.ts`、`.js` 或其他扩展名，CLI 必须报错并提示先使用 converter 生成 `.mjs`。
- batch runner 不从 `.flow.zip` 中直接加载或执行任何代码。

**测试要求：**

- 能读取 CSV。
- 能读取 XLSX。
- 单行失败时继续下一行。
- fail-fast 开启时第一行失败后停止。
- dry-run 时不调用真实脚本函数，只输出 skipped/dry-run 结果。

**验证命令：**

```powershell
npm test -- apps/batch-runner
npm run typecheck -w @autochar/batch-runner
```

**验收标准：**

- batch-runner 包测试全部通过。
- CLI 能读取 `examples/product-title-update.csv` 并输出 `results/result.csv`。

---

## 10. 本人端 Electron 运营控制台任务

### Task 9: 实现本人端 Operator Console EXE 应用

**Files:**

- Create: `apps/operator-console/package.json`
- Create: `apps/operator-console/tsconfig.json`
- Create: `apps/operator-console/src/main.ts`
- Create: `apps/operator-console/src/preload.ts`
- Create: `apps/operator-console/src/ui/index.html`
- Create: `apps/operator-console/src/ui/app.js`
- Create: `apps/operator-console/src/ui/style.css`
- Create: `apps/operator-console/electron-builder.yml`

**实现要求：**

本人端 UI 必须包含：

- 导入 `.flow.zip` 或 `flow.json` 的按钮。
- 流程校验结果区域。
- 基础校验区域，显示缺失截图、selector 不足、敏感字段风险等问题。
- 步骤列表，显示 step id、type、label、selector、是否敏感、是否高风险。
- 截图预览区域，能从用户端 `.flow.zip` 的 `screenshots/` 目录加载对应步骤截图。
- “生成 Playwright 脚本”按钮。
- 生成脚本输出路径显示。
- CSV/XLSX 数据文件选择按钮。
- dry-run 开关。
- max rows 输入框，默认值为 `3`。
- start row 输入框，默认值为 `1`。
- fail-fast 开关。
- 正式执行确认 checkbox，文案为 `我已确认目标后台、数据文件和高风险动作`。
- “运行 dry-run”按钮。
- “正式执行”按钮。
- 结果表区域，显示 row、status、message、screenshot、durationMs。
- 安全提示区域，显示验证码、风控、登录失效时需要人工处理。

Electron main 进程必须实现 IPC：

- `owner:import-flow`
- `owner:validate-flow`
- `owner:generate-script`
- `owner:select-input`
- `owner:run-dry-run`
- `owner:run-batch`
- `owner:open-result`
- `owner:open-screenshot`

本人端应用必须复用：

- `@autochar/shared`
- `@autochar/flow-converter`
- `@autochar/batch-runner`

本人端脚本生成和执行规则：

- 生成的 `.ts` 和 `.mjs` 必须保存到用户数据目录，例如 `%APPDATA%/Autochar/generated/`；开发期可以保存到仓库 `generated/`。
- 本人端必须调用 flow converter 先生成 `.ts` 初稿，再编译出 `.mjs`。
- 本人端 dry-run 和正式执行只加载 `.mjs`。
- 本人端不能从 `.flow.zip` 里直接执行任何代码。

本人端限制：

- 未导入合法 flow 前，禁用生成脚本和执行按钮。
- 未通过基础校验前，禁用生成脚本、dry-run 和正式执行按钮。
- 未选择 CSV/XLSX 前，禁用 dry-run 和正式执行按钮。
- 未完成 dry-run 前，正式执行按钮保持禁用。
- 未勾选正式执行确认 checkbox 前，正式执行按钮保持禁用。
- 检测到高风险步骤时，必须在 UI 中显示醒目提示。
- 检测到敏感字段时，必须提示敏感数据不会明文导出。
- 如果基础校验失败，本人端必须拒绝执行，只允许查看问题信息。

`apps/operator-console/package.json` 必须包含：

- `name`: `@autochar/operator-console`
- `productName`: `Autochar Operator Console`
- `main`: `dist/main.js`
- `scripts.build`: 编译 TypeScript 到 `dist/`
- `scripts.start`: 先 build，再启动 Electron。
- `scripts.dist:setup`: 使用 electron-builder 打包安装版。
- `scripts.dist:portable`: 使用 electron-builder 打包 portable 版。
- `build` 必须使用 `tsup`，输出 CommonJS main/preload 到 `dist/`。

`apps/operator-console/electron-builder.yml` 必须：

- 设置 `appId: com.autochar.operator`
- 设置 `productName: Autochar Operator Console`
- 输出到 `../../release/owner`
- 生成 `nsis` 安装包和 `portable` 可执行文件。
- artifact 名称分别包含 `Autochar-Operator-Console-Setup` 和 `Autochar-Operator-Console-Portable`。
- 打包 owner console 所需的 converter、batch runner、shared 依赖。
- `files` 只包含 `dist/**`、`src/ui/**`、必要的 `package.json` 和生产依赖。
- `extraResources` 必须把仓库根目录的 `ms-playwright/` 复制到安装包资源目录 `ms-playwright/`。
- 本人端运行时必须设置 `process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.resourcesPath, 'ms-playwright')`。
- 不要把用户端 recorder UI、`examples/`、`generated/`、`results/` 打进本人端 EXE。

**验证命令：**

```powershell
npm run build -w @autochar/operator-console
npm run operator
npm run package:owner
```

**验收标准：**

- Electron 窗口能打开。
- 可以导入 `examples/product-title-flow.json`。
- 可以导入包含 `flow.json`、`metadata.json`、`screenshots/`、`notes.txt` 的 `.flow.zip`。
- 可以拒绝基础校验失败的流程包。
- 可以生成 `generated/product-title-update.ts`。
- 可以选择 `examples/product-title-update.csv`。
- 可以运行 dry-run 并生成 `results/result.csv`。
- 正式执行按钮有 dry-run 和 checkbox 双重保护。
- `release/owner/` 下生成本人端安装版和 portable 版 EXE。

---

## 11. Demo Admin 任务

### Task 10: 实现本地 demo 电商后台

**Files:**

- Create: `apps/demo-admin/package.json`
- Create: `apps/demo-admin/src/server.ts`
- Create: `apps/demo-admin/src/public/index.html`
- Create: `apps/demo-admin/src/public/app.js`
- Create: `apps/demo-admin/src/public/style.css`
- Create: `examples/product-title-update.csv`
- Create: `examples/product-title-flow.json`

**实现要求：**

demo 后台必须提供：

- 商品列表页面。
- SKU 搜索输入框，placeholder 为 `请输入商品名称`。
- “搜索”按钮。
- 商品结果列表。
- 每行有“编辑”按钮。
- 编辑表单包含 `input[name="title"]`。
- “保存”按钮。
- 保存后显示 `保存成功`。

Express API：

- `GET /` 返回静态页面。
- `GET /api/products?sku=10001` 返回商品。
- `POST /api/products/:sku` 修改标题。

示例 CSV：

```csv
sku,newTitle
10001,春季新品标题
10002,夏季新品标题
10003,促销商品标题
```

示例 `examples/product-title-flow.json` 必须能被 shared schema 解析，并描述以下流程：

```text
打开商品列表页
输入商品关键词
点击搜索
点击编辑
输入新标题
点击保存
验证保存成功
```

示例流程包相关文件必须同时创建：

```text
examples/product-title-flow-package/
  flow.json
  metadata.json
  screenshots/
    step-001-start.png
    step-002-fill.png
    step-003-click.png
    final.png
  notes.txt
```

示例流程包必须能通过 `validateBasicFlow`。

**验证命令：**

```powershell
npm run demo
```

**验收标准：**

- 打开 `http://localhost:4173` 后可以手动完成搜索、编辑、保存。
- `examples/product-title-flow.json` 能被 converter 生成脚本。
- `examples/product-title-flow-package/` 能通过基础流程包校验。

---

## 12. EXE 打包任务

### Task 11: 实现两个 EXE 的打包脚本

**Files:**

- Create: `scripts/package-user.mjs`
- Create: `scripts/package-owner.mjs`
- Create: `scripts/package-all.mjs`
- Create: `scripts/ensure-playwright-browsers.mjs`
- Create: `build/icons/README.md`
- Modify: `package.json`
- Modify: `.gitignore`

**实现要求：**

`scripts/ensure-playwright-browsers.mjs` 必须：

- 使用 `node:child_process` 的 `spawnSync` 执行命令。
- 设置环境变量 `PLAYWRIGHT_BROWSERS_PATH=ms-playwright`。
- 执行 `npx playwright install chromium`。
- 安装完成后检查 `ms-playwright/` 目录存在。
- 如果 Chromium 安装失败，脚本必须退出非 0。

`scripts/package-user.mjs` 必须：

- 使用 `node:child_process` 的 `spawnSync` 执行命令。
- 先运行 `node scripts/ensure-playwright-browsers.mjs`。
- 先运行 `npm run build -w @autochar/shared`。
- 再运行 `npm run build -w @autochar/recorder-core`。
- 再运行 `npm run build -w @autochar/recorder`。
- 再运行 `npm run dist:setup -w @autochar/recorder`。
- 再运行 `npm run dist:portable -w @autochar/recorder`。
- 最后检查 `release/user/` 下存在包含 `Autochar-Recorder` 的 `.exe` 文件。
- 如果任何命令失败，脚本必须退出非 0。

`scripts/package-owner.mjs` 必须：

- 使用 `node:child_process` 的 `spawnSync` 执行命令。
- 先运行 `node scripts/ensure-playwright-browsers.mjs`。
- 先运行 `npm run build -w @autochar/shared`。
- 再运行 `npm run build -w @autochar/flow-converter`。
- 再运行 `npm run build -w @autochar/batch-runner`。
- 再运行 `npm run build -w @autochar/operator-console`。
- 再运行 `npm run dist:setup -w @autochar/operator-console`。
- 再运行 `npm run dist:portable -w @autochar/operator-console`。
- 最后检查 `release/owner/` 下存在包含 `Autochar-Operator-Console` 的 `.exe` 文件。
- 如果任何命令失败，脚本必须退出非 0。

`scripts/package-all.mjs` 必须：

- 依次调用 `scripts/package-user.mjs` 和 `scripts/package-owner.mjs`。
- 输出两个 EXE 的最终路径。

根 `.gitignore` 必须忽略：

```text
release/
```

`build/icons/README.md` 必须说明：

- MVP 可以先使用 Electron 默认图标。
- 后续要替换 Windows 图标时，把 `.ico` 放到 `build/icons/`，并在两个 `electron-builder.yml` 中配置 `icon`。

**验证命令：**

```powershell
npm run package:user
npm run package:owner
npm run package:all
```

**验收标准：**

- `npm run package:user` 生成用户端 EXE。
- `npm run package:owner` 生成本人端 EXE。
- `npm run package:all` 能连续生成两个 EXE。
- 用户端 EXE 不暴露批量执行入口。
- 本人端 EXE 包含导入、转换、dry-run、正式执行和结果查看入口。

---

## 13. 端到端验证任务

### Task 12: 运行完整 MVP 和 EXE 打包验证

**执行顺序：**

1. 安装依赖。

```powershell
npm install
```

2. 安装 Playwright Chromium 到本地打包目录。

```powershell
npm run prepare:browsers
```

3. 运行类型检查。

```powershell
npm run typecheck
```

4. 运行测试。

```powershell
npm test
```

5. 构建所有 workspace。

```powershell
npm run build
```

6. 从示例 flow 生成 Playwright 脚本和可执行 `.mjs`。

```powershell
npm run convert -- --flow examples/product-title-flow.json --out generated/product-title-update.ts --compiled-out generated/product-title-update.mjs --function updateProductTitle
```

7. 确认生成文件存在。

```powershell
Test-Path .\generated\product-title-update.ts
Test-Path .\generated\product-title-update.mjs
```

8. 运行 batch dry-run。

```powershell
npm run batch -- --script generated/product-title-update.mjs --function updateProductTitle --input examples/product-title-update.csv --out results/result.csv --dry-run --max-rows 3
```

9. 确认结果文件存在。

```powershell
Test-Path .\results\result.csv
```

10. 打包用户端 EXE。

```powershell
npm run package:user
```

11. 确认用户端 EXE 存在。

```powershell
Get-ChildItem .\release\user\*.exe
```

12. 打包本人端 EXE。

```powershell
npm run package:owner
```

13. 确认本人端 EXE 存在。

```powershell
Get-ChildItem .\release\owner\*.exe
```

**验收标准：**

- `npm run typecheck` 退出码为 0。
- `npm test` 退出码为 0。
- `npm run build` 退出码为 0。
- converter 能生成 `generated/product-title-update.ts` 和 `generated/product-title-update.mjs`。
- batch dry-run 能生成 `results/result.csv`。
- 示例流程包能通过 `validateBasicFlow`。
- `npm run package:user` 能生成用户端 EXE。
- `npm run package:owner` 能生成本人端 EXE。
- README 中有两个 EXE 的区别、用户录制、本人端导入/转换/批量执行、打包命令和安全边界。

---

## 14. Codex 一次性执行提示

把下面这段作为 Codex 的实际执行提示使用：

```text
请按 playwright-recorder-tool-plan.md 一次性生成完整 MVP 代码。

要求：
1. 当前仓库按空 Node/TypeScript 项目处理。
2. 创建 npm workspaces 项目，包含 shared、recorder-core、flow-converter、batch-runner、demo-admin、recorder、operator-console。
3. 实现文档列出的所有文件、导出函数、CLI 参数、示例数据和测试。
4. 不实现验证码、短信验证、人机验证、风控绕过、stealth、代理池、密码采集。
5. 密码、验证码、token、cookie、localStorage、sessionStorage 默认不导出。
6. 用户端 EXE 是 Autochar Recorder，只包含录制、停止、备注、页面截图、导出 flow package，不包含批量执行入口。
7. 用户端导出的 `.flow.zip` 必须包含 `flow.json`、`metadata.json`、`notes.txt` 和 `screenshots/` 页面截图 PNG。
8. 每个关键 step 必须包含主备 selector、页面 URL、页面标题、valuePolicy、截图引用；流程包必须通过 `validateBasicFlow`。
9. 本人端 EXE 是 Autochar Operator Console，包含导入 flow package、基础校验、查看步骤截图、生成脚本、选择 CSV/XLSX、dry-run、正式执行和结果查看。
10. converter 能把 examples/product-title-flow.json 转为 Playwright TypeScript 初稿，并编译为 batch runner 可加载的 .mjs。
11. batch runner 能读取 CSV/XLSX，只接受 .mjs 脚本，支持 dry-run、max-rows、start-row、fail-fast、失败截图和 result.csv。
12. demo-admin 能在 localhost:4173 提供商品搜索、编辑、保存流程。
13. 实现 electron-builder 配置和 scripts/ensure-playwright-browsers.mjs、scripts/package-user.mjs、scripts/package-owner.mjs、scripts/package-all.mjs。
14. Playwright Chromium 必须安装到 ms-playwright/ 并通过 electron-builder extraResources 打进两个 EXE。
15. 完成后运行 npm install、npm run prepare:browsers、npm run typecheck、npm test、npm run build、npm run package:user、npm run package:owner，并报告结果和 EXE 路径。
```
