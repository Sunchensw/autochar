# 影刀“智能录制搭建”本地分析

## 本次观察到的本机安装事实

影刀正在运行的关键进程：

- `ShadowBot.Shell.exe`
- `ShadowBot.UIAutomation.Provider.exe`

安装目录中的关键模块：

- `ShadowBot.Shell.TaskCapture.dll`
- `ShadowBot.UIAutomation.Provider.dll`
- `ShadowBot.UIAutomation.Tools.dll`
- `TaskCaptureTemplate/`
- `FlowTemplates/`
- `ffmpeg.exe`

补充线索：

- `TaskCaptureTemplate/task_capture.zip`
- `TaskCaptureTemplate/template.docx`
- `FlowTemplates/magic_blank.zip`
- `Resources/Code-Activity/Zh-CN/xbot_visual/recorder.py`
- `Resources/Code-Activity/Zh-CN/xbot_visual/stack_recorder.py`

## 对“智能录制搭建”的推断

从模块拆分看，它大概率不是“先完整录像，再一次性让 AI 看视频”的纯后处理方案，而是混合式采集：

1. UI 自动化采集
   通过 `UIAutomation.Provider` 抓当前窗口、控件树、控件属性、焦点变化、可点击元素。

2. 行为录制
   通过 recorder 记录点击、输入、切换窗口、等待等动作，以及动作发生时的上下文。

3. 运行时快照
   从 `recorder.py` 可以看出它有 runtime snapshot / sqlite / gzip 压缩缓存的设计，说明每一步动作会被结构化存储，而不是只留视频。

4. 模板生成
   `TaskCaptureTemplate` 和 `FlowTemplates` 说明最终结果会落入一个“任务模板”或“流程模板”，方便直接生成自动化流程。

5. 视觉补充
   安装目录里带 `ffmpeg`、图像模块和视觉相关资源，说明在 UI 自动化信息不完整时，它会用截图、OCR、视觉定位补充。

## 一个更接近真实实现的内部流水线

我推测影刀的“智能录制搭建”内部更接近下面这条链路：

`用户操作`
-> `鼠标键盘事件监听`
-> `当前窗口与控件树抓取`
-> `局部截图 / 页面快照`
-> `动作语义归一化`
-> `结构化步骤缓存`
-> `流程模板生成`
-> `展示为可编辑流程`

其中“录像”更像是旁路证据，而不是唯一数据源。

## 为什么我给你做的 MVP 先从视频转文字切入

如果直接复刻影刀全量能力，至少还需要：

- Windows UIA 控件监听
- 鼠标键盘全局 hook
- 控件截图与锚点定位
- 动作归因
- 流程 DSL 或节点图编辑器

这个投入会明显更大。

所以当前项目先聚焦成一个更快可验证的产品原型：

`录屏视频 -> 关键帧 -> OCR -> 步骤文案`

这个原型的价值在于：

- 能快速验证用户是否真的需要“把录制过程整理为步骤说明”
- 能作为之后接 UIA 事件流的文本层输出模块
- 能先形成一个独立可售卖/可演示的小工具

## 当前复刻方案与影刀能力的映射

当前项目已实现：

- 视频抽帧
- 画面变化检测
- OCR 识别
- 步骤化过程文案输出
- 本地 Web 上传页面

当前尚未复刻：

- 真正的 UI 控件树捕获
- 鼠标点击点识别
- 输入框定位与值提取
- 自动生成 RPA 流程节点
- 多步骤上下文推理

## 如果你要继续往“像影刀”方向推进

建议按这个顺序迭代：

1. 给视频分析加鼠标指针和点击波纹检测
2. 接入 Windows UI Automation，记录控件名称、类型、AutomationId
3. 把“点击按钮”“输入文本”“等待页面加载”抽象成统一动作模型
4. 增加一个步骤编辑器，允许人工修正文案
5. 最后再把步骤映射成自动化流程节点

## 结论

影刀的“智能录制搭建”更像是：

`事件采集 + UI 自动化 + 截图/OCR + 模板生成`

不是单纯的视频理解功能。

而当前这个 `AutoChar` 项目已经复刻了其中最适合独立落地的一段：

`录制内容理解 -> 过程性文字生成`
