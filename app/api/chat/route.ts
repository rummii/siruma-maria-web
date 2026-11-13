import { getMariaConfig, listKnowledge, type KnowledgeEntry } from "@/lib/maria-store";
import { MARIA_VOICES } from "@/lib/voices";

const MAX_QUESTION_LENGTH = 1000;

type AnswerSource = "knowledge-base" | "general" | "fallback";
type DeepSeekResponse = { choices?: Array<{ message?: { content?: string } }> };
type StructuredAnswer = { answer?: string; source?: AnswerSource; voiceId?: string | null };

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
    .replace(/[^\p{L}\p{N}]+/gu, " ")
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

function relevantKnowledge(question: string, entries: KnowledgeEntry[], limit = 5) {
  const queryWords = words(question);
  if (!queryWords.length) return entries;

  const ranked = entries
    .map((entry) => {
      const title = new Set(words(entry.title));
      const content = new Set(words(entry.content));
      const score = queryWords.reduce(
        (total, word) => total + (title.has(word) ? 4 : 0) + (content.has(word) ? 1 : 0),
        0,
      );
      return { entry, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score);
  const threshold = Math.max(2, Math.ceil(queryWords.length * 0.4));
  const matches = ranked.filter(({ score }) => score >= threshold).slice(0, limit);

  // Keep the full knowledge base available for questions in languages not used by its entries.
  return matches.length ? matches.map(({ entry }) => entry) : entries;
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
    const localMatch = localKnowledgeMatch(question, enabledEntries);
    const apiKey = process.env.DEEPSEEK_API_KEY || "";
    if (!apiKey) {
      if (exactMatch?.content.trim()) {
        return Response.json({
          answer: exactMatch.content.trim(),
          source: "knowledge-base" satisfies AnswerSource,
          matchedEntry: exactMatch.id,
          voiceId: config.defaultVoice,
        });
      }

      return Response.json(
        localMatch
          ? { answer: localMatch.content.trim(), source: "knowledge-base" satisfies AnswerSource, matchedEntry: localMatch.id, voiceId: config.defaultVoice }
          : { answer: config.fallbackMessage, source: "fallback" satisfies AnswerSource, voiceId: config.defaultVoice },
      );
    }

    const getMatchedKnowledgeResponse = () => {
      if (!exactMatch && !localMatch) {
        return Response.json({
          answer: config.fallbackMessage,
          source: "fallback" satisfies AnswerSource,
          voiceId: config.defaultVoice,
        });
      }

      const entry = exactMatch || localMatch;
      return Response.json({
        answer: entry?.content.trim() || config.fallbackMessage,
        source: entry?.content.trim() ? "knowledge-base" satisfies AnswerSource : "fallback" satisfies AnswerSource,
        matchedEntry: entry?.id,
        voiceId: config.defaultVoice,
      });
    };

    const selectedEntries = relevantKnowledge(question, enabledEntries);
    const knowledge = selectedEntries
      .map((entry) => `Title: ${entry.title}\nContent: ${entry.content}`)
      .join("\n\n");

    const model = process.env.DEEPSEEK_MODEL || "deepseek-flash";
    const policy = `${config.systemPrompt}

SOURCE POLICY — this policy overrides conflicting source instructions above:
1. Use the OFFICIAL KNOWLEDGE BASE first. It is authoritative and overrides general knowledge.
2. Questions about Siruma products, services, prices, bookings, availability, schedules, policies, contacts, safety rules, official claims, or other business details must be answered only from the official knowledge base. If absent, return the fallback source.
3. For non-commercial visitor questions not answered by the knowledge base, you may use cautious general travel knowledge, begin with a brief disclosure translated into the visitor's language, and mark the source as general.
4. Never invent precise routes, fares, opening hours, weather, road conditions, schedules, availability, or time-sensitive facts.
5. If uncertain, return the fallback source.
6. Answer in the same language as the visitor's latest question. You may translate relevant official knowledge faithfully, but do not change its facts.
7. Keep answers very concise and natural for speech: use one or two short sentences, ideally under 280 characters. Do not use Markdown, headings, bullets, raw URLs, or formatting characters.
8. Select a matching premium voice from this catalog when one supports the answer language: ${MARIA_VOICES.map((voice) => `${voice.id} (${voice.languageCode})`).join(", ")}. If none matches, use null.
9. Return only valid JSON: {"answer":"text","source":"knowledge-base|general|fallback","voiceId":"catalog-id|null"}.

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
        max_tokens: 200,
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
      return getMatchedKnowledgeResponse();
    }

    const voiceId = typeof structured.voiceId === "string" &&
      MARIA_VOICES.some((voice) => voice.id === structured.voiceId)
      ? structured.voiceId
      : null;

    if (structured.source === "general") {
      const answer = structured.answer.trim();
      return Response.json({
        answer: answer || config.fallbackMessage,
        source: answer ? "general" : "fallback",
        voiceId: answer ? voiceId : config.defaultVoice,
      });
    }

    if (structured.source !== "knowledge-base") {
      return getMatchedKnowledgeResponse();
    }

    return Response.json({
      answer: structured.answer.trim(),
      source: "knowledge-base" satisfies AnswerSource,
      voiceId,
    });
  } catch (error) {
    console.error("Maria chat failed", error);
    return Response.json({ error: "Maria is temporarily unavailable" }, { status: 503 });
  }
}
