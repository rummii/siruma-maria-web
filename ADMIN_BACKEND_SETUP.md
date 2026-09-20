# Maria Admin Backend — Google Cloud Setup

This feature branch adds:

- `/admin` dashboard protected by Google Sign-In plus an administrator email allowlist.
- Firestore-backed messages, system instructions, language, voice/accent, suggestions, and knowledge entries.
- Cloud Storage avatar uploads served through the application, so the bucket remains private.
- Vertex AI Gemini answers grounded in enabled knowledge entries.
- Runtime configuration: admin changes do not require rebuilding the website.

## 1. Firestore

Check whether the default database exists:

```bash
gcloud firestore databases describe \
  --project=siruma-maria-voice \
  --database='(default)'
```

If it does not exist:

```bash
gcloud firestore databases create \
  --project=siruma-maria-voice \
  --database='(default)' \
  --location=asia-southeast1 \
  --type=firestore-native
```

The runtime service account needs `roles/datastore.user` (already granted in the current project).

## 2. Google administrator sign-in

In Google Cloud Console:

1. Open **APIs & Services → Credentials**.
2. Configure the OAuth consent screen.
3. Create **OAuth client ID → Web application**.
4. Add the test and production Cloud Run URLs to **Authorized JavaScript origins**.
5. Copy the OAuth client ID.

The server verifies every Google ID token and then checks the email against `ADMIN_EMAILS`.

## 3. Runtime service account

Required roles for `maria-runtime@siruma-maria-voice.iam.gserviceaccount.com`:

- `roles/datastore.user`
- `roles/storage.objectAdmin`
- `roles/aiplatform.user`
- `roles/serviceusage.serviceUsageConsumer`
- `roles/speech.client`
- `roles/logging.logWriter`

## 4. Cloud Run environment

Deploy with these environment variables:

```bash
--set-env-vars="GOOGLE_CLOUD_PROJECT=siruma-maria-voice,GOOGLE_CLIENT_ID=YOUR_OAUTH_CLIENT_ID,ADMIN_EMAILS=paraglidingphilippines@gmail.com,MARIA_ASSET_BUCKET=siruma-maria-voice-assets-1093859359152,VERTEX_AI_REGION=us-central1,GEMINI_MODEL=gemini-2.5-flash"
```

Separate multiple administrator emails with commas.

## 5. Admin dashboard

Open:

```text
https://YOUR_SERVICE_URL/admin
```

The dashboard controls:

- Welcome and fallback messages
- Maria's system instructions
- Suggested questions
- Default conversation language
- Google TTS voice/accent
- Avatar image or video
- Knowledge-base entries and enabled state

## Security notes

- The Cloud Storage bucket remains private.
- Voice identifiers are selected from a server-side allowlist.
- Admin endpoints independently verify the Google ID token and approved email.
- Never put OAuth client secrets or service-account keys in the repository.
