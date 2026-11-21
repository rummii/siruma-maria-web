const ANAM_API_BASE = "https://api.anam.ai/v1";
const ANAM_REQUEST_TIMEOUT_MS = 15_000;

export type AnamSessionTokenResponse = { sessionToken?: string };

/** Trimmed persona shape used by the admin dashboard. */
export type AnamPersonaSummary = {
  id: string;
  name: string;
  description: string;
  avatarName: string | null;
  avatarImageUrl: string | null;
  voiceName: string | null;
  voiceProvider: string | null;
  voiceCountry: string | null;
  llmId: string | null;
};

type RawPersona = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  llmId?: unknown;
  avatar?: { displayName?: unknown; imageUrl?: unknown } | null;
  voice?: { displayName?: unknown; provider?: unknown; country?: unknown } | null;
};

type RawPersonaList = { data?: RawPersona[] };

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizePersona(raw: RawPersona): AnamPersonaSummary {
  return {
    id: String(raw.id ?? ""),
    name: text(raw.name) ?? "Untitled persona",
    description: text(raw.description) ?? "",
    avatarName: text(raw.avatar?.displayName),
    avatarImageUrl: text(raw.avatar?.imageUrl),
    voiceName: text(raw.voice?.displayName),
    voiceProvider: text(raw.voice?.provider),
    voiceCountry: text(raw.voice?.country),
    llmId: text(raw.llmId),
  };
}

function anamApiKey() {
  const key = process.env.ANAM_API_KEY?.trim();
  return key ? key : null;
}

/** True when this deployment has an Anam API key. A persona must also be set. */
export function isAnamConfigured() {
  return Boolean(anamApiKey());
}

export function envAnamPersonaId() {
  return process.env.ANAM_PERSONA_ID?.trim() || "";
}

/** Admin-configured persona wins; otherwise fall back to the deployment default. */
export function resolveAnamPersonaId(configured?: string) {
  return (configured || "").trim() || envAnamPersonaId();
}

async function anamFetch<T>(path: string): Promise<T> {
  const key = anamApiKey();
  if (!key) throw new Error("ANAM_API_KEY is not set on this deployment.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ANAM_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${ANAM_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Anam API ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      );
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

/** Lists the organization's personas so the admin can pick one. */
export async function listAnamPersonas(): Promise<AnamPersonaSummary[]> {
  const raw = await anamFetch<RawPersonaList>("/personas?perPage=100");
  const rows = Array.isArray(raw.data) ? raw.data : [];
  return rows.map(normalizePersona).filter((persona) => persona.id);
}

/** Full persona shape — the only way to read llmId. */
export async function getAnamPersona(id: string): Promise<AnamPersonaSummary> {
  return normalizePersona(await anamFetch<RawPersona>(`/personas/${encodeURIComponent(id)}`));
}

/**
 * Exchanges the server-only Anam API key for a short-lived session token.
 * The API key must never reach the browser.
 */
export async function createAnamSessionToken(personaId?: string): Promise<string> {
  const key = anamApiKey();
  const resolved = resolveAnamPersonaId(personaId);

  if (!key) {
    throw new Error("Anam is not configured: set ANAM_API_KEY.");
  }
  if (!resolved) {
    throw new Error("Anam is not configured: set ANAM_PERSONA_ID or choose a persona in the admin.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ANAM_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${ANAM_API_BASE}/auth/session-token`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ personaConfig: { personaId: resolved } }),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Anam session token request failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      );
    }

    const data = (await response.json()) as AnamSessionTokenResponse;
    if (!data.sessionToken) throw new Error("Anam did not return a session token.");
    return data.sessionToken;
  } finally {
    clearTimeout(timeout);
  }
}

