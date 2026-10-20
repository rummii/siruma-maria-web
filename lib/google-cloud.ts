import { createSign } from "node:crypto";

let cachedToken = "";
let tokenExpiresAt = 0;

type ServiceAccount = {
  client_email?: string;
  private_key?: string;
  token_uri?: string;
};

export function projectId() {
  return process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "siruma-maria-voice";
}

function base64Url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function serviceAccountFromEnvironment(): ServiceAccount | null {
  const encoded = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";
  if (!encoded) return null;

  try {
    const json = encoded.trim().startsWith("{")
      ? encoded
      : Buffer.from(encoded, "base64").toString("utf8");
    return JSON.parse(json) as ServiceAccount;
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON or base64-encoded JSON");
  }
}

async function serviceAccountAccessToken(account: ServiceAccount) {
  if (!account.client_email || !account.private_key) {
    throw new Error("Google service-account credentials are incomplete");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: account.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256").update(unsigned).end().sign(account.private_key);
  const assertion = `${unsigned}.${base64Url(signature)}`;

  const response = await fetch(account.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Google credential exchange failed (${response.status})`);
  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Google credential exchange returned no access token");
  return data;
}

export async function googleAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken;

  const account = serviceAccountFromEnvironment();
  let data: { access_token?: string; expires_in?: number };

  if (account) {
    data = await serviceAccountAccessToken(account);
  } else {
    let response: Response;
    try {
      response = await fetch(
        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
        {
          headers: { "Metadata-Flavor": "Google" },
          cache: "no-store",
          signal: AbortSignal.timeout(3000),
        },
      );
    } catch {
      throw new Error(
        "Google Cloud credentials are not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON on Railway.",
      );
    }
    if (!response.ok) throw new Error("Unable to obtain Google Cloud access token");
    data = (await response.json()) as { access_token?: string; expires_in?: number };
  }

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
