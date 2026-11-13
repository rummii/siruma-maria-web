import { listKnowledge } from "@/lib/maria-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=30, stale-while-revalidate=60",
};

const ERROR_HEADERS = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const entries = await listKnowledge();
    return Response.json(
      {
        entries: entries
          .filter((entry) => entry.enabled)
          .map(({ id, title, content }) => ({ id, title, content })),
      },
      { headers: CACHE_HEADERS },
    );
  } catch (error) {
    console.error("Public knowledge load failed", error);
    return Response.json(
      { error: "Knowledge articles are temporarily unavailable." },
      { status: 503, headers: ERROR_HEADERS },
    );
  }
}
