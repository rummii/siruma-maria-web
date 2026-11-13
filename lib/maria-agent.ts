import type { KnowledgeEntry, MariaConfigWithProvider } from "@/lib/maria-store";
import { takeWebSearchBudget } from "@/lib/rate-limit";
import { MARIA_VOICES } from "@/lib/voices";
import { isWebSearchConfigured, searchWeb, type WebResult } from "@/lib/web-search";

export type AnswerSource = "knowledge-base" | "web" | "mixed" | "general" | "fallback";

export type Citation = { title: string; url: string };

export type ChatTurn = { role: "visitor" | "maria"; text: string };

export type MariaAnswer = {
  answer: string;
  /** TTS-safe version of the answer: plain prose, no URLs, no citations. */
  speech: string;
  source: AnswerSource;
  citations: Citation[];
  followUps: string[];
  voiceId: string | null;
  matchedEntry?: string;
};

export type MariaAgentOptions = {
  apiKey: string;
  model: string;
  config: MariaConfigWithProvider;
  entries: KnowledgeEntry[];
  history: ChatTurn[];
  question: string;
  allowWebSearch: boolean;
};

const MAX_TOOL_ROUNDS = 2;
const MAX_TOOL_CALLS = 3;
const MAX_KNOWLEDGE_SNIPPETS = 4;
const MAX_SPEECH_CHARS = 400;
const MAX_ANSWER_CHARS = 1_500;
const MAX_FOLLOW_UPS = 3;
const MAX_FOLLOW_UP_CHARS = 80;
const DEEPSEEK_TIMEOUT_MS = 20_000;
const COMPOSE_ATTEMPTS = 2;

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "can", "do", "for", "how", "i", "in", "is", "me", "of",
  "on", "please", "tell", "the", "to", "what", "where", "with", "you",
]);

export function normalizeKnowledgeKey(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function words(value: string) {
  return normalizeKnowledgeKey(value)
    .split(" ")
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

/** Short, pronoun-heavy follow-ups inherit meaning from the previous visitor turn. */
function needsConversationContext(question: string) {
  const wordCount = question.split(/\s+/).filter(Boolean).length;
  return (
    wordCount <= 5 ||
    /\b(it|its|that|this|these|those|there|they|them|same|also|another|more)\b/i.test(question)
  );
}

function lastVisitorTurn(history: ChatTurn[]) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].role === "visitor") return history[index].text;
  }
  return "";
}

function contextFor(question: string, history: ChatTurn[]) {
  return needsConversationContext(question) ? lastVisitorTurn(history) : "";
}

export function rankKnowledge(
  question: string,
  context: string,
  entries: KnowledgeEntry[],
  limit = MAX_KNOWLEDGE_SNIPPETS,
) {
  const queryWords = [...new Set(words(`${question} ${context}`))];
  if (!queryWords.length) return [];

  const threshold = Math.max(2, Math.ceil(queryWords.length * 0.4));
  return entries
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
    .sort((left, right) => right.score - left.score)
    .filter(({ score }) => score >= threshold)
    .slice(0, limit);
}

/** A confident knowledge-base hit can skip the tool loop entirely. */
function isConfidentMatch(question: string, ranked: Array<{ entry: KnowledgeEntry; score: number }>) {
  if (!ranked.length) return false;
  // Title words are weighted 4x during ranking, so a title hit is a strong anchor.
  if (ranked[0].score >= 4) return true;
  const key = normalizeKnowledgeKey(question);
  return key.length > 0 && normalizeKnowledgeKey(ranked[0].entry.title) === key;
}

