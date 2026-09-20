import { getMariaConfig } from "@/lib/maria-store";
import { MARIA_VOICES } from "@/lib/voices";

export async function GET() {
  try {
    const config = await getMariaConfig();
    return Response.json({
      ...config,
      avatarUrl: config.avatarObject ? "/api/avatar" : "/maria-veo-idle.mp4",
      voices: MARIA_VOICES.map(({ id, label, languageCode }) => ({ id, label, languageCode })),
    });
  } catch {
    return Response.json({ error: "Configuration is temporarily unavailable" }, { status: 503 });
  }
}
