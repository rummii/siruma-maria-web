# Maria — Google Cloud deployment

Project: `siruma-maria-voice`  
Region: `asia-southeast1`  
Runtime identity: `maria-runtime@siruma-maria-voice.iam.gserviceaccount.com`

## Build the website container

From the extracted `maria-google-cloud` directory in Cloud Shell:

```bash
gcloud builds submit \
  --tag asia-southeast1-docker.pkg.dev/siruma-maria-voice/maria-containers/maria-web:latest
```

## Deploy the website

```bash
gcloud run deploy maria-web \
  --image asia-southeast1-docker.pkg.dev/siruma-maria-voice/maria-containers/maria-web:latest \
  --region asia-southeast1 \
  --platform managed \
  --service-account maria-runtime@siruma-maria-voice.iam.gserviceaccount.com \
  --allow-unauthenticated \
  --port 8080 \
  --cpu 2 \
  --memory 2Gi \
  --min-instances 0 \
  --max-instances 5
```

The application uses the attached runtime identity to call Google Cloud Text-to-Speech. No API key or downloaded service-account key is required.
