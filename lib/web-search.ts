export type WebResult = {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
};

export type WebSearchOutcome = {
  /** Whether a search provider is configured at all. */
  configured: boolean;
  results: WebResult[];
  /** Populated when the provider was configured but the request failed. */
  error?: string;
};

const TAVILY_ENDPOINT = "https://api.tavily.com/search";
const CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_CACHE_ENTRIES = 200;
const MAX_SNIPPET_LENGTH = 500;

type CacheEntry = { expiresAt: number; value: WebResult[] };
const cache = new Map<string, CacheEntry>();

export function isWebSearchConfigured(): boolean {
  return Boolean(process.env.TAVILY_API_KEY?.trim());
}

export function clearWebSearchCache() {
  cache.clear();
}

function cacheKey(query: string, limit: number) {
  return `${limit}:${query
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")}`;
}

function readCache(key: string): WebResult[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function writeCache(key: string, value: WebResult[]) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const now = Date.now();
    for (const [entryKey, entry] of cache) {
      if (entry.expiresAt <= now) cache.delete(entryKey);
    }
    while (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next();
      if (oldest.done) break;
      cache.delete(oldest.value);
    }
  }
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
}

function hostnameOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

function sanitizeResults(raw: unknown, limit: number): WebResult[] {
  if (!Array.isArray(raw)) return [];
  const results: WebResult[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const url = typeof record.url === "string" ? record.url.trim() : "";
    if (!/^https?:\/\//i.test(url)) continue;
    const title = typeof record.title === "string" ? record.title.replace(/\s+/g, " ").trim() : "";
    const content = typeof record.content === "string" ? record.content : "";
    results.push({
      title: title || hostnameOf(url),
      url,
      snippet: content.replace(/\s+/g, " ").trim().slice(0, MAX_SNIPPET_LENGTH),
      publishedAt: typeof record.published_date === "string" ? record.published_date : undefined,
    });
    if (results.length >= limit) break;
  }
  return results;
}

/**
 * Search the public web through Tavily. Failures are swallowed and reported as an
 * empty result set so a chat turn degrades to knowledge base + general guidance
 * instead of returning a 5xx to the visitor.
 *
 * Only the query string is sent to the provider — never knowledge-base contents.
 */
export async function searchWeb(
  query: string,
  options: { limit?: number } = {},
): Promise<WebSearchOutcome> {
  const cleanQuery = query.replace(/\s+/g, " ").trim().slice(0, 400);
  const limit = Math.min(8, Math.max(1, Math.round(options.limit ?? 5)));
  if (!cleanQuery) return { configured: isWebSearchConfigured(), results: [] };

  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) {
    return { configured: false, results: [], error: "Web search is not configured." };
  }

  const key = cacheKey(cleanQuery, limit);
  const cached = readCache(key);
  if (cached) return { configured: true, results: cached };

  try {
    const response = await fetch(TAVILY_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: cleanQuery,
        search_depth: process.env.TAVILY_SEARCH_DEPTH === "advanced" ? "advanced" : "basic",
        max_results: limit,
        topic: "general",
        include_answer: false,
        include_published_date: true,
        chunks_per_source: 2,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const details = await response.text();
      return {
        configured: true,
        results: [],
        error: `Tavily request failed (${response.status}): ${details.slice(0, 200)}`,
      };
    }

    const payload = (await response.json()) as { results?: unknown };
    const results = sanitizeResults(payload.results, limit);
    writeCache(key, results);
    return { configured: true, results };
  } catch (error) {
    return {
      configured: true,
      results: [],
      error: error instanceof Error ? error.message : "Web search failed",
    };
  }
}