export function deriveSpeech(answer: string) {
  const plain = answer
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\([^)]*(?:https?:|www\.)[^)]*\)/gi, " ")
    .replace(/[*_`#>|[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = plain.split(/(?<=[.!?])\s+/).slice(0, 3).join(" ").trim();
  return (sentences || plain).slice(0, MAX_SPEECH_CHARS).trim();
}

function knowledgeTitleSuggestions(entries: KnowledgeEntry[], excludeId?: string) {
  return entries
    .filter((entry) => entry.id !== excludeId)
    .map((entry) => entry.title.trim())
    .filter(Boolean)
    .slice(0, 2)
    .map((title) => (title.length > 60 ? `${title.slice(0, 57)}…` : title));
}

/**
 * Deterministic answer used when the model is unavailable, unconfigured, or
 * returns something unusable. Never invents facts: it either returns the matched
 * knowledge entry verbatim or the configured fallback message.
 */
export function buildLocalAnswer(options: {
  question: string;
  entries: KnowledgeEntry[];
  config: MariaConfigWithProvider;
  history: ChatTurn[];
}): MariaAnswer {
  const { question, entries, config, history } = options;
  const ranked = rankKnowledge(question, contextFor(question, history), entries, 1);
  const match = ranked[0]?.entry;

  if (match?.content.trim()) {
    const answer = match.content.trim();
    return {
      answer,
      speech: deriveSpeech(answer),
      source: "knowledge-base",
      citations: [],
      followUps: knowledgeTitleSuggestions(entries, match.id),
      voiceId: config.defaultVoice,
      matchedEntry: match.id,
    };
  }

  return {
    answer: config.fallbackMessage,
    speech: deriveSpeech(config.fallbackMessage),
    source: "fallback",
    citations: [],
    followUps: knowledgeTitleSuggestions(entries),
    voiceId: config.defaultVoice,
  };
}

type ToolCall = {
  id: string;
  type?: string;
  function?: { name?: string; arguments?: string };
};

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

type CompletionMessage = { content?: string | null; tool_calls?: ToolCall[] };
type CompletionResponse = { choices?: Array<{ message?: CompletionMessage }> };

/** Bounded, log-safe description of a failure for production diagnostics. */
function describeError(error: unknown) {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.slice(0, 300);
}

async function postDeepSeek(apiKey: string, body: Record<string, unknown>): Promise<CompletionMessage> {
  const request = async (payload: Record<string, unknown>) =>
    fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(DEEPSEEK_TIMEOUT_MS),
    });

  let response = await request(body);

  if (!response.ok) {
    const details = await response.text();
    // Some deployments reject unknown top-level fields; drop the optional
    // thinking toggle once before giving up on the turn.
    if (response.status === 400 && "thinking" in body && /thinking/i.test(details)) {
      const rest = { ...body };
      delete rest.thinking;
      response = await request(rest);
      if (!response.ok) {
        const retryDetails = await response.text();
        throw new Error(
          `DeepSeek request failed (${response.status}): ${retryDetails.slice(0, 300)}`,
        );
      }
    } else {
      throw new Error(`DeepSeek request failed (${response.status}): ${details.slice(0, 300)}`);
    }
  }

  const payload = (await response.json()) as CompletionResponse;
  return payload.choices?.[0]?.message ?? {};
}

function buildPolicy(config: MariaConfigWithProvider, webAvailable: boolean) {
  const voiceCatalog = MARIA_VOICES.map((voice) => `${voice.id} (${voice.languageCode})`).join(", ");
  const webNote = webAvailable
    ? "Use the search_web tool for these questions."
    : "Web search is currently unavailable, so answer these questions from Tier 3 and say that you could not verify them.";

  return `${config.systemPrompt}

HOW TO ANSWER — apply these tiers in order and never skip a higher tier for a lower one.

TIER 1 — SIRUMA FACTS (highest authority)
Anything about Siruma, its barangays, islands, beaches, coves, resorts, operators, tour packages, prices, fees, schedules, boat departures, policies, booking rules, contacts, or safety guidance must come from the official knowledge base. The knowledge base always outranks web results, other sources, and your own knowledge. If it does not contain a figure — a price, a departure time, a phone number, availability — say that it is not confirmed and suggest the visitor contact the tourism office. Never estimate, round, update, or invent these details.

TIER 2 — TRAVEL LOGISTICS (web allowed)
For practical travel questions the knowledge base does not cover — how to reach Siruma from Manila or Naga, bus terminals, jeepney and boat transfers, distances, travel times, nearby towns — ${webNote}
When you answer from the web: name the source in the sentence (for example "according to ..."), keep only facts that appear in the search results, and say when the information may be outdated or when sources disagree. If the search returns nothing useful, drop to Tier 3 instead of guessing.

TIER 3 — GENERAL GUIDANCE
For harmless general travel advice (packing, sun protection, trip pacing, what a small coastal town is like) answer briefly from general knowledge. Open with a short natural disclosure, translated into the visitor's language, such as "This is general travel advice, not official Siruma information." Tier 3 must never override a Tier 1 fact.

TIER 4 — FALLBACK AND REDIRECT
If the request is unrelated to Siruma or to travel — homework, coding, medical, legal, financial, or other off-topic asks — do not attempt it. Reply with the configured fallback message in the visitor's language and offer two topics you can help with, drawn from the knowledge base. Never give instructions that could cause harm.

GLOBAL RULES
- Answer in the same language as the visitor's latest message. You may translate knowledge-base facts faithfully but never change them.
- Write 2 to 5 natural sentences, conversational and warm. No Markdown, no headings, no bullet points.
- "answer" is the full reply the visitor reads and may contain a source URL. "speech" is the same reply rewritten for text-to-speech: plain prose, no URLs, no citations, no symbols, at most ${MAX_SPEECH_CHARS} characters.
- Put web sources in "citations" only when you actually used them, copying the exact url from the search results. Never invent a URL.
- "followUps" holds up to three short follow-up questions the visitor might ask next, each under 60 characters.
- Select a matching voice from: ${voiceCatalog}. If none fits the answer language, use null.
- Configured fallback message: ${config.fallbackMessage}`;
}


const TOOL_SCHEMAS = [
  {
    type: "function",
    function: {
      name: "search_knowledge",
      description:
        "Search Siruma's official knowledge base. Use for any question about Siruma places, activities, operators, prices, schedules, policies, contacts, or safety.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Short search phrase, for example 'boat schedule Siruma'." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_web",
      description:
        "Search the public web for travel logistics the knowledge base does not cover: routes, bus terminals, transfers, distances, travel time.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Short search phrase, for example 'how to get to Siruma Camarines Sur'." },
        },
        required: ["query"],
      },
    },
  },
];

function parseToolQuery(rawArguments?: string) {
  if (!rawArguments) return "";
  try {
    const parsed = JSON.parse(rawArguments) as Record<string, unknown>;
    const candidate = parsed.query ?? parsed.q ?? parsed.search;
    return typeof candidate === "string" ? candidate.replace(/\s+/g, " ").trim().slice(0, 400) : "";
  } catch {
    return "";
  }
}

function formatKnowledgeToolResult(query: string, ranked: Array<{ entry: KnowledgeEntry; score: number }>) {
  if (!ranked.length) {
    return `No knowledge-base entry matched "${query}". Treat Siruma-specific facts as unconfirmed and do not invent them.`;
  }
  return ranked.map(({ entry }) => `Title: ${entry.title}\nContent: ${entry.content}`).join("\n\n---\n\n");
}

function formatWebToolResult(outcome: Awaited<ReturnType<typeof searchWeb>>) {
  if (!outcome.configured) {
    return "Web search is not configured. Answer from the knowledge base or general guidance and do not guess travel logistics.";
  }
  if (outcome.error) {
    return `Web search failed (${outcome.error}). Do not guess travel logistics; say you could not verify them.`;
  }
  if (!outcome.results.length) {
    return "No web results were found. Do not guess travel logistics; say you could not verify them.";
  }
  return outcome.results
    .map(
      (result, index) =>
        `${index + 1}. ${result.title}\n   url: ${result.url}\n   ${result.snippet}${
          result.publishedAt ? `\n   published: ${result.publishedAt}` : ""
        }`,
    )
    .join("\n\n");
}


type Gathered = { knowledge: KnowledgeEntry[]; web: WebResult[] };

async function runToolLoop(args: {
  apiKey: string;
  model: string;
  system: string;
  history: ChatTurn[];
  question: string;
  entries: KnowledgeEntry[];
  allowWebSearch: boolean;
  maxWebResults: number;
}) {
  const gathered: Gathered = { knowledge: [], web: [] };
  const messages: ChatMessage[] = [
    { role: "system", content: args.system },
    ...args.history.map((turn) => ({
      role: turn.role === "visitor" ? ("user" as const) : ("assistant" as const),
      content: turn.text,
    })),
    { role: "user", content: args.question },
  ];

  let toolCallsUsed = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    let message: CompletionMessage;
    try {
      message = await postDeepSeek(args.apiKey, {
        model: args.model,
        messages,
        tools: TOOL_SCHEMAS,
        tool_choice: "auto",
        temperature: 0.2,
        max_tokens: 400,
        thinking: { type: "disabled" },
      });
    } catch (error) {
      // Gathering context is an optimisation, not a requirement: a model that
      // rejects tooling or a slow round must not cost the visitor the answer.
      console.error("Maria tool round failed", round, describeError(error));
      break;
    }

    const calls = message.tool_calls ?? [];
    if (!calls.length) break;

    messages.push({ role: "assistant", content: message.content ?? "", tool_calls: calls });

    for (const call of calls) {
      if (toolCallsUsed >= MAX_TOOL_CALLS) {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: "Tool call limit reached. Answer with the information you already have.",
        });
        continue;
      }
      toolCallsUsed += 1;

      const name = call.function?.name ?? "";
      const query = parseToolQuery(call.function?.arguments);

      if (name === "search_knowledge") {
        const ranked = rankKnowledge(query || args.question, "", args.entries, MAX_KNOWLEDGE_SNIPPETS);
        for (const { entry } of ranked) {
          if (!gathered.knowledge.some((item) => item.id === entry.id)) gathered.knowledge.push(entry);
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: formatKnowledgeToolResult(query || args.question, ranked),
        });
        continue;
      }

      if (name === "search_web") {
        if (!args.allowWebSearch) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: "Web search is not available. Use the knowledge base or general guidance instead.",
          });
          continue;
        }
        if (!takeWebSearchBudget()) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content:
              "The web search budget for this hour is exhausted. Use general guidance and tell the visitor to confirm details with the tourism office.",
          });
          continue;
        }
        const outcome = await searchWeb(query || args.question, { limit: args.maxWebResults });
        for (const result of outcome.results) {
          if (!gathered.web.some((item) => item.url === result.url)) gathered.web.push(result);
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: formatWebToolResult(outcome) });
        continue;
      }

      messages.push({ role: "tool", tool_call_id: call.id, content: `Unknown tool: ${name}` });
    }
  }

  return { gathered, toolCallsUsed };
}


const COMPOSE_INSTRUCTION = `Return one valid JSON object matching exactly this shape:
{"answer":"...","speech":"...","source":"knowledge-base|web|mixed|general|fallback","citations":[{"title":"...","url":"..."}],"followUps":["..."],"voiceId":"catalog-id or null"}

Example JSON output:
{"answer":"Jeepneys from Naga to Siruma take about three hours, then a short boat ride to the islands (according to a travel guide).","speech":"Jeepneys from Naga to Siruma take about three hours, then a short boat ride to the islands, according to a travel guide.","source":"web","citations":[{"title":"Getting to Siruma","url":"https://example.com/siruma"}],"followUps":["Where do I catch the jeepney?","How long is the boat ride?"],"voiceId":"us-female"}

Rules: use "knowledge-base" when the reply comes from the knowledge base, "web" when it relies on web results, "mixed" when it uses both, "general" for general guidance, and "fallback" for the off-topic reply. Only include citations whose url appears verbatim in the web search results above; never invent a url. Keep "answer" under 900 characters and free of Markdown. "speech" must be plain prose with no url and no citation.`;

type StructuredAnswer = {
  answer?: unknown;
  speech?: unknown;
  source?: unknown;
  citations?: unknown;
  followUps?: unknown;
  voiceId?: unknown;
};

function parseStructuredAnswer(raw: string): StructuredAnswer | null {
  const cleaned = raw
    .replace(/^\uFEFF/, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const candidates = [cleaned];
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(cleaned.slice(firstBrace, lastBrace + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (typeof parsed === "object" && parsed !== null) return parsed as StructuredAnswer;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function buildComposeUserContent(args: { question: string; knowledge: KnowledgeEntry[]; web: WebResult[] }) {
  const knowledge = args.knowledge.length
    ? args.knowledge.map((entry) => `Title: ${entry.title}\nContent: ${entry.content}`).join("\n\n---\n\n")
    : "(No official entries are currently enabled.)";
  const web = args.web.length
    ? args.web
        .map((result, index) => `${index + 1}. ${result.title} — ${result.url}\n${result.snippet}`)
        .join("\n\n")
    : "(No web results were retrieved for this message.)";

  return `OFFICIAL KNOWLEDGE BASE (authoritative):\n${knowledge}\n\nWEB SEARCH RESULTS (unverified, may be outdated):\n${web}\n\nVISITOR'S LATEST MESSAGE:\n${args.question}`;
}

async function composeAnswer(args: {
  apiKey: string;
  model: string;
  system: string;
  history: ChatTurn[];
  question: string;
  knowledge: KnowledgeEntry[];
  web: WebResult[];
}): Promise<StructuredAnswer | null> {
  const messages: ChatMessage[] = [
    { role: "system", content: `${args.system}\n\nOUTPUT FORMAT\n${COMPOSE_INSTRUCTION}` },
    ...args.history.map((turn) => ({
      role: turn.role === "visitor" ? ("user" as const) : ("assistant" as const),
      content: turn.text,
    })),
    { role: "user", content: buildComposeUserContent(args) },
  ];

  for (let attempt = 0; attempt < COMPOSE_ATTEMPTS; attempt += 1) {
    let message: CompletionMessage;
    try {
      message = await postDeepSeek(args.apiKey, {
        model: args.model,
        messages,
        temperature: attempt === 0 ? 0.25 : 0.1,
        max_tokens: 700,
        response_format: { type: "json_object" },
        thinking: { type: "disabled" },
      });
    } catch (error) {
      console.error("Maria compose attempt failed", attempt, describeError(error));
      continue;
    }

    const parsed = parseStructuredAnswer(message.content ?? "");
    if (typeof parsed?.answer === "string" && parsed.answer.trim()) return parsed;
    console.error("Maria compose returned unusable JSON", attempt, (message.content ?? "").slice(0, 160));
  }

  return null;
}


const SOURCES: AnswerSource[] = ["knowledge-base", "web", "mixed", "general", "fallback"];

function normalizeUrl(url: string) {
  return url.trim().replace(/\/+$/, "").toLocaleLowerCase();
}

function normalizeSource(value: unknown): AnswerSource {
  return typeof value === "string" && (SOURCES as string[]).includes(value)
    ? (value as AnswerSource)
    : "general";
}

/** Drops any citation the model did not actually receive from search_web. */
function buildCitationList(raw: unknown, allowlist: Map<string, Citation>): Citation[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const citations: Citation[] = [];

  for (const item of raw) {
    const candidate =
      typeof item === "string"
        ? item
        : typeof item === "object" && item !== null
          ? (item as Record<string, unknown>).url
          : undefined;
    if (typeof candidate !== "string") continue;

    const key = normalizeUrl(candidate);
    const allowed = allowlist.get(key);
    if (!allowed || seen.has(key)) continue;

    seen.add(key);
    citations.push(allowed);
    if (citations.length >= 3) break;
  }

  return citations;
}

function buildFollowUps(raw: unknown, fallbackEntries: KnowledgeEntry[]) {
  const followUps: string[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item !== "string") continue;
      const clean = item.replace(/\s+/g, " ").trim();
      if (!clean || clean.length > MAX_FOLLOW_UP_CHARS) continue;
      if (followUps.includes(clean)) continue;
      followUps.push(clean);
      if (followUps.length >= MAX_FOLLOW_UPS) break;
    }
  }
  if (followUps.length) return followUps;
  return fallbackEntries.slice(0, 2).map((entry) => entry.title.trim().slice(0, MAX_FOLLOW_UP_CHARS));
}

