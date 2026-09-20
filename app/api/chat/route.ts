import { googleJson, projectId } from "@/lib/google-cloud";
import { getMariaConfig, listKnowledge } from "@/lib/maria-store";

const MAX_QUESTION_LENGTH = 1000;

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
};

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
    const knowledge = entries
      .filter((entry) => entry.enabled)
      .map((entry) => `## ${entry.title}\n${entry.content}`)
      .join("\n\n");

    if (!knowledge) return Response.json({ answer: config.fallbackMessage });

    const region = process.env.VERTEX_AI_REGION || "us-central1";
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const endpoint =
      `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId()}` +
      `/locations/${region}/publishers/google/models/${model}:generateContent`;

    const result = await googleJson<GeminiResponse>(endpoint, {
      method: "POST",
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: `${config.systemPrompt}\n\nFallback message: ${config.fallbackMessage}` }],
        },
        contents: [{
          role: "user",
          parts: [{ text: `KNOWLEDGE BASE:\n${knowledge}\n\nVISITOR QUESTION:\n${question}` }],
        }],
        generationConfig: {
          temperature: 0.25,
          maxOutputTokens: 300,
        },
      }),
    });

    const answer = result.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim();

    return Response.json({ answer: answer || config.fallbackMessage });
  } catch (error) {
    console.error("Maria chat failed", error);
    return Response.json({ error: "Maria is temporarily unavailable" }, { status: 503 });
  }
}
