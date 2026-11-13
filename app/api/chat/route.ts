import { answerWithMaria, buildLocalAnswer, type ChatTurn } from "@/lib/maria-agent";
import { getMariaConfig, listKnowledge } from "@/lib/maria-store";
import { CHAT_RATE_LIMIT, clientIdentifier, consumeRateLimit } from "@/lib/rate-limit";

const MAX_QUESTION_LENGTH = 1000;
const MAX_HISTORY_MESSAGES = 16;
const MAX_HISTORY_CHARS = 6000;
const MAX_HISTORY_MESSAGE_LENGTH = 1000;

const RATE_LIMIT_MESSAGE =
  "You are sending messages a little too quickly. Please wait a moment and try again.";

function sanitizeHistory(raw: unknown, maxTurns: number): ChatTurn[] {
  if (!Array.isArray(raw) || maxTurns <= 0) return [];

  const turns: ChatTurn[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const role = record.role === "visitor" || record.role === "maria" ? record.role : null;
    const text = typeof record.text === "string" ? record.text.trim() : "";
    if (!role || !text) continue;
    turns.push({ role, text: text.slice(0, MAX_HISTORY_MESSAGE_LENGTH) });
  }

  const limit = Math.min(MAX_HISTORY_MESSAGES, Math.max(0, maxTurns) * 2);
  const recent = turns.slice(-limit);

  let total = recent.reduce((sum, turn) => sum + turn.text.length, 0);
  while (recent.length > 1 && total > MAX_HISTORY_CHARS) {
    total -= recent[0].text.length;
    recent.shift();
  }

  return recent;
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const body = (typeof payload === "object" && payload !== null ? payload : {}) as {
    question?: unknown;
    history?: unknown;
  };
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question || question.length > MAX_QUESTION_LENGTH) {
    return Response.json({ error: "Question must be between 1 and 1000 characters" }, { status: 400 });
  }

  const rate = consumeRateLimit(
    `chat:${clientIdentifier(request)}`,
    CHAT_RATE_LIMIT.limit,
    CHAT_RATE_LIMIT.windowMs,
  );
  if (!rate.allowed) {
    return Response.json(
      { error: RATE_LIMIT_MESSAGE, retryAfterSeconds: rate.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  let config: Awaited<ReturnType<typeof getMariaConfig>>;
  let enabledEntries: Awaited<ReturnType<typeof listKnowledge>>;
  try {
    const [loadedConfig, entries] = await Promise.all([getMariaConfig(), listKnowledge()]);
    config = loadedConfig;
    enabledEntries = entries.filter((entry) => entry.enabled);
  } catch (error) {
    console.error("Maria configuration unavailable", error);
    return Response.json({ error: "Maria is temporarily unavailable" }, { status: 503 });
  }

  const history = sanitizeHistory(body.history, config.maxHistoryTurns);
  const localAnswer = () =>
    buildLocalAnswer({ question, entries: enabledEntries, config, history });

  const apiKey = (process.env.DEEPSEEK_API_KEY || "").trim();
  if (!apiKey) {
    // No model configured: serve the deterministic knowledge-base answer.
    return Response.json(localAnswer());
  }

  try {
    const answer = await answerWithMaria({
      apiKey,
      model: process.env.DEEPSEEK_MODEL || "deepseek-flash",
      config,
      entries: enabledEntries,
      history,
      question,
      allowWebSearch: config.webSearchEnabled !== false,
    });
    return Response.json(answer ?? localAnswer());
  } catch (error) {
    // A model or search outage must not break the conversation: degrade to the
    // best local knowledge-base match instead of returning a 5xx.
    console.error("Maria chat failed", error);
    return Response.json(localAnswer());
  }
}
