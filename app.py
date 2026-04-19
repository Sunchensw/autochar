from pathlib import Path
import os
import shutil
import uuid

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from src.settings_store import SettingsStore
from src.video_to_steps import VideoToStepsPipeline


BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
STYLE_PATH = BASE_DIR / "static" / "style.css"

app = FastAPI(title="AutoChar", version="0.1.0")
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))
pipeline = VideoToStepsPipeline()
settings_store = SettingsStore(BASE_DIR)


class SettingsPayload(BaseModel):
    model: str = ""
    base_url: str = ""
    api_key: str = ""
    clear_api_key: bool = False


@app.get("/", response_class=HTMLResponse)
async def index(request: Request) -> HTMLResponse:
    stored_preview = settings_store.preview()
    style_version = str(int(STYLE_PATH.stat().st_mtime)) if STYLE_PATH.exists() else "1"
    return templates.TemplateResponse(
        request,
        "index.html",
        {
            "request": request,
            "style_version": style_version,
            "multimodal_enabled": False,
            "default_model": stored_preview["model"] or os.getenv("OPENAI_VISION_MODEL", "gpt-4.1-mini"),
            "default_base_url": stored_preview["base_url"] or os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
            "saved_settings": stored_preview,
        },
    )


@app.get("/settings")
async def get_settings() -> JSONResponse:
    stored = settings_store.preview()
    if not stored["model"]:
        stored["model"] = os.getenv("OPENAI_VISION_MODEL", "gpt-4.1-mini")
    if not stored["base_url"]:
        stored["base_url"] = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
    return JSONResponse(stored)


@app.post("/settings")
async def save_settings(payload: SettingsPayload) -> JSONResponse:
    saved = settings_store.save(
        model=payload.model,
        base_url=payload.base_url,
        api_key=payload.api_key,
        preserve_existing_key=not payload.clear_api_key,
    )
    preview = settings_store.preview()
    return JSONResponse(
        {
            "saved": True,
            "model": saved["model"],
            "base_url": saved["base_url"],
            "has_api_key": preview["has_api_key"],
            "api_key_masked": preview["api_key_masked"],
        }
    )


@app.post("/analyze")
async def analyze_video(
    file: UploadFile = File(...),
    use_multimodal: bool = Form(False),
    multimodal_model: str = Form(""),
    multimodal_api_key: str = Form(""),
    multimodal_base_url: str = Form(""),
) -> JSONResponse:
    suffix = Path(file.filename or "upload.mp4").suffix or ".mp4"
    upload_path = UPLOAD_DIR / f"{uuid.uuid4().hex}{suffix}"

    with upload_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    stored = settings_store.load()
    model_config = {
        "model": multimodal_model.strip() or stored["model"],
        "api_key": multimodal_api_key.strip() or stored["api_key"],
        "base_url": multimodal_base_url.strip() or stored["base_url"],
    }
    result = pipeline.run(
        upload_path,
        use_multimodal=use_multimodal,
        model_config=model_config,
    )
    return JSONResponse(result)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=False)
