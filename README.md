# AutoChar

一个本地运行的桌面录制视频分析工具，用来把“操作录屏”整理成步骤化过程文字。

## 当前能力

- 上传 PC 操作录屏视频
- 自动抽取关键帧
- 对关键帧做 OCR
- 基于界面变化和文案线索生成步骤描述
- 可选接入多模态大模型润色步骤文案
- 在网页中查看结果并导出 JSON

## 为什么它接近影刀的“智能录制搭建”

我对本机影刀安装目录做了结构分析，发现它的相关能力明显不是单纯录像，而是三层组合：

- `ShadowBot.Shell.TaskCapture`：任务捕获模块
- `ShadowBot.UIAutomation.Provider`：UI 自动化抓取
- `TaskCaptureTemplate` / `FlowTemplates`：将捕获结果组织成模板与流程

这个项目复刻的是其中最容易独立落地的一层：

`录制视频 -> 关键步骤识别 -> 过程化文字`

## 运行

```bash
python -m pip install -r requirements.txt
python app.py
```

打开浏览器访问：

`http://127.0.0.1:8000`

## 多模态增强

如果你想让步骤文案更接近“智能搭建”的表达，可以配置 OpenAI API：

```bash
set OPENAI_API_KEY=你的key
set OPENAI_VISION_MODEL=gpt-4.1-mini
python app.py
```

页面里勾选“启用多模态大模型润色步骤文案”后，系统会：

- 先抽取关键帧
- 用本地 OCR 和规则生成草稿步骤
- 再把关键帧图片和草稿步骤一起发给多模态模型
- 返回更自然、更偏流程化的中文步骤

如果没有配置 `OPENAI_API_KEY`，应用会自动退回本地规则模式。

## FFmpeg

项目默认优先使用系统中的 `ffmpeg`。如果你的系统没有安装，会自动尝试复用影刀自带的：

`D:\应用\ShadowBot\shadowbot-6.0.30\ffmpeg.exe`

## 目录

- `app.py`：FastAPI 入口
- `src/video_to_steps.py`：视频分析主流程
- `src/ocr_engine.py`：OCR 封装
- `src/multimodal_writer.py`：OpenAI 多模态步骤润色
- `src/step_writer.py`：规则步骤生成
- `templates/index.html`：上传页面
- `static/style.css`：样式

## 后续建议

- 接入 UIA 事件流，而不只是视频帧分析
- 增加鼠标轨迹、点击高亮和输入框检测
- 把多模态返回结果映射成可编辑的流程节点
