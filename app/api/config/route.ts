import { getMariaConfig } from "@/lib/maria-store";
import { MARIA_VOICES } from "@/lib/voices";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Surrogate-Control": "no-store",
  "Pragma": "no-cache",
  "Expires": "0",
};

export async function GET() {
  try {
    const config = await getMariaConfig();
    return Response.json(
      {
        ...config,
        avatarUrl: config.avatarObject
          ? `/api/avatar?updated=${encodeURIComponent(config.updatedAt || "")}`
          : "/maria-veo-idle.mp4",
        voices: MARIA_VOICES.map(({ id, label, languageCode }) => ({ id, label, languageCode })),
      },
      { headers: NO_CACHE_HEADERS },
    );
  } catch {
    return Response.json({ error: "Configuration is temporarily unavailable" }, { status: 503, headers: NO_CACHE_HEADERS });
  }
}
