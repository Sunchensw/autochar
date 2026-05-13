# Autochar Recorder

Autochar Recorder 是给最终用户使用的 Electron 桌面程序。用户在已授权的后台页面完成一次真实操作录制，停止后导出一个 AI 易懂的 Markdown 文档：`<流程名>.autochar.md`。

## 使用方式

1. 安装依赖：`npm install`
2. 准备浏览器：`npm run prepare:browsers`
3. 启动桌面录制器：`npm run recorder`
4. 选择“扩展录制”或“Chromium 录制”。
5. 用户按真实业务步骤操作页面。
6. 点击“停止录制”，在“AI 文档”查看 Markdown 预览。
7. 点击“导出 .autochar.md”，把生成的文档交给你或交给 AI 理解流程。

## 输出文档

导出的 Markdown 固定包含：

- `# Autochar AI Operation Document`
- `## 基本信息`
- `## 安全边界`
- `## 页面结构摘要`
- `## 操作步骤`
- `## 变量表`
- `## 风险与人工介入`
- `## Structured Data`

每个步骤会描述动作类型、页面标题和 URL、目标元素、selector 候选、输入变量、附近文本、所在区域、风险等级和人工复核要求。

## 安全边界

- 不接入大模型 API。
- 不直接集成 Crawl4AI 运行时依赖，只参考其页面结构化和 LLM-friendly 输出思路。
- URL 默认只允许 `http://`、`https://`、`raw:`。
- hooks、自定义执行脚本、stealth、proxy、浏览器存储导出默认禁用。
- 密码值、验证码值、令牌、站点凭据、浏览器本地/会话存储不会写入文档。
- 出现验证码、风控、二次验证或登录失效时，文档会标记为人工介入。

## 开发命令

```bash
npm run typecheck
npm test
npm run build
npm run package:user
```

## 项目结构

- `apps/recorder`: Electron + React + TypeScript 桌面程序，renderer 使用 Fluent UI React。
- `apps/recorder-extension`: 用于用户本机 Chrome/Edge 的录制扩展。
- `packages/recorder-core`: 录制会话、页面结构抽取、AI Markdown 文档生成。
- `packages/shared`: 流程 schema、敏感字段和风险识别工具。
