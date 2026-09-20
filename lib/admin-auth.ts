type GoogleTokenInfo = {
  aud?: string;
  email?: string;
  email_verified?: string;
  expires_in?: string;
};

export async function requireAdmin(request: Request) {
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return null;

  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`,
    { cache: "no-store" },
  );
  if (!response.ok) return null;

  const info = (await response.json()) as GoogleTokenInfo;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const allowed = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  if (!info.email || info.email_verified !== "true") return null;
  if (clientId && info.aud !== clientId) return null;
  if (!allowed.includes(info.email.toLowerCase())) return null;
  return { email: info.email };
}

export function unauthorized() {
  return Response.json({ error: "Administrator authentication required" }, { status: 401 });
}
