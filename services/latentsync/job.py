import os
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from google.cloud import storage

APP_ROOT = Path("/opt/latentsync")
DEFAULT_VIDEO = Path("/opt/maria/maria-veo-idle.mp4")


def parse_gcs_uri(uri: str) -> tuple[str, str]:
    parsed = urlparse(uri)
    if parsed.scheme != "gs" or not parsed.netloc or not parsed.path.lstrip("/"):
        raise ValueError(f"Invalid Cloud Storage URI: {uri}")
    return parsed.netloc, parsed.path.lstrip("/")


def download(client: storage.Client, uri: str, destination: Path) -> None:
    bucket_name, object_name = parse_gcs_uri(uri)
    client.bucket(bucket_name).blob(object_name).download_to_filename(destination)


def upload(client: storage.Client, source: Path, uri: str) -> None:
    bucket_name, object_name = parse_gcs_uri(uri)
    client.bucket(bucket_name).blob(object_name).upload_from_filename(
        source, content_type="video/mp4"
    )


def main() -> None:
    input_audio_uri = os.environ["INPUT_AUDIO_URI"]
    output_video_uri = os.environ["OUTPUT_VIDEO_URI"]
    source_video_uri = os.getenv("SOURCE_VIDEO_URI")

    client = storage.Client()

    with tempfile.TemporaryDirectory(prefix="maria-lipsync-job-") as work:
        work_dir = Path(work)
        audio_path = work_dir / "speech.mp3"
        output_path = work_dir / "maria-lipsync.mp4"
        video_path = DEFAULT_VIDEO

        download(client, input_audio_uri, audio_path)
        if not audio_path.is_file() or audio_path.stat().st_size == 0:
            raise RuntimeError("Input audio is empty")

        if source_video_uri:
            video_path = work_dir / "source.mp4"
            download(client, source_video_uri, video_path)

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
            str(video_path),
            "--audio_path",
            str(audio_path),
            "--video_out_path",
            str(output_path),
        ]

        subprocess.run(command, cwd=APP_ROOT, check=True, timeout=3300)

        if not output_path.is_file() or output_path.stat().st_size == 0:
            raise RuntimeError("LatentSync did not produce a video")

        upload(client, output_path, output_video_uri)
        print(f"Uploaded lip-sync result to {output_video_uri}", flush=True)


if __name__ == "__main__":
    main()
