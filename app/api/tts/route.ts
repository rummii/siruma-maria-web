const MAX_TEXT_LENGTH = 4000;

function prepareForSpeech(value: string) {
  return value
    .normalize("NFKC")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[\*_~`#>|\[\]{}]/g, " ")
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function POST(request: Request) {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Premium voice is not configured." },
      { status: 503 },
    );
  }

  let body: { text?: unknown };
  try {
    body = await request.json() as { text?: unknown };
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const text = prepareForSpeech(typeof body.text === "string" ? body.text : "");
  if (!text) {
    return Response.json({ error: "Text is required." }, { status: 400 });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return Response.json({ error: "Text is too long." }, { status: 413 });
  }

  const model = process.env.DEEPGRAM_TTS_MODEL || "aura-2-thalia-en";
  const endpoint = new URL("https://api.deepgram.com/v1/speak");
  endpoint.searchParams.set("model", model);
  endpoint.searchParams.set("encoding", "mp3");

  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
      cache: "no-store",
    });

    if (!upstream.ok || !upstream.body) {
      console.error("Deepgram TTS request failed", { status: upstream.status });
      return Response.json(
        { error: "Premium voice is temporarily unavailable." },
        { status: 502 },
      );
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "audio/mpeg",
        "Cache-Control": "no-store",
        "X-Maria-Voice": model,
      },
    });
  } catch (error) {
    console.error("Deepgram TTS connection failed", error);
    return Response.json(
      { error: "Premium voice is temporarily unavailable." },
      { status: 503 },
    );
  }
}
