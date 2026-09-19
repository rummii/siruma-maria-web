export const runtime = "nodejs";
export const maxDuration = 3600;

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const POLL_INTERVAL_MS = 5_000;
const MAX_WAIT_MS = 3_300_000;

type AccessTokenResponse = {
  access_token: string;
};

type GoogleOperation = {
  name?: string;
  done?: boolean;
  error?: {
    code?: number;
    message?: string;
  };
};

async function accessToken() {
  const response = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    {
      headers: { "Metadata-Flavor": "Google" },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error("Unable to obtain a Google Cloud access token");
  }

  const payload = (await response.json()) as AccessTokenResponse;
  if (!payload.access_token) {
    throw new Error("Google Cloud returned an empty access token");
  }
  return payload.access_token;
}

function objectPath(bucket: string, objectName: string) {
  return `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}`;
}

async function uploadObject(
  token: string,
  bucket: string,
  objectName: string,
  audio: File,
) {
  const endpoint = new URL(
    `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o`,
  );
  endpoint.searchParams.set("uploadType", "media");
  endpoint.searchParams.set("name", objectName);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": audio.type || "audio/mpeg",
    },
    body: audio,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Audio upload failed: ${response.status} ${await response.text()}`);
  }
}

async function deleteObject(token: string, bucket: string, objectName: string) {
  const response = await fetch(objectPath(bucket, objectName), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok && response.status !== 404) {
    console.error("Cloud Storage cleanup failed", response.status, await response.text());
  }
}

async function runJob(
  token: string,
  project: string,
  region: string,
  job: string,
  inputUri: string,
  outputUri: string,
) {
  const endpoint =
    `https://run.googleapis.com/v2/projects/${encodeURIComponent(project)}` +
    `/locations/${encodeURIComponent(region)}/jobs/${encodeURIComponent(job)}:run`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      overrides: {
        containerOverrides: [
          {
            env: [
              { name: "INPUT_AUDIO_URI", value: inputUri },
              { name: "OUTPUT_VIDEO_URI", value: outputUri },
            ],
          },
        ],
        taskCount: 1,
        timeout: "3300s",
      },
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Job start failed: ${response.status} ${await response.text()}`);
  }

  const operation = (await response.json()) as GoogleOperation;
  if (!operation.name) {
    throw new Error("Cloud Run did not return a job operation");
  }
  return operation.name;
}

async function waitForOperation(token: string, operationName: string) {
  const deadline = Date.now() + MAX_WAIT_MS;
  const endpoint = `https://run.googleapis.com/v2/${operationName}`;

  while (Date.now() < deadline) {
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Job status failed: ${response.status} ${await response.text()}`);
    }

    const operation = (await response.json()) as GoogleOperation;
    if (operation.done) {
      if (operation.error) {
        throw new Error(operation.error.message || "LatentSync job failed");
      }
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error("LatentSync job timed out");
}

async function downloadObject(token: string, bucket: string, objectName: string) {
  const endpoint =
    `https://storage.googleapis.com/download/storage/v1/b/${encodeURIComponent(bucket)}` +
    `/o/${encodeURIComponent(objectName)}?alt=media`;

  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Video download failed: ${response.status} ${await response.text()}`);
  }
  return response.arrayBuffer();
}

export async function POST(request: Request) {
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  const region = process.env.LATENTSYNC_REGION || "asia-southeast1";
  const job = process.env.LATENTSYNC_JOB;
  const bucket = process.env.LATENTSYNC_BUCKET;

  if (!project || !job || !bucket) {
    return Response.json({ error: "Lip sync is not enabled" }, { status: 503 });
  }

  const source = await request.formData();
  const audio = source.get("audio");
  if (!(audio instanceof File) || audio.size === 0) {
    return Response.json({ error: "An audio file is required" }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return Response.json({ error: "The audio file is too large" }, { status: 413 });
  }

  const requestId = crypto.randomUUID();
  const inputObject = `lipsync/${requestId}/speech.mp3`;
  const outputObject = `lipsync/${requestId}/maria-lipsync.mp4`;
  const inputUri = `gs://${bucket}/${inputObject}`;
  const outputUri = `gs://${bucket}/${outputObject}`;

  try {
    let token = await accessToken();
    await uploadObject(token, bucket, inputObject, audio);

    const operationName = await runJob(
      token,
      project,
      region,
      job,
      inputUri,
      outputUri,
    );
    await waitForOperation(token, operationName);

    token = await accessToken();
    const video = await downloadObject(token, bucket, outputObject);

    return new Response(video, {
      headers: {
        "Content-Type": "video/mp4",
        "Cache-Control": "private, no-store",
        "X-Maria-Lipsync": "LatentSync-1.6-job",
      },
    });
  } catch (error) {
    console.error("LatentSync job is unavailable", error);
    return Response.json(
      { error: "Lip sync is temporarily unavailable" },
      { status: 503 },
    );
  } finally {
    try {
      const token = await accessToken();
      await Promise.all([
        deleteObject(token, bucket, inputObject),
        deleteObject(token, bucket, outputObject),
      ]);
    } catch (error) {
      console.error("LatentSync cleanup failed", error);
    }
  }
}
