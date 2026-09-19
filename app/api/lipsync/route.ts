export const runtime = "nodejs";

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

async function identityToken(audience: string) {
  const configured = process.env.LATENTSYNC_ID_TOKEN;
  if (configured) return configured;

  const endpoint = new URL(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity",
  );
  endpoint.searchParams.set("audience", audience);
  endpoint.searchParams.set("format", "full");

  const response = await fetch(endpoint, {
    headers: { "Metadata-Flavor": "Google" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Unable to obtain a Cloud Run identity token");
  return response.text();
}

export async function POST(request: Request) {
  const serviceUrl = process.env.LATENTSYNC_URL?.replace(/\/$/, "");
  if (!serviceUrl) {
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

  try {
    const token = await identityToken(serviceUrl);
    const body = new FormData();
    body.set("audio", audio, "maria-speech.mp3");

    const response = await fetch(`${serviceUrl}/v1/lipsync`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(3_300_000),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error("LatentSync request failed", response.status, detail.slice(0, 1000));
      return Response.json({ error: "Lip-sync generation failed" }, { status: 502 });
    }

    return new Response(response.body, {
      headers: {
        "Content-Type": "video/mp4",
        "Cache-Control": "private, no-store",
        "X-Maria-Lipsync": response.headers.get("X-Maria-Lipsync") || "LatentSync-1.6",
      },
    });
  } catch (error) {
    console.error("LatentSync is unavailable", error);
    return Response.json({ error: "Lip sync is temporarily unavailable" }, { status: 503 });
  }
}
