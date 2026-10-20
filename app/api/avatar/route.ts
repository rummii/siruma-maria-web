import { getMariaConfig } from "@/lib/maria-store";
import { getRailwayObject } from "@/lib/railway-storage";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const config = await getMariaConfig();
    if (!config.avatarObject) return Response.redirect(new URL("/maria-veo-idle.mp4", request.url));

    const response = await getRailwayObject(config.avatarObject, request.headers.get("Range"));
    if (!response.ok && response.status !== 206) throw new Error("Avatar download failed");

    const headers = new Headers();
    for (const name of ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"]) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    headers.set("CDN-Cache-Control", "no-store");
    headers.set("Pragma", "no-cache");
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    console.error("Avatar read failed", error);
    return Response.json({ error: "Avatar is temporarily unavailable" }, { status: 503 });
  }
}
