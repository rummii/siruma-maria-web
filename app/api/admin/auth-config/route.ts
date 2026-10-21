export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    { clientId: process.env.GOOGLE_CLIENT_ID || "" },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
  );
}
