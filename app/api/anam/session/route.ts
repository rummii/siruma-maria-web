import { createAnamSessionToken, isAnamConfigured, resolveAnamPersonaId } from "@/lib/anam";
import { getMariaConfig } from "@/lib/maria-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  "CDN-Cache-Control": "no-store",
  Pragma: "no-cache",
};

/**
 * Mints a short-lived Anam session token for the browser.
 * The ANAM_API_KEY stays on the server.
 */
export async function POST() {
  if (!isAnamConfigured()) {
    return Response.json(
      { error: "Anam is not configured." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const config = await getMariaConfig();
    if (!config.anamEnabled) {
      return Response.json(
        { error: "The live avatar is disabled in Maria's settings." },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }

    const personaId = resolveAnamPersonaId(config.anamPersonaId);
    if (!personaId) {
      return Response.json(
        { error: "No Anam persona is configured." },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }

    const sessionToken = await createAnamSessionToken(personaId);
    return Response.json({ sessionToken }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("Anam session token failed", error);
    return Response.json(
      { error: "The live avatar is temporarily unavailable." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}

