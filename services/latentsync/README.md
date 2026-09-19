# Maria LatentSync service

This service converts Maria's existing idle MP4 and Google Cloud TTS audio into a lip-synced MP4 using ByteDance LatentSync 1.6.

The upstream source is pinned to commit `a229c3948406bc2cf6eaf4873e662e70c6a04746`. The service is intended to run privately on Cloud Run with one NVIDIA L4 GPU and concurrency 1.

## Build

Run from the repository root:

```bash
gcloud builds submit --config services/latentsync/cloudbuild.yaml .
```

Use the image tag printed by Cloud Build for deployment.

## Deploy

```bash
gcloud run deploy maria-latentsync \
  --image IMAGE_FROM_CLOUD_BUILD \
  --region asia-southeast1 \
  --service-account maria-runtime@siruma-maria-voice.iam.gserviceaccount.com \
  --execution-environment gen2 \
  --cpu 8 \
  --memory 32Gi \
  --gpu 1 \
  --gpu-type nvidia-l4 \
  --no-gpu-zonal-redundancy \
  --no-cpu-throttling \
  --concurrency 1 \
  --min 0 \
  --max 1 \
  --timeout 3600s \
  --port 8080 \
  --no-allow-unauthenticated
```

Grant the `maria-runtime` service account Cloud Run Invoker on `maria-latentsync`. Set `LATENTSYNC_URL` on the `maria-web` service to the private service URL, then deploy a new website revision.

If `LATENTSYNC_URL` is absent or the service fails, the website keeps using Google TTS with the idle animation.
