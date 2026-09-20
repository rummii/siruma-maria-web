import { googleJson, projectId } from "@/lib/google-cloud";
import { getMariaConfig, listKnowledge } from "@/lib/maria-store";

const MAX_QUESTION_LENGTH = 1000;
const GENERAL_DISCLOSURE = "Based on general travel information, ";

type AnswerSource = "knowledge-base" | "general" | "fallback";

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
};

type StructuredAnswer = {
  answer?: string;
  source?: AnswerSource;
};

function parseStructuredAnswer(raw: string): StructuredAnswer | null {
  try {
    return JSON.parse(raw) as StructuredAnswer;
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

    const knowledge = enabledEntries
      .map((entry) => `Title: ${entry.title}\nContent: ${entry.content}`)
      .join("\n\n");

    const region = process.env.VERTEX_AI_REGION || "us-central1";
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const endpoint =
      `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId()}` +
      `/locations/${region}/publishers/google/models/${model}:generateContent`;

    const policy = `${config.systemPrompt}

SOURCE POLICY — this policy overrides conflicting source instructions above:
1. Use the OFFICIAL KNOWLEDGE BASE first. It is authoritative and must override your general knowledge.
2. Questions about Siruma products, services, prices, bookings, availability, schedules, policies, contacts, safety rules, official claims, or other business details must be answered only from the official knowledge base. If absent, return the fallback source.
3. For non-commercial visitor questions not answered by the knowledge base, such as general travel preparation, broad geography, culture, or attraction ideas, you may use reliable general knowledge. Mark the source as general.
4. Never invent precise routes, fares, opening hours, weather, road conditions, transport schedules, availability, or other time-sensitive facts. If the answer depends on current or uncertain information not supplied in the knowledge base, return the fallback source.
5. If uncertain, return the fallback source.
6. Keep answers concise, helpful, and natural for spoken delivery. Do not use Markdown, headings, bullets, asterisks, hash symbols, raw URLs, or formatting characters.

Configured fallback message: ${config.fallbackMessage}`;

    const result = await googleJson<GeminiResponse>(endpoint, {
      method: "POST",
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: policy }],
        },
        contents: [{
          role: "user",
          parts: [{
            text:
              `OFFICIAL KNOWLEDGE BASE:\n${knowledge || "(No official entries are currently enabled.)"}` +
              `\n\nVISITOR QUESTION:\n${question}`,
          }],
        }],
        generationConfig: {
          temperature: 0.15,
          maxOutputTokens: 350,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              answer: { type: "STRING" },
              source: {
                type: "STRING",
                enum: ["knowledge-base", "general", "fallback"],
              },
            },
            required: ["answer", "source"],
          },
        },
      }),
    });

    const raw = result.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim() || "";
    const structured = parseStructuredAnswer(raw);

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
