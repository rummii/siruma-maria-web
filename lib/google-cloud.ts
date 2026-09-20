let cachedToken = "";
let tokenExpiresAt = 0;

export function projectId() {
  return process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "siruma-maria-voice";
}

export async function googleAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken;

  const response = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" }, cache: "no-store" },
  );
  if (!response.ok) throw new Error("Unable to obtain Google Cloud access token");
  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Google Cloud access token was empty");

  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in || 3000) * 1000;
  return cachedToken;
}

export async function googleJson<T>(url: string, init: RequestInit = {}) {
  const token = await googleAccessToken();
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Google API request failed (${response.status}): ${details.slice(0, 500)}`);
  }
  return (await response.json()) as T;
}
