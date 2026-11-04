export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return Response.json(
    {
      ok: true,
      service: "maria-web",
      environment: process.env.RAILWAY_ENVIRONMENT ?? "production",
      deploymentId: process.env.RAILWAY_DEPLOYMENT_ID ?? "unknown",
      version: "feature/admin-backend",
      checkedAt: new Date().toISOString(),
    },
    { status: 200 },
  );
}
