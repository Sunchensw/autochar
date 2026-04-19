from __future__ import annotations

import base64
import io
import json
import os
from dataclasses import asdict
from typing import Iterable

from openai import OpenAI
from PIL import Image

from src.step_writer import FrameSummary


class MultimodalStepWriter:
    def __init__(self) -> None:
        self.api_key = os.getenv("OPENAI_API_KEY")
        self.model = os.getenv("OPENAI_VISION_MODEL", "gpt-4.1-mini")
        self.base_url = os.getenv("OPENAI_BASE_URL", "").strip()
        self.client = self._build_client(self.api_key, self.base_url)

    @property
    def enabled(self) -> bool:
        return self.client is not None

    def rewrite(
        self,
        frames: list[FrameSummary],
        frame_images: Iterable[Image.Image],
        draft_steps: list[dict],
        model_config: dict | None = None,
    ) -> dict | None:
        resolved = self._resolve_config(model_config)
        client = self._build_client(resolved["api_key"], resolved["base_url"])
        if client is None:
            return None

        try:
            response_text = self._call_responses_api(
                client,
                resolved["model"],
                frames,
                frame_images,
                draft_steps,
            )
        except Exception as responses_exc:
            try:
                response_text = self._call_chat_completions_api(
                    client,
                    resolved["model"],
                    frames,
                    frame_images,
                    draft_steps,
                )
            except Exception as chat_exc:
                return {
                    "_error": {
                        "type": chat_exc.__class__.__name__,
                        "message": f"responses: {str(responses_exc)[:240]} | chat: {str(chat_exc)[:240]}",
                    }
                }

        output_text = (response_text or "").strip()
        if not output_text:
            return None
        return self._extract_json(output_text)

    def summarize_process(
        self,
        *,
        steps: list[dict],
        frame_summaries: list[dict],
        workflow_hint: str | None = None,
        current_process_description: dict | None = None,
        model_config: dict | None = None,
    ) -> dict | None:
        resolved = self._resolve_config(model_config)
        client = self._build_client(resolved["api_key"], resolved["base_url"])
        if client is None or not steps:
            return None

        prompt = self._build_summary_prompt(
            steps=steps,
            frame_summaries=frame_summaries,
            workflow_hint=workflow_hint,
            current_process_description=current_process_description,
        )

        try:
            response_text = self._call_responses_text_api(client, resolved["model"], prompt)
        except Exception as responses_exc:
            try:
                response_text = self._call_chat_text_api(client, resolved["model"], prompt)
            except Exception as chat_exc:
                return {
                    "_error": {
                        "type": chat_exc.__class__.__name__,
                        "message": f"process_summary responses: {str(responses_exc)[:240]} | chat: {str(chat_exc)[:240]}",
                    }
                }

        output_text = (response_text or "").strip()
        if not output_text:
            return None
        extracted = self._extract_json(output_text)
        return self._normalize_process_description(extracted)

    def is_enabled(self, model_config: dict | None = None) -> bool:
        resolved = self._resolve_config(model_config)
        return self._build_client(resolved["api_key"], resolved["base_url"]) is not None

    def preview_config(self, model_config: dict | None = None) -> dict:
        resolved = self._resolve_config(model_config)
        return {
            "model": resolved["model"],
            "base_url": resolved["base_url"] or "https://api.openai.com/v1",
            "has_api_key": bool(resolved["api_key"]),
        }

    def _resolve_config(self, model_config: dict | None) -> dict:
        config = model_config or {}
        return {
            "model": str(config.get("model") or self.model or "gpt-4.1-mini").strip(),
            "api_key": str(config.get("api_key") or self.api_key or "").strip(),
            "base_url": str(config.get("base_url") or self.base_url or "").strip(),
        }

    def _build_client(self, api_key: str, base_url: str) -> OpenAI | None:
        if not api_key:
            return None
        kwargs: dict = {"api_key": api_key}
        if base_url:
            kwargs["base_url"] = base_url
        return OpenAI(**kwargs)

    def _call_responses_api(
        self,
        client: OpenAI,
        model: str,
        frames: list[FrameSummary],
        frame_images: Iterable[Image.Image],
        draft_steps: list[dict],
    ) -> str:
        content: list[dict] = [
            {
                "type": "input_text",
                "text": self._build_prompt(frames, draft_steps),
            }
        ]

        for image in frame_images:
            content.append(
                {
                    "type": "input_image",
                    "image_url": self._image_to_data_url(image),
                    "detail": "high",
                }
            )

        response = client.responses.create(
            model=model,
            input=[
                {
                    "role": "user",
                    "content": content,
                }
            ],
        )
        return response.output_text or ""

    def _call_chat_completions_api(
        self,
        client: OpenAI,
        model: str,
        frames: list[FrameSummary],
        frame_images: Iterable[Image.Image],
        draft_steps: list[dict],
    ) -> str:
        content: list[dict] = [
            {
                "type": "text",
                "text": self._build_prompt(frames, draft_steps),
            }
        ]

        for image in frame_images:
            content.append(
                {
                    "type": "image_url",
                    "image_url": {
                        "url": self._image_to_data_url(image),
                    },
                }
            )

        response = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "user",
                    "content": content,
                }
            ],
        )
        message = response.choices[0].message
        return message.content or ""

    def _call_responses_text_api(self, client: OpenAI, model: str, prompt: str) -> str:
        response = client.responses.create(
            model=model,
            input=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": prompt,
                        }
                    ],
                }
            ],
        )
        return response.output_text or ""

    def _call_chat_text_api(self, client: OpenAI, model: str, prompt: str) -> str:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "user",
                    "content": prompt,
                }
            ],
        )
        message = response.choices[0].message
        content = message.content or ""
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts: list[str] = []
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    parts.append(str(item.get("text") or ""))
            return "\n".join(part for part in parts if part)
        return str(content)

    def _build_prompt(self, frames: list[FrameSummary], draft_steps: list[dict]) -> str:
        payload = {
            "role": "你是 PC 自动化录屏分析助手。",
            "goal": "请根据关键帧图像、OCR 文本和草稿步骤，输出更接近 RPA 智能搭建风格的结构化步骤，以及一段完整的流程说明。",
            "requirements": [
                "保留步骤顺序。",
                "每一步都输出 action_type、intent、screen_observation、description、flow_node。",
                "action_type 只能使用：login、input_text、click、search、submit、confirm、save、navigate、upload、download、create、wait、unknown。",
                "intent 要描述这一步的业务目的，而不是重复按钮文字。",
                "screen_observation 只描述屏幕上能观察到的内容，不要编造隐藏信息。",
                "description 要写成适合自动化设计器展示的过程化说明。",
                "flow_node 必须包含 node_type、node_name、node_params、confidence。",
                "flow_node.node_params 使用字符串数组，列出该节点后续需要补充的关键参数。",
                "额外输出 process_description，包含 title、overview、full_text。",
                "full_text 需要是一段详细、自然、连贯的中文流程说明，能完整描述整个操作过程。",
                "如果能识别出明确的网址、输入值、按钮名称、操作链接和编辑字段，请在 full_text 中直接用“打开…，输入…，点击…”这样的操作复述句式输出。",
                "不要输出 Markdown，只输出 JSON。",
            ],
            "output_format": {
                "process_description": {
                    "title": "商品编辑流程说明",
                    "overview": "该流程主要包括打开页面、输入筛选条件、查询商品、进入编辑页和修改商品信息。",
                    "full_text": "打开页面，在商品货号输入框中输入指定货号，点击查询。待商品列表加载后，点击修改资料，进入编辑页并修改商品标题等信息。",
                },
                "steps": [
                    {
                        "step": 1,
                        "time": 0.0,
                        "action_type": "input_text",
                        "intent": "填写筛选条件",
                        "screen_observation": "页面出现商品货号输入框，并已录入目标货号。",
                        "description": "在筛选区域中填写商品货号。",
                        "flow_node": {
                            "node_type": "input",
                            "node_name": "输入商品货号",
                            "node_params": ["输入值"],
                            "confidence": 0.88,
                        },
                    }
                ],
            },
            "frame_summaries": [asdict(frame) for frame in frames],
            "draft_steps": draft_steps,
        }
        return json.dumps(payload, ensure_ascii=False)

    def _build_summary_prompt(
        self,
        *,
        steps: list[dict],
        frame_summaries: list[dict],
        workflow_hint: str | None,
        current_process_description: dict | None,
    ) -> str:
        payload = {
            "role": "你是自动化流程分析助手。",
            "task": "请只基于提供的结构化步骤和关键帧摘要，重新生成更准确的中文流程说明。",
            "rules": [
                "严格根据 steps 和 frame_summaries 总结，不要虚构未出现的网址、字段值、按钮或操作。",
                "优先使用步骤中的 description、screen_observation、screen_text、flow_node.node_name 作为事实依据。",
                "如果步骤中已经出现精确的网址、输入值、按钮名称、列表操作和编辑字段，请在 full_text 中明确写出来。",
                "如果某个信息不够确定，就使用相对保守的表述，不要编造。",
                "full_text 必须是面向业务用户可直接阅读的一段自然中文，不要写成“第1步、第2步”的机械说明。",
                "overview 用一句话概括主流程。",
                "只输出 JSON，不要输出代码块。",
            ],
            "workflow_hint": workflow_hint or "",
            "current_process_description": current_process_description or {},
            "steps": steps,
            "frame_summaries": frame_summaries,
            "output_format": {
                "title": "流程说明标题",
                "overview": "一句话概括整个流程。",
                "full_text": "打开页面，在某字段中输入某值，点击查询，进入结果列表，再进入编辑页修改相关字段。",
            },
        }
        return json.dumps(payload, ensure_ascii=False)

    def _normalize_process_description(self, payload: dict | None) -> dict | None:
        if not isinstance(payload, dict):
            return None

        title = str(payload.get("title") or "").strip()
        overview = str(payload.get("overview") or "").strip()
        full_text = str(payload.get("full_text") or "").strip()
        if not full_text:
            return None
        return {
            "title": title or "流程说明",
            "overview": overview or "该流程说明由 AI 基于结构化步骤自动总结生成。",
            "full_text": full_text,
        }

    def _image_to_data_url(self, image: Image.Image) -> str:
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=85)
        encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
        return f"data:image/jpeg;base64,{encoded}"

    def _extract_json(self, text: str) -> dict | None:
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            start = text.find("{")
            end = text.rfind("}")
            if start == -1 or end == -1 or end <= start:
                return None
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                return None
