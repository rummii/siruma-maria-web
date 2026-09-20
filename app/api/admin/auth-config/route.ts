export async function GET() {
  return Response.json({ clientId: process.env.GOOGLE_CLIENT_ID || "" });
}
