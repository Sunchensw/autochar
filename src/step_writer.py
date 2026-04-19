from __future__ import annotations

from dataclasses import dataclass


@dataclass
class FrameSummary:
    timestamp: float
    text: str
    score: float
    change_ratio: float


class StepWriter:
    ACTION_RULES = [
        {
            "keywords": ["登录", "登陆", "sign in", "login"],
            "action_type": "login",
            "intent": "进入登录流程并完成身份验证",
            "description": "识别到登录相关界面，准备输入账号并完成登录。",
            "node_type": "login",
            "node_name": "登录系统",
            "node_params": ["账号", "密码"],
        },
        {
            "keywords": ["用户名", "账号", "手机号", "邮箱", "username", "email"],
            "action_type": "input_text",
            "intent": "填写身份信息",
            "description": "定位到身份信息输入区域，准备填写用户名、手机号或邮箱。",
            "node_type": "input",
            "node_name": "输入账号信息",
            "node_params": ["输入值"],
        },
        {
            "keywords": ["密码", "password"],
            "action_type": "input_text",
            "intent": "填写密码",
            "description": "定位到密码输入区域，准备填写密码。",
            "node_type": "input",
            "node_name": "输入密码",
            "node_params": ["输入值"],
        },
        {
            "keywords": ["搜索", "查询", "search"],
            "action_type": "search",
            "intent": "筛选或搜索目标数据",
            "description": "识别到搜索或查询界面，准备输入筛选条件并执行搜索。",
            "node_type": "search",
            "node_name": "执行搜索",
            "node_params": ["关键词"],
        },
        {
            "keywords": ["提交", "submit"],
            "action_type": "submit",
            "intent": "提交当前表单或当前步骤",
            "description": "识别到提交流程，准备提交当前页面中的配置或表单。",
            "node_type": "submit",
            "node_name": "提交当前页面",
            "node_params": [],
        },
        {
            "keywords": ["确定", "确认", "ok"],
            "action_type": "confirm",
            "intent": "确认当前弹窗或配置",
            "description": "识别到确认动作，准备确认当前弹窗、提示或配置。",
            "node_type": "click",
            "node_name": "点击确认",
            "node_params": ["目标控件"],
        },
        {
            "keywords": ["保存", "save"],
            "action_type": "save",
            "intent": "保存当前内容",
            "description": "识别到保存入口，准备保存当前编辑结果。",
            "node_type": "save",
            "node_name": "保存数据",
            "node_params": [],
        },
        {
            "keywords": ["下一步", "继续", "next"],
            "action_type": "navigate",
            "intent": "进入下一阶段流程",
            "description": "识别到流程推进动作，准备跳转到下一步。",
            "node_type": "click",
            "node_name": "进入下一步",
            "node_params": ["目标控件"],
        },
        {
            "keywords": ["上传", "导入", "upload"],
            "action_type": "upload",
            "intent": "上传文件或导入附件",
            "description": "识别到上传入口，准备选择文件并完成上传。",
            "node_type": "upload",
            "node_name": "上传文件",
            "node_params": ["文件路径"],
        },
        {
            "keywords": ["下载", "导出", "export", "download"],
            "action_type": "download",
            "intent": "导出或下载结果文件",
            "description": "识别到下载或导出入口，准备生成并保存文件。",
            "node_type": "download",
            "node_name": "导出结果",
            "node_params": ["保存路径"],
        },
        {
            "keywords": ["新建", "创建", "新增", "create", "new"],
            "action_type": "create",
            "intent": "创建新的业务对象",
            "description": "识别到新建入口，准备创建新的记录、单据或任务。",
            "node_type": "create",
            "node_name": "新建对象",
            "node_params": [],
        },
    ]

    def build(self, frames: list[FrameSummary]) -> list[dict]:
        return [self._build_step(frame, index) for index, frame in enumerate(frames, start=1)]

    def normalize_steps(self, steps: list[dict], frame_count: int | None = None) -> list[dict]:
        normalized = [self._normalize_step(step, index) for index, step in enumerate(steps, start=1)]
        if normalized or not frame_count:
            return normalized
        return [
            self._normalize_step(
                {
                    "step": 1,
                    "time": 0.0,
                    "action_type": "unknown",
                    "intent": "识别视频中的关键操作",
                    "screen_observation": "未解析出稳定的关键帧信息。",
                    "description": "当前视频未提取出足够的结构化步骤，请增加录屏清晰度或缩短时长后重试。",
                    "flow_node": {
                        "node_type": "manual_review",
                        "node_name": "人工确认步骤",
                        "node_params": [],
                        "confidence": 0.2,
                    },
                },
                1,
            )
        ]

    def _build_step(self, frame: FrameSummary, index: int) -> dict:
        rule = self._match_rule(frame.text)
        screen_observation = self._build_screen_observation(frame)

        if rule is None:
            action_type = self._infer_fallback_action(frame)
            intent = self._infer_fallback_intent(frame)
            description = self._infer_fallback_description(frame)
            flow_node = self._build_flow_node(
                node_type="wait" if action_type == "wait" else "manual_review",
                node_name="等待页面反馈" if action_type == "wait" else "人工判定步骤",
                node_params=[],
                confidence=0.45 if action_type == "wait" else 0.35,
            )
        else:
            action_type = rule["action_type"]
            intent = rule["intent"]
            description = rule["description"]
            flow_node = self._build_flow_node(
                node_type=rule["node_type"],
                node_name=rule["node_name"],
                node_params=rule["node_params"],
                confidence=self._confidence(frame),
            )

        return {
            "step": index,
            "time": round(frame.timestamp, 2),
            "action_type": action_type,
            "intent": intent,
            "screen_observation": screen_observation,
            "description": description,
            "screen_text": frame.text,
            "change_ratio": round(frame.change_ratio, 4),
            "flow_node": flow_node,
        }

    def _normalize_step(self, step: dict, index: int) -> dict:
        try:
            time_value = round(float(step.get("time", 0.0)), 2)
        except (TypeError, ValueError):
            time_value = 0.0

        action_type = str(step.get("action_type") or "unknown")
        intent = str(step.get("intent") or "识别并完成当前操作")
        screen_observation = str(
            step.get("screen_observation")
            or step.get("screen_text")
            or "未提供明确的页面观察信息。"
        )
        description = str(
            step.get("description")
            or f"执行第 {index} 步操作，完成当前页面中的目标动作。"
        )
        screen_text = str(step.get("screen_text") or "")
        try:
            change_ratio = round(float(step.get("change_ratio", 0.0)), 4)
        except (TypeError, ValueError):
            change_ratio = 0.0

        raw_flow_node = step.get("flow_node") or step.get("suggested_flow_node") or {}
        if not isinstance(raw_flow_node, dict):
            raw_flow_node = {}

        flow_node = self._build_flow_node(
            node_type=str(raw_flow_node.get("node_type") or self._map_action_to_node(action_type)),
            node_name=str(raw_flow_node.get("node_name") or self._default_node_name(action_type)),
            node_params=list(raw_flow_node.get("node_params") or []),
            confidence=self._safe_confidence(raw_flow_node.get("confidence", 0.5)),
        )

        return {
            "step": index,
            "time": time_value,
            "action_type": action_type,
            "intent": intent,
            "screen_observation": screen_observation,
            "description": description,
            "screen_text": screen_text,
            "change_ratio": change_ratio,
            "flow_node": flow_node,
        }

    def _match_rule(self, text: str) -> dict | None:
        lowered = text.lower()
        for rule in self.ACTION_RULES:
            if any(keyword.lower() in lowered for keyword in rule["keywords"]):
                return rule
        return None

    def _build_screen_observation(self, frame: FrameSummary) -> str:
        if frame.text:
            return f"页面中可见的核心文字包括：{frame.text[:120]}。"
        if frame.change_ratio > 0.35:
            return "画面发生明显切换，推测进入了新的页面或弹窗。"
        return "当前画面变化较小，可能处于等待结果或执行细粒度交互。"

    def _infer_fallback_action(self, frame: FrameSummary) -> str:
        if frame.change_ratio > 0.35:
            return "navigate"
        if frame.change_ratio < 0.08:
            return "wait"
        return "unknown"

    def _infer_fallback_intent(self, frame: FrameSummary) -> str:
        if frame.change_ratio > 0.35:
            return "切换到下一页面或打开新的操作区域"
        if frame.change_ratio < 0.08:
            return "等待系统反馈或数据加载"
        return "识别并完成当前页面中的关键操作"

    def _infer_fallback_description(self, frame: FrameSummary) -> str:
        if frame.text:
            return f"页面出现新的操作界面，当前可见的核心文字为“{frame.text[:80]}”。"
        if frame.change_ratio > 0.35:
            return "画面发生明显切换，推测用户进入了新的操作阶段。"
        return "当前画面变化较小，可能是在等待结果、点击控件或执行细粒度输入。"

    def _confidence(self, frame: FrameSummary) -> float:
        base = 0.55
        if frame.score > 0:
            base += min(frame.score * 0.25, 0.25)
        if frame.change_ratio > 0.18:
            base += 0.1
        return min(base, 0.95)

    def _safe_confidence(self, value: object) -> float:
        try:
            number = float(value)
        except (TypeError, ValueError):
            return 0.5
        return min(max(number, 0.0), 1.0)

    def _build_flow_node(
        self,
        node_type: str,
        node_name: str,
        node_params: list[str],
        confidence: float,
    ) -> dict:
        return {
            "node_type": node_type,
            "node_name": node_name,
            "node_params": node_params,
            "confidence": round(confidence, 2),
        }

    def _map_action_to_node(self, action_type: str) -> str:
        mapping = {
            "login": "login",
            "input_text": "input",
            "click": "click",
            "search": "search",
            "submit": "submit",
            "confirm": "click",
            "save": "save",
            "navigate": "click",
            "upload": "upload",
            "download": "download",
            "create": "create",
            "wait": "wait",
        }
        return mapping.get(action_type, "manual_review")

    def _default_node_name(self, action_type: str) -> str:
        mapping = {
            "login": "登录系统",
            "input_text": "输入文本",
            "click": "点击控件",
            "search": "执行搜索",
            "submit": "提交页面",
            "confirm": "点击确认",
            "save": "保存内容",
            "navigate": "切换页面",
            "upload": "上传文件",
            "download": "下载文件",
            "create": "创建对象",
            "wait": "等待页面反馈",
        }
        return mapping.get(action_type, "人工确认步骤")
