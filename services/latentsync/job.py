import json
import os
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import quote, urlencode, urlparse
from urllib.request import Request, urlopen

APP_ROOT = Path("/opt/latentsync")
DEFAULT_VIDEO = Path("/opt/maria/maria-veo-idle.mp4")
METADATA_TOKEN_URL = (
    "http://metadata.google.internal/computeMetadata/v1/"
    "instance/service-accounts/default/token"
)


def parse_gcs_uri(uri: str) -> tuple[str, str]:
    parsed = urlparse(uri)
    object_name = parsed.path.lstrip("/")
    if parsed.scheme != "gs" or not parsed.netloc or not object_name:
        raise ValueError(f"Invalid Cloud Storage URI: {uri}")
    return parsed.netloc, object_name


def access_token() -> str:
    request = Request(METADATA_TOKEN_URL, headers={"Metadata-Flavor": "Google"})
    with urlopen(request, timeout=30) as response:
        payload = json.load(response)
    token = payload.get("access_token")
    if not token:
        raise RuntimeError("Metadata server returned an empty access token")
    return token


def download(uri: str, destination: Path) -> None:
    bucket, object_name = parse_gcs_uri(uri)
    endpoint = (
        f"https://storage.googleapis.com/download/storage/v1/b/{quote(bucket, safe='')}"
        f"/o/{quote(object_name, safe='')}?alt=media"
    )
    request = Request(endpoint, headers={"Authorization": f"Bearer {access_token()}"})
    with urlopen(request, timeout=300) as response, destination.open("wb") as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)


def upload(source: Path, uri: str) -> None:
    bucket, object_name = parse_gcs_uri(uri)
    query = urlencode({"uploadType": "media", "name": object_name})
    endpoint = (
        f"https://storage.googleapis.com/upload/storage/v1/b/{quote(bucket, safe='')}"
        f"/o?{query}"
    )
    request = Request(
        endpoint,
        data=source.read_bytes(),
        method="POST",
        headers={
            "Authorization": f"Bearer {access_token()}",
            "Content-Type": "video/mp4",
        },
    )
    with urlopen(request, timeout=600) as response:
        if response.status not in (200, 201):
            raise RuntimeError(f"Cloud Storage upload returned {response.status}")


def main() -> None:
    input_audio_uri = os.environ["INPUT_AUDIO_URI"]
    output_video_uri = os.environ["OUTPUT_VIDEO_URI"]
    source_video_uri = os.getenv("SOURCE_VIDEO_URI")

    with tempfile.TemporaryDirectory(prefix="maria-lipsync-job-") as work:
        work_dir = Path(work)
        audio_path = work_dir / "speech.mp3"
        output_path = work_dir / "maria-lipsync.mp4"
        video_path = DEFAULT_VIDEO

        download(input_audio_uri, audio_path)
        if not audio_path.is_file() or audio_path.stat().st_size == 0:
            raise RuntimeError("Input audio is empty")

        if source_video_uri:
            video_path = work_dir / "source.mp4"
            download(source_video_uri, video_path)

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

        upload(output_path, output_video_uri)
        print(f"Uploaded lip-sync result to {output_video_uri}", flush=True)


if __name__ == "__main__":
    main()
