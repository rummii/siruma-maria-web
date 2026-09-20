import { googleAccessToken, projectId } from "@/lib/google-cloud";
import { getMariaConfig } from "@/lib/maria-store";

export async function GET(request: Request) {
  try {
    const config = await getMariaConfig();
    if (!config.avatarObject) return Response.redirect(new URL("/maria-veo-idle.mp4", request.url));

    const bucket = process.env.MARIA_ASSET_BUCKET || "siruma-maria-voice-assets-1093859359152";
    const token = await googleAccessToken();
    const response = await fetch(
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(config.avatarObject)}?alt=media`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(request.headers.get("Range") ? { Range: request.headers.get("Range")! } : {}),
        },
        cache: "no-store",
      },
    );
    if (!response.ok && response.status !== 206) throw new Error("Avatar download failed");

    const headers = new Headers();
    for (const name of ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"]) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set("Cache-Control", "public, max-age=300");
    return new Response(response.body, { status: response.status, headers });
  } catch {
    return Response.json({ error: "Avatar is temporarily unavailable" }, { status: 503 });
  }
}
