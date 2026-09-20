import { requireAdmin, unauthorized } from "@/lib/admin-auth";
import { getMariaConfig, saveMariaConfig, type MariaConfig } from "@/lib/maria-store";
import { MARIA_VOICES } from "@/lib/voices";

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return unauthorized();
  const config = await getMariaConfig();
  return Response.json({ config, voices: MARIA_VOICES, admin });
}

export async function PUT(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return unauthorized();

  const body = (await request.json()) as Partial<MariaConfig>;
  const current = await getMariaConfig();
  const voiceIds = new Set(MARIA_VOICES.map((voice) => voice.id));
  const config: MariaConfig = {
    ...current,
    welcomeMessage: String(body.welcomeMessage || current.welcomeMessage).slice(0, 1000),
    fallbackMessage: String(body.fallbackMessage || current.fallbackMessage).slice(0, 1000),
    systemPrompt: String(body.systemPrompt || current.systemPrompt).slice(0, 5000),
    defaultVoice: voiceIds.has(String(body.defaultVoice)) ? String(body.defaultVoice) : current.defaultVoice,
    defaultLanguage: String(body.defaultLanguage || current.defaultLanguage).slice(0, 20),
    avatarObject: current.avatarObject,
    avatarType: body.avatarType === "image" ? "image" : "video",
    responseMode: ["text-and-voice", "voice-only", "text-only"].includes(String(body.responseMode))
      ? (body.responseMode as MariaConfig["responseMode"])
      : current.responseMode,
    suggestions: Array.isArray(body.suggestions)
      ? body.suggestions.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 8)
      : current.suggestions,
  };
  return Response.json({ config: await saveMariaConfig(config) });
}
