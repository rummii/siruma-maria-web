import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

APP_ROOT = Path("/opt/latentsync")
DEFAULT_VIDEO = Path("/opt/maria/maria-veo-idle.mp4")
MAX_AUDIO_BYTES = 10 * 1024 * 1024

app = FastAPI(title="Maria LatentSync Service", version="1.0.0")


@app.get("/healthz")
def healthz() -> dict[str, str]:
    required = [
        DEFAULT_VIDEO,
        APP_ROOT / "checkpoints/latentsync_unet.pt",
        APP_ROOT / "checkpoints/whisper/tiny.pt",
        APP_ROOT / "configs/unet/stage2_512.yaml",
    ]
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        raise HTTPException(status_code=503, detail={"missing": missing})
    return {"status": "ok", "model": "LatentSync-1.6"}


@app.post("/v1/lipsync")
def lipsync(audio: UploadFile = File(...)) -> FileResponse:
    content_type = (audio.content_type or "").lower()
    if content_type and not (
        content_type.startswith("audio/")
        or content_type in {"application/octet-stream", "video/mp4"}
    ):
        raise HTTPException(status_code=415, detail="An audio file is required")

    with tempfile.TemporaryDirectory(prefix="maria-lipsync-") as work:
        work_dir = Path(work)
        audio_path = work_dir / "speech.mp3"
        output_path = work_dir / "maria-lipsync.mp4"

        with audio_path.open("wb") as destination:
            shutil.copyfileobj(audio.file, destination)

        if audio_path.stat().st_size == 0:
            raise HTTPException(status_code=400, detail="The audio file is empty")
        if audio_path.stat().st_size > MAX_AUDIO_BYTES:
            raise HTTPException(status_code=413, detail="The audio file is too large")

        command = [
            "python3",
            "-m",
            "scripts.inference",
            "--unet_config_path",
            "configs/unet/stage2_512.yaml",
            "--inference_ckpt_path",
            "checkpoints/latentsync_unet.pt",
            "--inference_steps",
            os.getenv("LATENTSYNC_STEPS", "20"),
            "--guidance_scale",
            os.getenv("LATENTSYNC_GUIDANCE", "1.5"),
            "--enable_deepcache",
            "--video_path",
            str(DEFAULT_VIDEO),
            "--audio_path",
            str(audio_path),
            "--video_out_path",
            str(output_path),
        ]

        try:
            subprocess.run(
                command,
                cwd=APP_ROOT,
                check=True,
                timeout=3300,
                capture_output=True,
                text=True,
            )
        except subprocess.TimeoutExpired as error:
            raise HTTPException(status_code=504, detail="Lip-sync generation timed out") from error
        except subprocess.CalledProcessError as error:
            message = (error.stderr or error.stdout or "LatentSync failed")[-4000:]
            raise HTTPException(status_code=500, detail=message) from error

        if not output_path.is_file() or output_path.stat().st_size == 0:
            raise HTTPException(status_code=500, detail="LatentSync did not produce a video")

        handle, persisted_name = tempfile.mkstemp(prefix="maria-output-", suffix=".mp4")
        os.close(handle)
        persisted_output = Path(persisted_name)
        shutil.copy2(output_path, persisted_output)

    return FileResponse(
        persisted_output,
        media_type="video/mp4",
        filename="maria-lipsync.mp4",
        background=BackgroundTask(persisted_output.unlink, missing_ok=True),
        headers={"X-Maria-Lipsync": "LatentSync-1.6"},
    )
