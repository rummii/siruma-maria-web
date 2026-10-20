import { requireAdmin, unauthorized } from "@/lib/admin-auth";
import { getMariaConfig, saveMariaConfig } from "@/lib/maria-store";
import { putRailwayObject } from "@/lib/railway-storage";

const MAX_AVATAR_BYTES = 25 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "video/mp4", "video/webm"]);

export async function POST(request: Request) {
  if (!(await requireAdmin(request))) return unauthorized();

  const form = await request.formData();
  const file = form.get("avatar");
  if (!(file instanceof File)) return Response.json({ error: "Avatar file is required" }, { status: 400 });
  if (!ALLOWED_TYPES.has(file.type)) return Response.json({ error: "Use PNG, JPEG, WebP, MP4, or WebM" }, { status: 400 });
  if (file.size > MAX_AVATAR_BYTES) return Response.json({ error: "Avatar must be 25 MB or smaller" }, { status: 400 });

  const extension = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  const object = `avatars/maria-${Date.now()}.${extension}`;

  try {
    await putRailwayObject(object, Buffer.from(await file.arrayBuffer()), file.type);
  } catch (error) {
    console.error("Avatar upload failed", error);
    return Response.json({ error: "Avatar upload failed" }, { status: 502 });
  }

  const config = await getMariaConfig();
  config.avatarObject = object;
  config.avatarType = file.type.startsWith("video/") ? "video" : "image";
  await saveMariaConfig(config);
  return Response.json({ ok: true, avatarObject: object, avatarType: config.avatarType });
}