function normalizeVoiceId(raw: unknown, fallbackVoice: string) {
  if (raw === null) return null;
  if (typeof raw === "string" && MARIA_VOICES.some((voice) => voice.id === raw)) return raw;
  return fallbackVoice;
}

/**
 * Runs the full Maria turn: knowledge ranking, an optional tool round for web
 * search, then a separate JSON composition call. Returns null when the model
 * produced nothing usable so the caller can degrade to a deterministic answer.
 */
export async function answerWithMaria(options: MariaAgentOptions): Promise<MariaAnswer | null> {
  const { apiKey, model, config, entries, history, question } = options;
  const allowWebSearch = options.allowWebSearch && isWebSearchConfigured();
  const system = buildPolicy(config, allowWebSearch);
  const ranked = rankKnowledge(question, contextFor(question, history), entries, MAX_KNOWLEDGE_SNIPPETS);

  const knowledge: KnowledgeEntry[] = ranked.map(({ entry }) => entry);
  let web: WebResult[] = [];

  // A confident knowledge-base hit answers Tier 1 directly, saving a round trip.
  if (!isConfidentMatch(question, ranked)) {
    const { gathered } = await runToolLoop({
      apiKey,
      model,
      system,
      history,
      question,
      entries,
      allowWebSearch,
      maxWebResults: config.webSearchMaxResults,
    });
    for (const entry of gathered.knowledge) {
      if (!knowledge.some((item) => item.id === entry.id)) knowledge.push(entry);
    }
    web = gathered.web;
  }

  const structured = await composeAnswer({ apiKey, model, system, history, question, knowledge, web });
  if (!structured) return null;

  const answer = typeof structured.answer === "string" ? structured.answer.trim().slice(0, MAX_ANSWER_CHARS) : "";
  if (!answer) return null;

  const allowlist = new Map<string, Citation>(
    web.map((result) => [normalizeUrl(result.url), { title: result.title, url: result.url }]),
  );
  const citations = buildCitationList(structured.citations, allowlist);
  let source = normalizeSource(structured.source);

  // Anti-hallucination gate: a web-backed answer must point at a real search result.
  if ((source === "web" || source === "mixed") && citations.length === 0) source = "general";
  if (source === "mixed" && web.length === 0) source = knowledge.length ? "knowledge-base" : "general";
  if (source === "knowledge-base" && knowledge.length === 0) source = "general";

  const speechRaw = typeof structured.speech === "string" ? structured.speech.trim() : "";
  const speech =
    speechRaw && speechRaw.length <= MAX_SPEECH_CHARS && !/https?:\/\//i.test(speechRaw)
      ? speechRaw
      : deriveSpeech(answer);

  return {
    answer,
    speech,
    source,
    citations: source === "web" || source === "mixed" ? citations : [],
    followUps: buildFollowUps(structured.followUps, entries),
    voiceId: normalizeVoiceId(structured.voiceId, config.defaultVoice),
    matchedEntry: source === "knowledge-base" ? knowledge[0]?.id : undefined,
  };
}

