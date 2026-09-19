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

Capture the private service URL:

```bash
LATENTSYNC_URL="$(gcloud run services describe maria-latentsync \
  --region asia-southeast1 \
  --format='value(status.url)')"
```

Allow only Maria's runtime identity to invoke the service:

```bash
gcloud run services add-iam-policy-binding maria-latentsync \
  --region asia-southeast1 \
  --member='serviceAccount:maria-runtime@siruma-maria-voice.iam.gserviceaccount.com' \
  --role='roles/run.invoker'
```

Enable lip sync in the website without exposing the GPU service URL to browsers:

```bash
gcloud run services update maria-web \
  --region asia-southeast1 \
  --update-env-vars "LATENTSYNC_URL=${LATENTSYNC_URL}"
```

Deploy the website image containing this branch only after the GPU service passes its health and sample-generation tests.

If `LATENTSYNC_URL` is absent or the service fails, the website keeps using Google TTS with the idle animation.
