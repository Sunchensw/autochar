# Autochar Recorder Bridge

这是 Autochar Recorder 的 Chrome/Edge 扩展录制入口。它让用户在自己已经通过平台认证的浏览器里操作后台，并把用户动作发送到本机 Autochar Recorder。

## 使用

1. 打开 Autochar Recorder，点击“开始扩展录制”。
2. 在 Recorder 页面复制“本地接收地址”和“连接令牌”。
3. 在 Chrome/Edge 打开扩展管理页，启用开发者模式，选择“加载已解压的扩展程序”，选择本目录。
4. 点击浏览器工具栏里的 Autochar Recorder 扩展图标，填入接收地址和令牌，点击“保存”或“测试连接”。
5. 在已授权的后台页面正常操作，完成后回到 Autochar Recorder 点击“停止录制”和“导出 .flow.zip”。

扩展不会读取或导出 cookie、localStorage、sessionStorage、密码或验证码。密码类字段会在 Autochar Recorder 侧做脱敏存储。
