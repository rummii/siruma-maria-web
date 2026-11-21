const ANAM_SESSION_TOKEN_URL = "https://api.anam.ai/v1/auth/session-token";
const SESSION_TIMEOUT_MS = 15_000;

export type AnamSessionTokenResponse = { sessionToken?: string };

/**
 * Anam is optional. When these are missing the app keeps using the existing
 * Google / Deepgram TTS pipeline, so no deployment breaks by being unconfigured.
 */
export function isAnamConfigured() {
  return Boolean(process.env.ANAM_API_KEY && process.env.ANAM_PERSONA_ID);
}

/**
 * Exchanges the server-only Anam API key for a short-lived session token.
 * The API key must never reach the browser.
 */
export async function createAnamSessionToken(): Promise<string> {
  const apiKey = process.env.ANAM_API_KEY;
  const personaId = process.env.ANAM_PERSONA_ID;

  if (!apiKey || !personaId) {
    throw new Error("Anam is not configured: set ANAM_API_KEY and ANAM_PERSONA_ID.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SESSION_TIMEOUT_MS);

  try {
    const response = await fetch(ANAM_SESSION_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ personaConfig: { personaId } }),
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
