import { getMariaConfig, listKnowledge, type KnowledgeEntry } from "@/lib/maria-store";

const MAX_QUESTION_LENGTH = 1000;
const GENERAL_DISCLOSURE = "Based on general travel information, ";

type AnswerSource = "knowledge-base" | "general" | "fallback";
type DeepSeekResponse = { choices?: Array<{ message?: { content?: string } }> };
type StructuredAnswer = { answer?: string; source?: AnswerSource };

function parseStructuredAnswer(raw: string): StructuredAnswer | null {
  const cleaned = raw.replace(/^\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`$/, "").trim();
  try {
    return JSON.parse(cleaned) as StructuredAnswer;
  } catch {
    return null;
  }
}

function normalizeKnowledgeKey(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\\p{L}\\p{N}]+/gu, " ")
    .trim();
}

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "can", "do", "for", "how", "i", "in", "is", "me", "of",
  "on", "please", "tell", "the", "to", "what", "where", "with", "you",
]);

function words(value: string) {
  return normalizeKnowledgeKey(value)
    .split(" ")
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function localKnowledgeMatch(question: string, entries: KnowledgeEntry[]) {
  const queryWords = words(question);
  if (!queryWords.length) return null;

  let best: { entry: KnowledgeEntry; score: number } | null = null;
  for (const entry of entries) {
    const title = new Set(words(entry.title));
    const content = new Set(words(entry.content));
    const score = queryWords.reduce(
      (total, word) => total + (title.has(word) ? 4 : 0) + (content.has(word) ? 1 : 0),
      0,
    );
    if (!best || score > best.score) best = { entry, score };
  }

  return best && best.score >= Math.max(2, Math.ceil(queryWords.length * 0.4))
    ? best.entry
    : null;
}

export async function POST(request: Request) {
  let question = "";
  try {
    const body = (await request.json()) as { question?: unknown };
    question = typeof body.question === "string" ? body.question.trim() : "";
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!question || question.length > MAX_QUESTION_LENGTH) {
    return Response.json({ error: "Question must be between 1 and 1000 characters" }, { status: 400 });
  }

  try {
    const [config, entries] = await Promise.all([getMariaConfig(), listKnowledge()]);
    const enabledEntries = entries.filter((entry) => entry.enabled);
    const exactMatch = enabledEntries.find(
      (entry) => normalizeKnowledgeKey(entry.title) === normalizeKnowledgeKey(question),
    );

    if (exactMatch?.content.trim()) {
      return Response.json({
        answer: exactMatch.content.trim(),
        source: "knowledge-base" satisfies AnswerSource,
        matchedEntry: exactMatch.id,
      });
    }

    const apiKey = process.env.DEEPSEEK_API_KEY || "";
    if (!apiKey) {
      const match = localKnowledgeMatch(question, enabledEntries);
      return Response.json(
        match
          ? { answer: match.content.trim(), source: "knowledge-base" satisfies AnswerSource, matchedEntry: match.id }
          : { answer: config.fallbackMessage, source: "fallback" satisfies AnswerSource },
      );
    }

    const knowledge = enabledEntries
      .map((entry) => `Title: ${entry.title}\nContent: ${entry.content}`)
      .join("\n\n");

    const model = process.env.DEEPSEEK_MODEL || "deepseek-flash";
    const policy = `${config.systemPrompt}

SOURCE POLICY — this policy overrides conflicting source instructions above:
1. Use the OFFICIAL KNOWLEDGE BASE first. It is authoritative and overrides general knowledge.
2. Questions about Siruma products, services, prices, bookings, availability, schedules, policies, contacts, safety rules, official claims, or other business details must be answered only from the official knowledge base. If absent, return the fallback source.
3. For non-commercial visitor questions not answered by the knowledge base, you may use cautious general travel knowledge and mark the source as general.
4. Never invent precise routes, fares, opening hours, weather, road conditions, schedules, availability, or time-sensitive facts.
5. If uncertain, return the fallback source.
6. Keep answers concise and natural for speech. Do not use Markdown, headings, bullets, raw URLs, or formatting characters.
7. Return only valid JSON: {"answer":"text","source":"knowledge-base|general|fallback"}.

Configured fallback message: ${config.fallbackMessage}`;

    const deepSeekResponse = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.15,
        max_tokens: 350,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: policy },
          {
            role: "user",
            content:
              `OFFICIAL KNOWLEDGE BASE:\n${knowledge || "(No official entries are currently enabled.)"}` +
              `\n\nVISITOR QUESTION:\n${question}`,
          },
        ],
      }),
      cache: "no-store",
    });

    if (!deepSeekResponse.ok) {
      const details = await deepSeekResponse.text();
      throw new Error(`DeepSeek request failed (${deepSeekResponse.status}): ${details.slice(0, 300)}`);
    }

    const result = (await deepSeekResponse.json()) as DeepSeekResponse;
    const structured = parseStructuredAnswer(result.choices?.[0]?.message?.content?.trim() || "");

    if (!structured?.answer || structured.source === "fallback") {
      return Response.json({ answer: config.fallbackMessage, source: "fallback" satisfies AnswerSource });
    }

    if (structured.source === "general") {
      const answer = structured.answer.replace(/^Based on general travel information,\s*/i, "").trim();
      return Response.json({
        answer: answer ? `${GENERAL_DISCLOSURE}${answer}` : config.fallbackMessage,
        source: answer ? "general" : "fallback",
      });
    }

    if (structured.source !== "knowledge-base") {
      return Response.json({ answer: config.fallbackMessage, source: "fallback" satisfies AnswerSource });
    }

    return Response.json({ answer: structured.answer.trim(), source: "knowledge-base" satisfies AnswerSource });
  } catch (error) {
    console.error("Maria chat failed", error);
    return Response.json({ error: "Maria is temporarily unavailable" }, { status: 503 });
  }
}
