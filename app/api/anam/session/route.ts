import { createAnamSessionToken, isAnamConfigured } from "@/lib/anam";

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
    const sessionToken = await createAnamSessionToken();
    return Response.json({ sessionToken }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("Anam session token failed", error);
    return Response.json(
      { error: "The live avatar is temporarily unavailable." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
