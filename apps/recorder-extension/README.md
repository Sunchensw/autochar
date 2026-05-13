# Autochar Recorder Extension

该扩展用于在用户自己的 Chrome 或 Edge 中录制已授权后台页面操作，并把事件发送到 Autochar Recorder 本地接收服务。

## 使用步骤

1. 在 Autochar Recorder 中进入“扩展录制”。
2. 点击“获取扩展连接信息”。
3. 点击“打开扩展目录”。
4. 在浏览器扩展管理页开启开发者模式，加载该目录。
5. 在扩展弹窗中填写 Recorder 显示的 Receiver 和 Token。
6. 点击连接测试。
7. 回到 Recorder 点击“开始扩展录制”。
8. 用户完成页面操作后点击“停止录制”，再导出 `.autochar.md`。

扩展不会读取或导出浏览器存储。页面中出现验证码、风控或登录失效时，Recorder 会在 AI 文档中标记为人工介入。
