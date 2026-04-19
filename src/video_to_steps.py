from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import shutil
import subprocess
import tempfile

import numpy as np
from PIL import Image

from src.local_workflow_analyzer import LocalWorkflowAnalyzer
from src.multimodal_writer import MultimodalStepWriter
from src.ocr_engine import OCREngine
from src.process_narrator import ProcessNarrator
from src.step_writer import FrameSummary, StepWriter


@dataclass
class CandidateFrame:
    timestamp: float
    image: Image.Image
    change_ratio: float


class VideoToStepsPipeline:
    def __init__(self) -> None:
        self.ocr = OCREngine()
        self.writer = StepWriter()
        self.local_analyzer = LocalWorkflowAnalyzer(self.ocr)
        self.multimodal_writer = MultimodalStepWriter()
        self.narrator = ProcessNarrator()

    def run(
        self,
        video_path: Path,
        use_multimodal: bool = False,
        model_config: dict | None = None,
    ) -> dict:
        candidates = self._extract_candidate_frames(video_path)
        local_result = self.local_analyzer.analyze(candidates)
        summaries: list[FrameSummary] = []
        process_description_source = "local_template"

        if local_result:
            draft_steps = self.writer.normalize_steps(
                local_result["steps"],
                frame_count=len(local_result["steps"]),
            )
            steps = draft_steps
            workflow_hint = str(local_result["workflow_id"])
            process_description = self.narrator.build(draft_steps, workflow_hint=workflow_hint)
            mode = "local_workflow"
            process_description_source = "structured_steps_narrator"
            response_frame_summaries = local_result.get("frame_summaries") or [
                {
                    "timestamp": item.timestamp,
                    "text": item.text,
                    "score": round(item.score, 4),
                    "change_ratio": round(item.change_ratio, 4),
                }
                for item in summaries
            ]
        else:
            summaries = self._summarize_frames(candidates)
            draft_steps = self.writer.normalize_steps(
                self.writer.build(summaries),
                frame_count=len(summaries),
            )
            steps = draft_steps
            workflow_hint = self._workflow_hint(candidates, draft_steps)
            process_description = self.narrator.build(draft_steps, workflow_hint=workflow_hint)
            mode = "rule_based"
            process_description_source = "rule_narrator"
            response_frame_summaries = [
                {
                    "timestamp": item.timestamp,
                    "text": item.text,
                    "score": round(item.score, 4),
                    "change_ratio": round(item.change_ratio, 4),
                }
                for item in summaries
            ]

        multimodal_error = None

        if use_multimodal:
            if not summaries:
                summaries = self._summarize_frames(candidates)
            multimodal_result = self.multimodal_writer.rewrite(
                frames=summaries,
                frame_images=[item.image for item in candidates[: min(len(candidates), 8)]],
                draft_steps=draft_steps,
                model_config=model_config,
            )
            if multimodal_result and isinstance(multimodal_result.get("_error"), dict):
                multimodal_error = multimodal_result["_error"]
            elif multimodal_result and isinstance(multimodal_result.get("steps"), list):
                steps = self.writer.normalize_steps(
                    multimodal_result["steps"],
                    frame_count=len(summaries),
                )
                process_description = self._resolve_process_description(
                    multimodal_result,
                    steps,
                    workflow_hint=workflow_hint,
                )
                mode = "multimodal"
                process_description_source = "multimodal_rewrite"

            ai_process_description = self.multimodal_writer.summarize_process(
                steps=steps,
                frame_summaries=response_frame_summaries,
                workflow_hint=workflow_hint,
                current_process_description=process_description,
                model_config=model_config,
            )
            if ai_process_description and isinstance(ai_process_description.get("_error"), dict):
                if multimodal_error is None:
                    multimodal_error = ai_process_description["_error"]
            elif ai_process_description:
                process_description = self._merge_process_description(process_description, ai_process_description)
                process_description_source = "ai_structured_summary"

        return {
            "video": str(video_path),
            "summary": {
                "candidate_frames": len(candidates),
                "steps": len(steps),
                "mode": mode,
                "workflow_hint": workflow_hint,
                "process_description_source": process_description_source,
                "multimodal_available": use_multimodal and self.multimodal_writer.is_enabled(model_config),
                "schema_version": "step-schema.v2",
            },
            "multimodal_config": self.multimodal_writer.preview_config(model_config),
            "multimodal_error": multimodal_error,
            "process_description": process_description,
            "draft_steps": draft_steps,
            "steps": steps,
            "frame_summaries": response_frame_summaries,
        }

    def _resolve_process_description(
        self,
        multimodal_result: dict,
        steps: list[dict],
        workflow_hint: str | None = None,
    ) -> dict:
        generated = multimodal_result.get("process_description")
        fallback = self.narrator.build(steps, workflow_hint=workflow_hint)
        if not isinstance(generated, dict):
            return fallback
        full_text = str(generated.get("full_text") or "").strip()
        if not full_text:
            return fallback
        return {
            "title": str(generated.get("title") or fallback["title"]),
            "overview": str(generated.get("overview") or fallback["overview"]),
            "full_text": full_text,
        }

    def _merge_process_description(self, fallback: dict, generated: dict) -> dict:
        return {
            "title": str(generated.get("title") or fallback.get("title") or "流程说明"),
            "overview": str(generated.get("overview") or fallback.get("overview") or ""),
            "full_text": str(generated.get("full_text") or fallback.get("full_text") or ""),
        }

    def _extract_candidate_frames(self, video_path: Path) -> list[CandidateFrame]:
        ffmpeg = self._resolve_ffmpeg()
        if ffmpeg is None:
            raise RuntimeError("未找到 ffmpeg。请安装 ffmpeg，或确认影刀安装目录中存在 ffmpeg.exe。")

        candidates: list[CandidateFrame] = []
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            pattern = temp_path / "frame_%05d.jpg"
            cmd = [
                str(ffmpeg),
                "-i",
                str(video_path),
                "-vf",
                "fps=1/1.2",
                "-q:v",
                "3",
                str(pattern),
            ]
            subprocess.run(cmd, check=True, capture_output=True)

            frame_files = sorted(temp_path.glob("frame_*.jpg"))
            last_gray: np.ndarray | None = None
            for index, frame_file in enumerate(frame_files):
                image = Image.open(frame_file).convert("RGB")
                gray = np.array(image.convert("L"))
                change_ratio = self._frame_change_ratio(last_gray, gray)
                if last_gray is None or change_ratio >= 0.02:
                    candidates.append(
                        CandidateFrame(
                            timestamp=index * 1.2,
                            image=image,
                            change_ratio=change_ratio,
                        )
                    )
                    last_gray = gray
        return candidates[:20]

    def _summarize_frames(self, frames: list[CandidateFrame]) -> list[FrameSummary]:
        summaries: list[FrameSummary] = []
        for frame in frames:
            lines = self.ocr.read_lines(frame.image)
            score = 0.0
            if lines:
                score = sum(line.score for line in lines) / len(lines)
            text = self.ocr.join_text(lines)
            summaries.append(
                FrameSummary(
                    timestamp=frame.timestamp,
                    text=text,
                    score=score,
                    change_ratio=frame.change_ratio,
                )
            )
        return self._deduplicate(summaries)

    def _deduplicate(self, summaries: list[FrameSummary]) -> list[FrameSummary]:
        result: list[FrameSummary] = []
        last_text = ""
        for summary in summaries:
            normalized = summary.text.strip()
            if normalized and normalized == last_text:
                continue
            result.append(summary)
            last_text = normalized
        return result

    def _frame_change_ratio(self, prev_gray: np.ndarray | None, gray: np.ndarray) -> float:
        if prev_gray is None:
            return 1.0

        diff = np.abs(prev_gray.astype(np.int16) - gray.astype(np.int16))
        changed_pixels = float(np.count_nonzero(diff > 25))
        return changed_pixels / float(diff.size)

    def _resolve_ffmpeg(self) -> Path | None:
        system_ffmpeg = shutil.which("ffmpeg")
        if system_ffmpeg:
            return Path(system_ffmpeg)

        shadowbot_ffmpeg = Path(r"D:\应用\ShadowBot\shadowbot-6.0.30\ffmpeg.exe")
        if shadowbot_ffmpeg.exists():
            return shadowbot_ffmpeg

        return None

    def _workflow_hint(self, candidates: list[CandidateFrame], steps: list[dict]) -> str | None:
        if len(candidates) < 4:
            return None
        if any(str(step.get("screen_text") or "").strip() for step in steps):
            return None
        action_types = {str(step.get("action_type") or "") for step in steps}
        if action_types.issubset({"navigate", "wait", "unknown"}):
            return "search_edit_flow"
        return None
