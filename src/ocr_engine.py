from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
import os
import re
import shutil

from PIL import Image, ImageFilter, ImageOps

try:
    import pytesseract
    from pytesseract import Output
except Exception:  # pragma: no cover - import availability varies by machine
    pytesseract = None
    Output = None


@dataclass
class OCRLine:
    text: str
    score: float


@dataclass
class OCRTextResult:
    text: str
    score: float


class OCREngine:
    def __init__(self) -> None:
        self.base_dir = Path(__file__).resolve().parent.parent
        self.tesseract_cmd = self._resolve_tesseract()
        self.tessdata_dir = self._resolve_tessdata()
        self.available = bool(pytesseract and self.tesseract_cmd and self.tessdata_dir)

        if self.available and pytesseract:
            pytesseract.pytesseract.tesseract_cmd = str(self.tesseract_cmd)
            os.environ["TESSDATA_PREFIX"] = str(self.tessdata_dir)

    def read_lines(self, image: Image.Image) -> list[OCRLine]:
        if not self.available or pytesseract is None or Output is None:
            return []

        best = self.read_best_text(
            image,
            variants=[
                {"scale": 2, "psm": 6, "mode": "gray"},
                {"scale": 3, "psm": 6, "mode": "gray"},
            ],
        )
        if not best.text:
            return []

        pieces = [part.strip() for part in re.split(r"[\n|]", best.text) if part.strip()]
        unique: list[OCRLine] = []
        seen: set[str] = set()
        for part in pieces:
            normalized = self._normalize_text(part)
            if len(normalized) < 2 or normalized in seen:
                continue
            seen.add(normalized)
            unique.append(OCRLine(text=normalized, score=best.score))
        return unique

    def read_best_text(
        self,
        image: Image.Image,
        *,
        lang: str = "chi_sim+eng",
        variants: list[dict] | None = None,
    ) -> OCRTextResult:
        if not self.available or pytesseract is None or Output is None:
            return OCRTextResult(text="", score=0.0)

        candidates = variants or [
            {"scale": 2, "psm": 6, "mode": "gray"},
            {"scale": 3, "psm": 6, "mode": "gray"},
            {"scale": 4, "psm": 11, "mode": "gray"},
        ]

        best = OCRTextResult(text="", score=0.0)
        best_rank = -1.0

        for variant in candidates:
            prepared = self._preprocess(
                image,
                scale=int(variant.get("scale", 2)),
                mode=str(variant.get("mode", "gray")),
                threshold=variant.get("threshold"),
            )
            config = f"--psm {int(variant.get('psm', 6))}"
            try:
                data = pytesseract.image_to_data(
                    prepared,
                    lang=lang,
                    config=config,
                    output_type=Output.DICT,
                )
            except Exception:
                continue

            words: list[str] = []
            scores: list[float] = []
            for text, conf in zip(data.get("text", []), data.get("conf", [])):
                token = self._normalize_text(str(text))
                if not token:
                    continue
                try:
                    confidence = float(conf)
                except (TypeError, ValueError):
                    continue
                if confidence < 0:
                    continue
                words.append(token)
                scores.append(confidence / 100.0)

            if not words:
                continue

            text = " ".join(words)
            score = sum(scores) / len(scores)
            rank = score + min(len(text) / 120.0, 0.4)
            if rank > best_rank:
                best_rank = rank
                best = OCRTextResult(text=text, score=score)

        return best

    def join_text(self, lines: Iterable[OCRLine]) -> str:
        unique: list[str] = []
        seen: set[str] = set()
        for line in lines:
            normalized = self._normalize_text(line.text)
            if len(normalized) < 2 or normalized in seen:
                continue
            seen.add(normalized)
            unique.append(normalized)
        return " | ".join(unique)

    def _preprocess(
        self,
        image: Image.Image,
        *,
        scale: int = 2,
        mode: str = "gray",
        threshold: int | None = None,
    ) -> Image.Image:
        resized = image.resize((image.width * scale, image.height * scale))
        gray = ImageOps.grayscale(resized)
        gray = ImageOps.autocontrast(gray)
        gray = gray.filter(ImageFilter.SHARPEN)

        if mode == "binary":
            limit = 185 if threshold is None else int(threshold)
            gray = gray.point(lambda value: 255 if value > limit else 0)

        return gray

    def _normalize_text(self, text: str) -> str:
        text = text.replace("\u2014", "-").replace("\u201c", "").replace("\u201d", "")
        text = text.replace("\u00a9", "").replace("\u00ab", "").replace("\u00ae", "")
        text = re.sub(r"\s+", " ", text)
        return text.strip()

    def _resolve_tesseract(self) -> Path | None:
        system = shutil.which("tesseract")
        if system:
            return Path(system)

        default = Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe")
        if default.exists():
            return default
        return None

    def _resolve_tessdata(self) -> Path | None:
        local = self.base_dir / "data" / "tessdata"
        if (local / "chi_sim.traineddata").exists():
            return local

        default = Path(r"C:\Program Files\Tesseract-OCR\tessdata")
        if (default / "eng.traineddata").exists():
            return default
        return None
