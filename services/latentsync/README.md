# Maria LatentSync GPU job

This component converts Maria's existing idle MP4 and Google Cloud TTS audio into a lip-synced MP4 using ByteDance LatentSync 1.6.

The upstream source is pinned to commit `a229c3948406bc2cf6eaf4873e662e70c6a04746`. LatentSync runs as an asynchronous Cloud Run GPU Job rather than an HTTP GPU service. The website uploads each audio file to Cloud Storage, starts one job execution, waits for it, downloads the generated MP4, and deletes the temporary objects.

## Build

Run from the repository root on branch `feature/latentsync-cloud-run`:

```bash
gcloud builds submit --config services/latentsync/cloudbuild.yaml .
```

The build publishes:

```text
asia-southeast1-docker.pkg.dev/siruma-maria-voice/maria-containers/maria-latentsync:job-candidate
```

## Deploy the GPU job

```bash
gcloud run jobs deploy maria-latentsync-job \
  --image=asia-southeast1-docker.pkg.dev/siruma-maria-voice/maria-containers/maria-latentsync:job-candidate \
  --project=siruma-maria-voice \
  --region=asia-southeast1 \
  --service-account=maria-runtime@siruma-maria-voice.iam.gserviceaccount.com \
  --execution-environment=gen2 \
  --cpu=8 \
  --memory=32Gi \
  --gpu=1 \
  --gpu-type=nvidia-l4 \
  --no-gpu-zonal-redundancy \
  --task-timeout=3600s \
  --max-retries=0 \
  --command=python3 \
  --args=job.py
```

## Permissions

Allow the runtime identity to read and write temporary media objects:

```bash
gcloud storage buckets add-iam-policy-binding \
  gs://siruma-maria-voice-assets-1093859359152 \
  --member=serviceAccount:maria-runtime@siruma-maria-voice.iam.gserviceaccount.com \
  --role=roles/storage.objectAdmin
```

Allow the website runtime to run this job with per-execution input and output overrides:

```bash
gcloud run jobs add-iam-policy-binding maria-latentsync-job \
  --project=siruma-maria-voice \
  --region=asia-southeast1 \
  --member=serviceAccount:maria-runtime@siruma-maria-voice.iam.gserviceaccount.com \
  --role=roles/run.developer
```

## Configure the website

The website and job intentionally use the same runtime service account. Configure the website with the job and bucket names and allow long-running responses:

```bash
gcloud run services update maria-web \
  --project=siruma-maria-voice \
  --region=asia-southeast1 \
  --timeout=3600s \
  --update-env-vars="GOOGLE_CLOUD_PROJECT=siruma-maria-voice,LATENTSYNC_JOB=maria-latentsync-job,LATENTSYNC_REGION=asia-southeast1,LATENTSYNC_BUCKET=siruma-maria-voice-assets-1093859359152"
```

Deploy the website image containing this branch only after a manual GPU job execution succeeds.

If the job is not configured or generation fails, Maria's frontend retains its existing Google TTS and idle-animation fallback.
