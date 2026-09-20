import { requireAdmin, unauthorized } from "@/lib/admin-auth";
import { deleteKnowledge, getMariaConfig, listKnowledge, saveKnowledge, saveMariaConfig } from "@/lib/maria-store";

export async function GET(request: Request) {
  if (!(await requireAdmin(request))) return unauthorized();
  return Response.json({ entries: await listKnowledge() });
}

export async function POST(request: Request) {
  if (!(await requireAdmin(request))) return unauthorized();
  const body = (await request.json()) as { id?: unknown; title?: unknown; content?: unknown; enabled?: unknown };
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!title || !content) return Response.json({ error: "Title and content are required" }, { status: 400 });
  const id = typeof body.id === "string" ? body.id : "";
  const previousEntry = id
    ? (await listKnowledge()).find((entry) => entry.id === id)
    : undefined;
  const entry = await saveKnowledge({
    id,
    title: title.slice(0, 200),
    content: content.slice(0, 20_000),
    enabled: body.enabled !== false,
  });

  let config;
  let suggestionRenamed = false;
  if (previousEntry && previousEntry.title.trim().toLocaleLowerCase() !== entry.title.trim().toLocaleLowerCase()) {
    const currentConfig = await getMariaConfig();
    const previousTitle = previousEntry.title.trim().toLocaleLowerCase();
    const suggestions = currentConfig.suggestions.map((suggestion) => {
      if (suggestion.trim().toLocaleLowerCase() !== previousTitle) return suggestion;
      suggestionRenamed = true;
      return entry.title;
    });
    if (suggestionRenamed) {
      config = await saveMariaConfig({ ...currentConfig, suggestions });
    }
  }

  return Response.json({ entry, config, suggestionRenamed });
}

export async function DELETE(request: Request) {
  if (!(await requireAdmin(request))) return unauthorized();
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!id) return Response.json({ error: "Knowledge ID is required" }, { status: 400 });
  await deleteKnowledge(id);
  return Response.json({ ok: true });
}
