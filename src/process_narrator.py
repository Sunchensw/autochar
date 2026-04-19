from __future__ import annotations

import re


class ProcessNarrator:
    def build(self, steps: list[dict], workflow_hint: str | None = None) -> dict:
        if not steps:
            return {
                "title": "未识别出有效流程",
                "overview": "当前视频没有提取出稳定的关键步骤，暂时无法生成完整流程描述。",
                "full_text": "当前视频没有提取出稳定的关键步骤，建议提升录屏清晰度、缩短录屏范围，或开启 AI 增强后重新分析。",
            }

        if workflow_hint in {"ecommerce_backend_search_edit", "search_edit_flow"}:
            return self._build_search_edit_flow(steps)
        if workflow_hint == "ecommerce_backend_search_list_action":
            return self._build_search_list_action_flow(steps)
        if workflow_hint == "ecommerce_backend_create_entry":
            return self._build_create_entry_flow(steps)

        return {
            "title": self._build_title(steps),
            "overview": self._build_overview(steps),
            "full_text": self._build_generic_full_text(steps),
        }

    def _build_search_edit_flow(self, steps: list[dict]) -> dict:
        page_url = self._extract_url(steps)
        search_label, search_value = self._extract_input_detail(steps, prefer_edit=False)
        query_label = self._extract_button_label(steps, "点击页面上的")
        action_label = self._extract_list_action(steps)
        edit_label, _ = self._extract_input_detail(steps, prefer_edit=True)
        submit_label = self._extract_submit_label(steps)

        title = "商品查询与资料修改流程"
        overview = "该流程展示了在电商后台检索目标商品、进入结果列表并继续修改商品资料的完整过程。"

        parts: list[str] = ["本次录屏展示的是在电商后台中查询并编辑商品资料的过程。"]
        if page_url:
            parts.append(f"首先打开网站 {page_url}。")
        else:
            parts.append("首先进入商品管理相关页面。")

        if search_label and search_value:
            query_text = f"，并点击“{query_label}”按钮发起查询" if query_label else "后发起查询"
            parts.append(f"随后在“{search_label}”输入框中填写“{search_value}”{query_text}。")
        elif search_label:
            query_text = f"并点击“{query_label}”按钮" if query_label else "并执行查询"
            parts.append(f"随后在“{search_label}”对应的筛选区域中补充检索条件，{query_text}。")
        elif query_label:
            parts.append(f"随后点击“{query_label}”执行当前页面中的筛选查询。")

        if action_label:
            parts.append(f"待商品列表加载完成后，在结果列表的操作区域点击“{action_label}”，进入商品资料编辑页面。")
        else:
            parts.append("待结果列表返回后，从商品列表进入对应商品的详情或编辑页面。")

        if edit_label:
            parts.append(f"进入编辑页面后，在“{edit_label}”对应的文本框中修改信息。")
        else:
            parts.append("进入编辑页面后，在商品基础信息相关的输入区域中修改内容。")

        if submit_label:
            parts.append(f"完成修改后，还可以继续点击“{submit_label}”保存或提交本次变更。")

        return {
            "title": title,
            "overview": overview,
            "full_text": "".join(parts),
        }

    def _build_search_list_action_flow(self, steps: list[dict]) -> dict:
        page_url = self._extract_url(steps)
        search_label, search_value = self._extract_input_detail(steps, prefer_edit=False)
        query_label = self._extract_button_label(steps, "点击页面上的")
        action_label = self._extract_list_action(steps)

        parts: list[str] = ["本次录屏展示的是在电商后台中筛选目标商品并执行列表操作的过程。"]
        if page_url:
            parts.append(f"首先打开网站 {page_url}。")
        else:
            parts.append("首先进入对应的商品管理页面。")
        if search_label and search_value:
            parts.append(f"随后在“{search_label}”输入框中填写“{search_value}”，并点击“{query_label or '查询'}”执行筛选。")
        elif query_label:
            parts.append(f"随后点击“{query_label}”执行当前页面中的查询操作。")
        if action_label:
            parts.append(f"待结果列表出现后，在列表操作区执行“{action_label}”动作。")

        return {
            "title": "商品筛选与列表操作流程",
            "overview": "该流程主要包括进入商品管理页、筛选目标商品以及在结果列表中执行操作。",
            "full_text": "".join(parts),
        }

    def _build_create_entry_flow(self, steps: list[dict]) -> dict:
        page_url = self._extract_url(steps)
        create_label = self._extract_click_target(steps, keywords=("新增", "新建", "创建", "发布"))
        edit_label, _ = self._extract_input_detail(steps, prefer_edit=True)
        submit_label = self._extract_submit_label(steps)

        parts: list[str] = ["本次录屏展示的是在电商后台中新建商品或新增资料的过程。"]
        if page_url:
            parts.append(f"首先打开网站 {page_url}。")
        if create_label:
            parts.append(f"随后点击页面上的“{create_label}”入口，进入新建或编辑表单页面。")
        if edit_label:
            parts.append(f"进入表单页面后，在“{edit_label}”等相关字段中填写商品信息。")
        else:
            parts.append("进入表单页面后，在商品基础信息相关字段中填写内容。")
        if submit_label:
            parts.append(f"填写完成后，可继续点击“{submit_label}”完成保存或提交流程。")

        return {
            "title": "商品新建与表单填写流程",
            "overview": "该流程展示了进入新建入口、填写商品表单并继续保存或提交的过程。",
            "full_text": "".join(parts),
        }

    def _build_title(self, steps: list[dict]) -> str:
        first_intent = str(steps[0].get("intent") or "业务流程").strip()
        return f"{first_intent[:18]}流程说明" if first_intent else "业务流程说明"

    def _build_overview(self, steps: list[dict]) -> str:
        intents = [str(step.get("intent") or "").strip() for step in steps if step.get("intent")]
        unique_intents: list[str] = []
        for intent in intents:
            if intent and intent not in unique_intents:
                unique_intents.append(intent)
        if unique_intents:
            return f"该流程共识别出 {len(steps)} 个关键步骤，主要包括{'、'.join(unique_intents[:4])}等操作。"
        return f"该流程共识别出 {len(steps)} 个关键步骤，覆盖了页面切换、输入、点击或等待等典型桌面操作。"

    def _build_generic_full_text(self, steps: list[dict]) -> str:
        descriptions: list[str] = []
        for step in steps:
            description = self._clean_sentence(str(step.get("description") or ""))
            if not description:
                description = self._fallback_sentence(step)
            if description and description not in descriptions:
                descriptions.append(description)

        if not descriptions:
            return "当前视频暂未提取出足够清晰的步骤信息，建议进一步检查录屏清晰度或补充 AI 增强分析。"

        connectors = ["首先", "然后", "接着", "随后", "最后"]
        sentences: list[str] = []
        for index, description in enumerate(descriptions):
            prefix = connectors[min(index, len(connectors) - 1)]
            if description.startswith(tuple(connectors)):
                sentences.append(f"{description}。")
            else:
                sentences.append(f"{prefix}，{description}。")
        return "".join(sentences)

    def _extract_url(self, steps: list[dict]) -> str:
        for step in steps:
            text = " ".join(
                [
                    str(step.get("description") or ""),
                    str(step.get("screen_observation") or ""),
                    str(step.get("screen_text") or ""),
                ]
            )
            match = re.search(r"https?://[^\s。，“”\"]+", text)
            if match:
                return match.group(0).rstrip("。")
        return ""

    def _extract_input_detail(self, steps: list[dict], prefer_edit: bool) -> tuple[str, str]:
        for step in steps:
            description = str(step.get("description") or "").strip()
            if prefer_edit and "文本框" not in description and "修改" not in description:
                continue
            if not prefer_edit and "这里输入" not in description:
                continue

            match = re.search(r"在(.+?)(?:这里|下的文本框).{0,4}(?:输入|修改)(.+)", description)
            if match:
                label = match.group(1).strip("“”\" ")
                value = match.group(2).strip("。；;，, ")
                if "信息" == value:
                    value = ""
                return label, value

            edit_match = re.search(r"在(.+?)下的文本框", description)
            if edit_match:
                return edit_match.group(1).strip("“”\" "), ""

            input_match = re.search(r"在(.+?)这里输入(.+)", description)
            if input_match:
                return (
                    input_match.group(1).strip("“”\" "),
                    input_match.group(2).strip("。；;，, "),
                )
        return "", ""

    def _extract_button_label(self, steps: list[dict], prefix: str) -> str:
        for step in steps:
            description = str(step.get("description") or "").strip()
            match = re.search(re.escape(prefix) + r"(.+)", description)
            if match:
                return match.group(1).strip("。；;，, “”\" ")
        return ""

    def _extract_list_action(self, steps: list[dict]) -> str:
        for step in steps:
            description = str(step.get("description") or "").strip()
            match = re.search(r"(?:点击商品列表下的|在商品列表中执行)(.+)", description)
            if match:
                return match.group(1).strip("。；;，, “”\" ")
        return ""

    def _extract_submit_label(self, steps: list[dict]) -> str:
        keywords = ("保存", "提交", "发布", "确认")
        return self._extract_click_target(steps, keywords=keywords)

    def _extract_click_target(self, steps: list[dict], keywords: tuple[str, ...]) -> str:
        for step in steps:
            description = str(step.get("description") or "").strip()
            if not any(keyword in description for keyword in keywords):
                continue
            match = re.search(r"(?:点击页面上的|执行|继续点击|可继续点击)(.+)", description)
            if match:
                return match.group(1).strip("。；;，, “”\" ")
            compact = description.replace("。", "")
            for keyword in keywords:
                if keyword in compact:
                    return keyword
        return ""

    def _fallback_sentence(self, step: dict) -> str:
        observation = self._clean_sentence(str(step.get("screen_observation") or ""))
        if observation:
            return observation

        action_type = str(step.get("action_type") or "unknown")
        action_map = {
            "navigate": "打开新的页面或操作区域",
            "input_text": "在当前输入区域填写信息",
            "click": "点击当前页面中的目标控件",
            "search": "执行当前页面中的筛选或查询操作",
            "submit": "提交当前页面中的表单或配置",
            "save": "保存当前修改内容",
            "confirm": "确认当前页面中的提示或弹窗",
            "wait": "等待系统完成页面反馈或数据加载",
        }
        return action_map.get(action_type, "完成当前页面中的目标动作")

    def _clean_sentence(self, text: str) -> str:
        cleaned = str(text or "").strip()
        while cleaned.endswith(("。", "；", ";", "!", "！")):
            cleaned = cleaned[:-1].strip()
        return cleaned
