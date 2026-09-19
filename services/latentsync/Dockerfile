FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PORT=8080
ENV HF_HOME=/opt/hf-cache
ENV TORCH_HOME=/opt/torch-cache

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.10 python3-pip python3-dev build-essential \
    git git-lfs ffmpeg curl ca-certificates libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt
RUN git clone https://github.com/bytedance/LatentSync.git latentsync \
    && cd latentsync \
    && git checkout a229c3948406bc2cf6eaf4873e662e70c6a04746

WORKDIR /opt/latentsync
RUN python3 -m pip install --upgrade pip setuptools wheel \
    && python3 -m pip install -r requirements.txt \
    && python3 -m pip install \
        fastapi==0.115.12 \
        uvicorn==0.34.2 \
        python-multipart==0.0.20 \
        google-cloud-storage==3.1.0 \
        protobuf==3.20.3 \
    && python3 -m pip check

RUN mkdir -p checkpoints/whisper /opt/hf-cache /opt/torch-cache \
    && huggingface-cli download ByteDance/LatentSync-1.6 latentsync_unet.pt --local-dir checkpoints \
    && huggingface-cli download ByteDance/LatentSync-1.6 whisper/tiny.pt --local-dir checkpoints \
    && python3 -c "from huggingface_hub import snapshot_download; snapshot_download('stabilityai/sd-vae-ft-mse', cache_dir='/opt/hf-cache', allow_patterns=['config.json','diffusion_pytorch_model.safetensors','diffusion_pytorch_model.bin'])" \
    && test -s checkpoints/latentsync_unet.pt \
    && test -s checkpoints/whisper/tiny.pt

COPY public/maria-veo-idle.mp4 /opt/maria/maria-veo-idle.mp4
COPY services/latentsync/server.py /opt/latentsync/server.py
COPY services/latentsync/job.py /opt/latentsync/job.py

EXPOSE 8080
CMD ["bash", "-lc", "uvicorn server:app --host 0.0.0.0 --port ${PORT}"]
