import { requireAdmin, unauthorized } from "@/lib/admin-auth";
import { googleAccessToken } from "@/lib/google-cloud";
import { getMariaConfig, saveMariaConfig } from "@/lib/maria-store";

const MAX_AVATAR_BYTES = 25 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "video/mp4", "video/webm"]);

export async function POST(request: Request) {
  if (!(await requireAdmin(request))) return unauthorized();

  const form = await request.formData();
  const file = form.get("avatar");
  if (!(file instanceof File)) return Response.json({ error: "Avatar file is required" }, { status: 400 });
  if (!ALLOWED_TYPES.has(file.type)) return Response.json({ error: "Use PNG, JPEG, WebP, MP4, or WebM" }, { status: 400 });
  if (file.size > MAX_AVATAR_BYTES) return Response.json({ error: "Avatar must be 25 MB or smaller" }, { status: 400 });

  const bucket = process.env.MARIA_ASSET_BUCKET || "siruma-maria-voice-assets-1093859359152";
  const extension = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  const object = `avatars/maria-${Date.now()}.${extension}`;
  const token = await googleAccessToken();
  const response = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(object)}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": file.type },
      body: await file.arrayBuffer(),
    },
  );
  if (!response.ok) {
    console.error("Avatar upload failed", await response.text());
    return Response.json({ error: "Avatar upload failed" }, { status: 502 });
  }

  const config = await getMariaConfig();
  config.avatarObject = object;
  config.avatarType = file.type.startsWith("video/") ? "video" : "image";
  await saveMariaConfig(config);
  return Response.json({ ok: true, avatarObject: object, avatarType: config.avatarType });
}
