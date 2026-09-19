const MAX_TEXT_LENGTH = 1000;

export async function POST(request: Request) {
  let text = "";
  try {
    const body = (await request.json()) as { text?: unknown };
    text = typeof body.text === "string" ? body.text.trim() : "";
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!text || text.length > MAX_TEXT_LENGTH) {
    return Response.json({ error: "Text must be between 1 and 1000 characters" }, { status: 400 });
  }

  const voiceName = "fil-PH-Wavenet-A";
  let authorization = "";
  if (process.env.GOOGLE_TTS_API_KEY) {
    authorization = `X-Goog-Api-Key ${process.env.GOOGLE_TTS_API_KEY}`;
  } else {
    try {
      const tokenResponse = await fetch(
        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
        { headers: { "Metadata-Flavor": "Google" }, cache: "no-store" },
      );
      if (!tokenResponse.ok) throw new Error("Unable to obtain Google identity token");
      const tokenData = (await tokenResponse.json()) as { access_token?: string };
      if (!tokenData.access_token) throw new Error("Google identity token was empty");
      authorization = `Bearer ${tokenData.access_token}`;
    } catch {
      return Response.json({ error: "Voice service is not configured" }, { status: 503 });
    }
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authorization.startsWith("Bearer ")) headers.Authorization = authorization;
  else headers["X-Goog-Api-Key"] = authorization.slice("X-Goog-Api-Key ".length);

  const googleResponse = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
    method: "POST",
    headers,
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: "fil-PH", name: voiceName, ssmlGender: "FEMALE" },
      audioConfig: { audioEncoding: "MP3", speakingRate: 0.96, pitch: 0.5 },
    }),
  });

  if (!googleResponse.ok) return Response.json({ error: "Voice generation failed" }, { status: 502 });
  const data = (await googleResponse.json()) as { audioContent?: string };
  if (!data.audioContent) return Response.json({ error: "No audio returned" }, { status: 502 });

  const bytes = Buffer.from(data.audioContent, "base64");
  return new Response(bytes, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "private, max-age=300",
      "X-Maria-Voice": voiceName,
    },
  });
}
