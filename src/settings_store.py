from __future__ import annotations

import json
from pathlib import Path


class SettingsStore:
    def __init__(self, base_dir: Path) -> None:
        self.base_dir = base_dir
        self.settings_path = self.base_dir / "data" / "multimodal_settings.json"
        self.settings_path.parent.mkdir(parents=True, exist_ok=True)

    def load(self) -> dict:
        if not self.settings_path.exists():
            return {
                "model": "",
                "base_url": "",
                "api_key": "",
            }

        try:
            data = json.loads(self.settings_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {
                "model": "",
                "base_url": "",
                "api_key": "",
            }

        return {
            "model": str(data.get("model") or "").strip(),
            "base_url": str(data.get("base_url") or "").strip(),
            "api_key": str(data.get("api_key") or "").strip(),
        }

    def save(
        self,
        model: str,
        base_url: str,
        api_key: str | None,
        preserve_existing_key: bool = True,
    ) -> dict:
        current = self.load()
        final_api_key = current["api_key"]
        if api_key is not None:
            cleaned_api_key = api_key.strip()
            if cleaned_api_key:
                final_api_key = cleaned_api_key
            elif not preserve_existing_key:
                final_api_key = ""

        payload = {
            "model": model.strip(),
            "base_url": base_url.strip(),
            "api_key": final_api_key,
        }
        self.settings_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return payload

    def preview(self) -> dict:
        loaded = self.load()
        return {
            "model": loaded["model"],
            "base_url": loaded["base_url"],
            "has_api_key": bool(loaded["api_key"]),
            "api_key_masked": self._mask_key(loaded["api_key"]),
        }

    def _mask_key(self, api_key: str) -> str:
        if not api_key:
            return ""
        if len(api_key) <= 8:
            return "*" * len(api_key)
        return f"{api_key[:6]}...{api_key[-4:]}"
