export async function POST() {
  return Response.json(
    {
      error: "Server-side TTS is disabled. Maria uses the visitor browser's configured speech voice.",
    },
    { status: 410 },
  );
}
