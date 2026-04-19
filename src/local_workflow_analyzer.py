from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Iterable, Sequence
import re

import numpy as np
from PIL import Image

from src.ocr_engine import OCREngine

if TYPE_CHECKING:
    from src.video_to_steps import CandidateFrame


@dataclass
class FrameVisualState:
    timestamp: float
    change_ratio: float
    left_bottom_saturation: float
    phase: str


@dataclass
class SearchSignal:
    url: str
    field_label: str
    field_value: str
    query_label: str
    action_label: str
    create_label: str
    raw_text: str


@dataclass
class EditSignal:
    url: str
    field_label: str
    field_value: str
    submit_label: str
    raw_text: str


class LocalWorkflowAnalyzer:
    SEARCH_FIELDS = [
        ("商品货号", ["商品货号", "货号", "货品编码", "款号", "商家编码"]),
        ("SKU", ["SKU", "sku", "Sku"]),
        ("SPU", ["SPU", "spu", "Spu"]),
        ("商品ID", ["商品ID", "货品ID", "商品编码"]),
        ("商品名称", ["商品名称", "商品标题", "标题"]),
    ]
    QUERY_LABELS = ["查询", "搜索", "筛选", "查找", "检索"]
    EDIT_ACTIONS = ["修改资料", "编辑资料", "编辑商品", "去编辑", "编辑", "修改"]
    STATUS_ACTIONS = ["上架", "下架", "启用", "停用", "删除", "恢复", "复制"]
    BATCH_ACTIONS = ["批量上架", "批量下架", "批量提交", "批量删除", "批量改价", "批量审核"]
    LIST_ACTIONS = ["查看详情", "查看", "详情"]
    CREATE_ACTIONS = ["新增商品", "新建商品", "创建商品", "发布新品", "新增", "新建", "创建"]
    SUBMIT_ACTIONS = ["提交审核", "提交", "保存草稿", "保存", "发布", "确认"]
    EDIT_FIELDS = ["商品标题", "结构化标题", "商品名称", "商品描述", "基础信息", "销售信息", "标题"]

    def __init__(self, ocr: OCREngine) -> None:
        self.ocr = ocr

    def analyze(self, candidates: Sequence["CandidateFrame"]) -> dict | None:
        if len(candidates) < 3:
            return None

        states = [self._inspect_frame(item) for item in candidates]
        edit_indices = [index for index, state in enumerate(states) if state.phase == "edit_form"]
        edit_start = edit_indices[0] if edit_indices else None

        prefix_count = min(max(3, (edit_start + 1) if edit_start is not None else 3), len(candidates))
        search_frames = list(candidates[:prefix_count])
        edit_frames = list(candidates[edit_start:]) if edit_start is not None else []
        search_signals = [self._extract_search_signal(frame.image) for frame in self._sample_search_frames(search_frames)]
        edit_signals = [self._extract_edit_signal(frame.image) for frame in self._sample_edit_frames(edit_frames)]

        flow = self._build_search_flow(states, search_signals, edit_signals, edit_start)
        if flow:
            return flow
        return self._build_create_flow(states, search_signals, edit_signals, edit_start)

    def _build_search_flow(
        self,
        states: Sequence[FrameVisualState],
        search_signals: Sequence[SearchSignal],
        edit_signals: Sequence[EditSignal],
        edit_start: int | None,
    ) -> dict | None:
        primary = self._best_search_signal(search_signals)
        if primary is None:
            return None

        page_url = self._best_url(search_signals, prefer_non_edit=True) or self._best_url(edit_signals)
        search_label = primary.field_label or self._first_non_empty(signal.field_label for signal in search_signals)
        search_value = self._best_search_value(
            [signal.field_value for signal in search_signals] + [signal.field_value for signal in edit_signals]
        )
        query_label = primary.query_label or self._first_non_empty(signal.query_label for signal in search_signals) or "查询"
        action_label = primary.action_label or self._first_non_empty(signal.action_label for signal in search_signals)
        edit_label = self._first_non_empty(signal.field_label for signal in edit_signals)

        if not action_label or (not search_label and not search_value):
            return None

        if self._action_kind(action_label) == "edit" and edit_label and edit_start is not None:
            steps = self._steps_for_search_edit(states, edit_start, page_url or "目标业务页面", search_label or "筛选条件", search_value or "目标商品", query_label, action_label, edit_label)
            text = f"打开网站{page_url or '目标网页'}，在{search_label or '筛选条件'}这里输入{search_value or '目标商品'}，点击页面上的{query_label}，加载后点击商品列表下的{action_label}，在{edit_label}下的文本框修改信息。"
            workflow = "ecommerce_backend_search_edit"
        else:
            steps = self._steps_for_list_action(states, page_url or "目标业务页面", search_label or "筛选条件", search_value or "目标商品", query_label, action_label)
            text = f"打开网站{page_url or '目标网页'}，在{search_label or '筛选条件'}这里输入{search_value or '目标商品'}，点击页面上的{query_label}，加载后在商品列表中执行{action_label}。"
            workflow = "ecommerce_backend_search_list_action"
            edit_label = ""

        return {
            "workflow_id": workflow,
            "confidence": self._confidence(page_url, search_label, search_value, action_label, edit_label),
            "steps": steps,
            "process_description": {
                "title": "电商后台操作流程",
                "overview": "该录屏展示了在电商后台中先筛选目标商品，再在列表或编辑页继续处理商品信息的过程。",
                "full_text": text,
            },
            "frame_summaries": self._frame_summaries(states, search_label or "筛选条件", search_value or "目标商品", action_label, edit_label),
        }

    def _build_create_flow(
        self,
        states: Sequence[FrameVisualState],
        search_signals: Sequence[SearchSignal],
        edit_signals: Sequence[EditSignal],
        edit_start: int | None,
    ) -> dict | None:
        create_label = self._first_non_empty(signal.create_label for signal in search_signals)
        edit_label = self._first_non_empty(signal.field_label for signal in edit_signals)
        if not create_label or not edit_label or edit_start is None:
            return None

        page_url = self._best_url(search_signals) or self._best_url(edit_signals)
        fill_value = self._best_search_value([signal.field_value for signal in edit_signals])
        submit_label = self._first_non_empty(signal.submit_label for signal in edit_signals)

        steps = [
            self._step(1, round(states[0].timestamp, 2), "navigate", "打开业务页面", f"打开网站 {page_url or '目标业务页面'}。", f"浏览器地址栏识别到页面地址为 {page_url or '目标业务页面'}。", page_url or "目标业务页面", "open_page", "打开页面", [page_url or "目标业务页面"], 0.92),
            self._step(2, round(states[0].timestamp, 2), "click", "进入新建入口", f"点击页面上的{create_label}。", f"页面中识别到 {create_label} 入口。", create_label, "create", f"点击{create_label}", [create_label], 0.88),
            self._step(3, round(states[edit_start].timestamp, 2), "input_text", "填写商品表单信息", f"在{edit_label}相关的表单区域填写商品信息。", f"编辑页面识别到 {edit_label} 相关输入区域。", edit_label, "input", f"填写{edit_label}", [edit_label], 0.86),
        ]
        if submit_label:
            steps.append(self._step(4, round(states[-1].timestamp, 2), "submit", "提交或保存当前表单", f"页面底部可继续执行{submit_label}。", f"编辑页面底部识别到 {submit_label} 按钮。", submit_label, "submit", f"执行{submit_label}", [submit_label], 0.76))

        text = f"打开网站{page_url or '目标网页'}，点击页面上的{create_label}，在{edit_label}相关的表单区域填写商品信息。"
        if submit_label:
            text += f" 如需完成流程，可继续点击{submit_label}。"
        return {
            "workflow_id": "ecommerce_backend_create_entry",
            "confidence": self._confidence(page_url, create_label, fill_value, create_label, edit_label),
            "steps": steps,
            "process_description": {
                "title": "电商后台新建流程",
                "overview": "该录屏展示了在电商后台中进入新建入口，并在编辑页中填写商品信息的过程。",
                "full_text": text,
            },
            "frame_summaries": self._frame_summaries(states, create_label, fill_value or "商品信息", create_label, edit_label),
        }

    def _extract_search_signal(self, image: Image.Image) -> SearchSignal:
        address = self._ocr(image, (0.12, 0.045, 0.78, 0.11), address=True)
        form = self._ocr(image, (0.15, 0.18, 0.95, 0.62))
        query = self._ocr(image, (0.58, 0.38, 0.88, 0.68), compact=True)
        action = self._ocr(image, (0.74, 0.56, 0.99, 0.88), compact=True)
        entry = self._ocr(image, (0.00, 0.10, 0.50, 0.45))
        raw = " ".join(part for part in [entry, form, query, action] if part)
        field_label, field_value = self._extract_search_field(raw)
        return SearchSignal(
            url=self._extract_url(address),
            field_label=field_label,
            field_value=field_value,
            query_label=self._find_first(self._compact(query), self.QUERY_LABELS),
            action_label=self._extract_action_label(action),
            create_label=self._find_first(self._compact(f"{entry}{form}"), self.CREATE_ACTIONS),
            raw_text=raw,
        )

    def _extract_edit_signal(self, image: Image.Image) -> EditSignal:
        address = self._ocr(image, (0.12, 0.045, 0.78, 0.11), address=True)
        title = self._ocr(image, (0.24, 0.33, 0.90, 0.58))
        form = self._ocr(image, (0.20, 0.52, 0.95, 0.82))
        footer = self._ocr(image, (0.45, 0.82, 0.98, 0.98), compact=True)
        raw = " ".join(part for part in [title, form, footer] if part)
        return EditSignal(
            url=self._extract_url(address),
            field_label=self._extract_edit_label(raw),
            field_value=self._extract_inventory_value(raw),
            submit_label=self._find_first(self._compact(footer), self.SUBMIT_ACTIONS),
            raw_text=raw,
        )

    def _steps_for_search_edit(
        self,
        states: Sequence[FrameVisualState],
        edit_start: int,
        page_url: str,
        search_label: str,
        search_value: str,
        query_label: str,
        action_label: str,
        edit_label: str,
    ) -> list[dict]:
        search_time = round(states[0].timestamp, 2)
        list_time = round(states[max(1, edit_start - 1)].timestamp, 2)
        edit_time = round(states[edit_start].timestamp, 2)
        return [
            self._step(1, search_time, "navigate", "打开业务页面", f"打开网站 {page_url}。", f"浏览器地址栏识别到页面地址为 {page_url}。", page_url, "open_page", "打开页面", [page_url], 0.94),
            self._step(2, search_time, "input_text", "输入筛选条件", f"在{search_label}这里输入{search_value}。", f"搜索区域识别到 {search_label} 输入项，识别值为 {search_value}。", f"{search_label} {search_value}", "input", f"输入{search_label}", [search_label, search_value], 0.92),
            self._step(3, list_time, "click", "执行筛选并等待列表结果返回", f"点击页面上的{query_label}。", f"搜索区域识别到 {query_label} 按钮。", query_label, "click", f"点击{query_label}", [query_label], 0.89),
            self._step(4, list_time, "click", "从结果列表进入编辑页面", f"加载后点击商品列表下的{action_label}。", f"列表操作列识别到 {action_label} 入口。", action_label, "click", f"点击{action_label}", ["列表操作", action_label], 0.88),
            self._step(5, edit_time, "input_text", "修改商品字段信息", f"在{edit_label}下的文本框修改信息。", f"编辑页面识别到 {edit_label} 相关输入区域。", edit_label, "input", f"修改{edit_label}", [edit_label], 0.87),
        ]

    def _steps_for_list_action(
        self,
        states: Sequence[FrameVisualState],
        page_url: str,
        search_label: str,
        search_value: str,
        query_label: str,
        action_label: str,
    ) -> list[dict]:
        start_time = round(states[0].timestamp, 2)
        end_time = round(states[-1].timestamp, 2)
        return [
            self._step(1, start_time, "navigate", "打开业务页面", f"打开网站 {page_url}。", f"浏览器地址栏识别到页面地址为 {page_url}。", page_url, "open_page", "打开页面", [page_url], 0.93),
            self._step(2, start_time, "input_text", "输入筛选条件", f"在{search_label}这里输入{search_value}。", f"搜索区域识别到 {search_label} 输入项，识别值为 {search_value}。", f"{search_label} {search_value}", "input", f"输入{search_label}", [search_label, search_value], 0.91),
            self._step(3, end_time, "click", "触发列表筛选", f"点击页面上的{query_label}。", f"搜索区域识别到 {query_label} 按钮。", query_label, "click", f"点击{query_label}", [query_label], 0.88),
            self._step(4, end_time, "click", "执行列表操作", f"加载后在商品列表中执行{action_label}。", f"列表操作列识别到 {action_label} 入口。", action_label, self._node_type_for_action(action_label), f"执行{action_label}", ["列表操作", action_label], 0.87),
        ]

    def _step(
        self,
        index: int,
        timestamp: float,
        action_type: str,
        intent: str,
        description: str,
        observation: str,
        screen_text: str,
        node_type: str,
        node_name: str,
        node_params: list[str],
        confidence: float,
    ) -> dict:
        return {
            "step": index,
            "time": timestamp,
            "action_type": action_type,
            "intent": intent,
            "screen_observation": observation,
            "description": description,
            "screen_text": screen_text,
            "flow_node": {
                "node_type": node_type,
                "node_name": node_name,
                "node_params": node_params,
                "confidence": confidence,
            },
        }

    def _frame_summaries(self, states: Sequence[FrameVisualState], search_label: str, search_value: str, action_label: str, edit_label: str) -> list[dict]:
        items = []
        for index, state in enumerate(states):
            if state.phase == "edit_form" and edit_label:
                text = f"检测到编辑页 | {edit_label} | {search_value}"
            elif index == 0:
                text = f"检测到列表页 | {search_label} | {search_value}"
            else:
                text = f"检测到结果页 | {action_label or '列表操作'} | {search_value}"
            items.append({"timestamp": round(state.timestamp, 2), "text": text, "score": 0.0, "change_ratio": round(state.change_ratio, 4)})
        return items

    def _ocr(self, image: Image.Image, box: tuple[float, float, float, float], address: bool = False, compact: bool = False) -> str:
        variants = [{"scale": 2, "psm": 6, "mode": "gray"}, {"scale": 3, "psm": 6, "mode": "gray"}]
        if address or compact:
            variants.append({"scale": 4, "psm": 6 if address else 11, "mode": "gray"})
        return self.ocr.read_best_text(self._crop(image, *box), variants=variants).text

    def _crop(self, image: Image.Image, x1: float, y1: float, x2: float, y2: float) -> Image.Image:
        return image.crop((int(image.width * x1), int(image.height * y1), int(image.width * x2), int(image.height * y2)))

    def _extract_search_field(self, text: str) -> tuple[str, str]:
        compact = self._compact(text)
        for canonical, aliases in self.SEARCH_FIELDS:
            for alias in aliases:
                if alias not in compact:
                    continue
                tail = compact.split(alias, 1)[1]
                return canonical, self._extract_field_value(tail)
        return "", self._extract_search_value_only(compact)

    def _extract_field_value(self, tail: str) -> str:
        end = len(tail)
        for token in ["商品ID", "商品名称", "商品品牌", "商品类目", "更新时间", "商品状态", "查询", "搜索", "筛选", "查看", "修改", "编辑"]:
            position = tail.find(token)
            if position != -1:
                end = min(end, position)
        return self._extract_search_value_only(tail[:end])

    def _extract_search_value_only(self, text: str) -> str:
        compact = self._compact(text).upper()
        code = re.search(r"[A-Z]{2,}[A-Z0-9-]{2,}", compact)
        if code:
            return self._normalize_inventory(code.group(0))
        digits = re.search(r"\d{4,}", compact)
        if digits:
            return digits.group(0)
        plain = re.search(r"[\u4e00-\u9fffA-Z0-9-]{3,20}", compact)
        return plain.group(0) if plain else ""

    def _extract_inventory_value(self, text: str) -> str:
        compact = self._compact(text)
        for label in ["商品货号", "货号", "SKU", "SPU", "商品ID"]:
            if label in compact:
                value = self._extract_field_value(compact.split(label, 1)[1])
                if value:
                    return value
        return self._extract_search_value_only(compact)

    def _extract_edit_label(self, text: str) -> str:
        label = self._find_first(self._compact(text), self.EDIT_FIELDS)
        if label in {"标题", "结构化标题"}:
            return "商品标题"
        return label

    def _extract_action_label(self, text: str) -> str:
        compact = self._compact(text)
        for labels in [self.BATCH_ACTIONS, self.EDIT_ACTIONS, self.STATUS_ACTIONS, self.LIST_ACTIONS]:
            found = self._find_first(compact, labels)
            if found:
                return found
        return "修改资料" if ("修改" in compact and "资料" in compact) else ""

    def _extract_url(self, text: str) -> str:
        compact = self._compact(text)
        for source, target in {
            "maln/": "main/",
            "ymaln/": "main/",
            "/maln/": "/main/",
            "/ymaln/": "/main/",
            "goodsMaterialyemld=": "goodsMaterial?emid=",
            "goodsMaterialyemid=": "goodsMaterial?emid=",
            "goodsMaterial?emld=": "goodsMaterial?emid=",
            "https//": "https://",
            "http//": "http://",
        }.items():
            compact = compact.replace(source, target)
        compact = re.sub(r"(?<=\d)/(?=\d)", "", compact)
        match = re.search(r"(?:https?://)?[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:/[a-zA-Z0-9?&=._%/\-]*)?", compact, flags=re.IGNORECASE)
        if not match:
            return ""
        url = match.group(0).rstrip("Qwv")
        return url if url.startswith("http") else f"https://{url}"

    def _normalize_inventory(self, value: str) -> str:
        fixed = value.upper().replace(" ", "")
        fixed = re.sub(r"(?<=[A-Z])I(?=\d)", "1", fixed)
        fixed = re.sub(r"(?<=[A-Z])L(?=\d)", "1", fixed)
        fixed = re.sub(r"(?<=\d)O(?=\d)", "0", fixed)
        fixed = re.sub(r"(?<=\d)S(?=\d)", "5", fixed)
        return fixed

    def _action_kind(self, action_label: str) -> str:
        if action_label in self.EDIT_ACTIONS or action_label == "修改资料":
            return "edit"
        if action_label in self.BATCH_ACTIONS:
            return "batch"
        if action_label in self.STATUS_ACTIONS:
            return "status"
        return "list"

    def _node_type_for_action(self, action_label: str) -> str:
        kind = self._action_kind(action_label)
        return "batch" if kind == "batch" else "status_change" if kind == "status" else "click"

    def _best_search_signal(self, signals: Sequence[SearchSignal]) -> SearchSignal | None:
        best, score = None, -1
        for signal in signals:
            current = 0
            current += 10 if signal.field_label else 0
            current += 8 if signal.query_label else 0
            current += 16 if signal.action_label else 0
            current += 5 if signal.create_label else 0
            current += len(signal.field_value or "")
            current += 8 if signal.url and "edit" not in signal.url.lower() else 0
            if current > score:
                best, score = signal, current
        return best

    def _best_search_value(self, values: Sequence[str]) -> str:
        best, score = "", -1
        for raw in values:
            value = str(raw or "").strip()
            if not value:
                continue
            current = len(value)
            current += 8 if any(char.isdigit() for char in value) else 0
            current += 6 if any(char.isalpha() for char in value) else 0
            current += 6 if re.fullmatch(r"[A-Z0-9-]+", value) else 0
            if current > score:
                best, score = value, current
        return best

    def _best_url(self, signals: Sequence[SearchSignal | EditSignal], prefer_non_edit: bool = False) -> str:
        candidates = [str(signal.url or "").strip() for signal in signals if str(signal.url or "").strip()]
        if prefer_non_edit:
            non_edit = [url for url in candidates if "edit" not in url.lower()]
            if non_edit:
                candidates = non_edit

        best, score = "", -1
        for url in candidates:
            current = len(url) + 8
            current += 10 if "edit" not in url.lower() else 0
            current += 6 if "main/" in url.lower() else 0
            if current > score:
                best, score = url, current
        return best

    def _find_first(self, compact: str, labels: Sequence[str]) -> str:
        best, position = "", None
        for label in labels:
            index = compact.find(label)
            if index == -1:
                continue
            if position is None or index < position:
                best, position = label, index
        return best

    def _sample_search_frames(self, frames: Sequence["CandidateFrame"]) -> list["CandidateFrame"]:
        if len(frames) <= 3:
            return list(frames)
        return [frames[0], frames[len(frames) // 2], frames[-1]]

    def _sample_edit_frames(self, frames: Sequence["CandidateFrame"]) -> list["CandidateFrame"]:
        if len(frames) <= 2:
            return list(frames)
        return [frames[0], frames[-1]]

    def _inspect_frame(self, candidate: "CandidateFrame") -> FrameVisualState:
        saturation = np.array(candidate.image.convert("HSV"), dtype=np.float32)[..., 1] / 255.0
        height, width = saturation.shape
        left_bottom = saturation[int(height * 0.28): int(height * 0.9), : int(width * 0.28)]
        phase = "edit_form" if float(left_bottom.mean()) >= 0.08 else "steady_search" if candidate.change_ratio < 0.02 else "search_list"
        return FrameVisualState(candidate.timestamp, candidate.change_ratio, float(left_bottom.mean()) if left_bottom.size else 0.0, phase)

    def _compact(self, text: str) -> str:
        return re.sub(r"\s+", "", text or "")

    def _confidence(self, page_url: str | None, search_label: str | None, search_value: str | None, action_label: str | None, edit_label: str | None) -> float:
        score = 0.38
        score += 0.18 if page_url else 0.0
        score += 0.14 if search_label else 0.0
        score += 0.12 if search_value else 0.0
        score += 0.1 if action_label else 0.0
        score += 0.08 if edit_label else 0.0
        return round(min(score, 0.97), 2)

    def _first_non_empty(self, values: Iterable[str]) -> str:
        for value in values:
            cleaned = str(value or "").strip()
            if cleaned:
                return cleaned
        return ""
