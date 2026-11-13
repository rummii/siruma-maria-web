import { createHash } from "node:crypto";
import { MARIA_VOICES, voiceById } from "@/lib/voices";

const MAX_TEXT_LENGTH = 4000;

function prepareForSpeech(value: string) {
  return value
    .normalize("NFKC")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[\*_~`#>|{}\[\]]/g, " ")
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchWithTimeout(input: string | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function googleSynthesize(text: string, voiceName: string, languageCode: string) {
  const endpoint = new URL("https://texttospeech.googleapis.com/v1/text:synthesize");
  const region = process.env.VERTEX_AI_REGION || "asia-southeast1";
  endpoint.host = `${region}-texttospeech.googleapis.com`;

  let authorization = "";
  if (process.env.GOOGLE_TTS_API_KEY) {
    authorization = `X-Goog-Api-Key ${process.env.GOOGLE_TTS_API_KEY}`;
  } else {
    // Fall back to the metadata service account (GCE/GKE only) — not available on Railway.
    try {
      const tokenResponse = await fetchWithTimeout(
        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
        { headers: { "Metadata-Flavor": "Google" }, cache: "no-store" },
        3000,
      );
      if (!tokenResponse.ok) throw new Error("Unable to obtain Google identity token");
      const tokenData = (await tokenResponse.json()) as { access_token?: string };
      if (!tokenData.access_token) throw new Error("Google identity token was empty");
      authorization = `Bearer ${tokenData.access_token}`;
    } catch {
      return null;
    }
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authorization.startsWith("Bearer ")) headers.Authorization = authorization;
  else headers["X-Goog-Api-Key"] = authorization.slice("X-Goog-Api-Key ".length);

  let googleResponse: Response;
  try {
    googleResponse = await fetchWithTimeout(
      endpoint,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          input: { text },
          voice: { languageCode, name: voiceName, ssmlGender: "FEMALE" },
          audioConfig: { audioEncoding: "MP3", speakingRate: 0.96 },
        }),
        cache: "no-store",
      },
      30000,
    );
  } catch {
    return null;
  }

  if (!googleResponse.ok) return null;
  const data = (await googleResponse.json()) as { audioContent?: string };
  if (!data.audioContent) return null;
  return Buffer.from(data.audioContent, "base64");
}

async function deepgramSynthesize(text: string, model: string) {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) return null;

  const endpoint = new URL("https://api.deepgram.com/v1/speak");
  endpoint.searchParams.set("model", model);
  endpoint.searchParams.set("encoding", "mp3");

  // Keep the timer active through the body read so a stalled stream is also capped.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!upstream.ok || !upstream.body) return null;
    return Buffer.from(await upstream.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: Request) {
  let body: { text?: unknown; voiceId?: unknown };
  try {
    body = (await request.json()) as { text?: unknown; voiceId?: unknown };
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const text = prepareForSpeech(typeof body.text === "string" ? body.text : "");
  if (!text) return Response.json({ error: "Text is required." }, { status: 400 });
  if (text.length > MAX_TEXT_LENGTH) return Response.json({ error: "Text is too long." }, { status: 413 });

  const voice = voiceById(typeof body.voiceId === "string" ? body.voiceId : undefined);
  const cacheKey = createHash("sha256").update(`${voice.id}::${text}`).digest("hex");

  const failures: string[] = [];

  // Ordered candidates: the primary voice first, then deduplicated fallbacks.
  // Deepgram is the preferred fallback, so Deepgram candidates come before Google.
  const candidates: (typeof voice)[] = [voice];
  const addCandidate = (candidate: typeof voice | undefined) => {
    if (candidate && !candidates.some((existing) => existing.id === candidate.id)) {
      candidates.push(candidate);
    }
  };

  const deepgramVoice = MARIA_VOICES.find((candidate) => candidate.provider === "deepgram");
  const alternate = MARIA_VOICES.find(
    (candidate) =>
      candidate.provider !== voice.provider &&
      candidate.languageCode === voice.languageCode &&
      candidate.id !== voice.id,
  );

  addCandidate(deepgramVoice);
  addCandidate(alternate);

  let audio: Buffer | null = null;
  let provider = voice.provider;
  let model = voice.name;

  for (const candidate of candidates) {
    if (candidate.provider === "google") {
      audio = await googleSynthesize(text, candidate.name, candidate.languageCode);
    } else {
      audio = await deepgramSynthesize(text, candidate.name);
    }

    if (audio) {
      provider = candidate.provider;
      model = candidate.name;
      break;
    }
    failures.push(`${candidate.provider}:${candidate.name}`);
  }

  if (!audio) {
    console.error("TTS synthesis failed for all providers", { failures, textLength: text.length });
    return Response.json(
      { error: "Premium voice is temporarily unavailable.", providers: failures },
      { status: 502 },
    );
  }

  // Convert Buffer to Uint8Array for the Response body.
  const uint8Array = new Uint8Array(audio);
  return new Response(uint8Array, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "private, max-age=86400, immutable",
      "X-Maria-Voice": model,
      "X-Maria-Voice-Provider": provider,
      "X-Maria-Cache-Key": cacheKey,
    },
  });
}
