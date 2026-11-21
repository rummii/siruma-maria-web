import { requireAdmin, unauthorized } from "@/lib/admin-auth";
import {
  envAnamPersonaId,
  getAnamPersona,
  isAnamConfigured,
  listAnamPersonas,
  resolveAnamPersonaId,
  type AnamPersonaSummary,
} from "@/lib/anam";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

/**
 * Personas and voice/avatar models available to this deployment's Anam account.
 * Read-only: selecting a persona happens through /api/admin/config.
 */
export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return unauthorized();

  const requested = new URL(request.url).searchParams.get("personaId") ?? "";
  const resolvedPersonaId = resolveAnamPersonaId(requested);
  const base = {
    keyPresent: isAnamConfigured(),
    envPersonaId: envAnamPersonaId(),
    resolvedPersonaId,
  };

  if (!isAnamConfigured()) {
    return Response.json(
      {
        ...base,
        personas: [] as AnamPersonaSummary[],
        detail: null,
        error: "ANAM_API_KEY is not set on this deployment.",
      },
      { headers: NO_CACHE_HEADERS },
    );
  }

  let personas: AnamPersonaSummary[] = [];
  let listingError: string | null = null;
  try {
    personas = await listAnamPersonas();
  } catch (error) {
    listingError = error instanceof Error ? error.message : "Unable to list Anam personas.";
    console.error("Anam persona listing failed", error);
  }

  // The list endpoint omits llmId, so the selected persona is fetched in full.
  let detail: AnamPersonaSummary | null = null;
  let detailError: string | null = null;
  if (resolvedPersonaId) {
    try {
      detail = await getAnamPersona(resolvedPersonaId);
    } catch (error) {
      detailError = error instanceof Error ? error.message : "Unable to read the persona.";
    }
  }

  return Response.json(
    { ...base, personas, detail, error: listingError, detailError },
    { headers: NO_CACHE_HEADERS },
  );
}
