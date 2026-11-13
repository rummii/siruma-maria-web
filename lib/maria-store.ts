import { getRailwayObject, putRailwayObject } from "@/lib/railway-storage";
import { DEFAULT_MARIA_VOICE_ID } from "@/lib/voices";

export type MariaConfig = {
  welcomeMessage: string;
  fallbackMessage: string;
  systemPrompt: string;
  defaultVoice: string;
  defaultLanguage: string;
  avatarObject: string;
  avatarType: "video" | "image";
  responseMode: "text-and-voice" | "voice-only" | "text-only";
  suggestions: string[];
  webSearchEnabled: boolean;
  webSearchMaxResults: number;
  offTopicMode: "fallback" | "brief";
  maxHistoryTurns: number;
  updatedAt?: string;
};

export type MariaVoiceProvider = "google" | "deepgram";

export type MariaConfigWithProvider = MariaConfig & { defaultVoiceProvider?: MariaVoiceProvider };

export const DEFAULT_CONFIG: MariaConfigWithProvider = {
  welcomeMessage: "Magandang araw! I’m Maria, your AI Tourism Ambassador. How may I help you discover Siruma today?",
  fallbackMessage: "I’m sorry, I don’t have enough information to answer that yet. Please ask about Siruma’s destinations and activities.",
  systemPrompt: "You are Maria, Siruma’s warm and accurate tourism ambassador. Treat the official knowledge base as authoritative for Siruma products, services, and official information. For broader non-commercial visitor questions, provide cautious general guidance when reliable. Keep answers concise and visitor-friendly.",
  defaultVoice: DEFAULT_MARIA_VOICE_ID,
  defaultLanguage: "en-US",
  avatarObject: "",
  avatarType: "video",
  responseMode: "text-and-voice",
  suggestions: ["What can I do in Siruma?", "Tell me about paragliding", "Plan a day trip"],
  webSearchEnabled: true,
  webSearchMaxResults: 5,
  offTopicMode: "fallback",
  maxHistoryTurns: 5,
};

export type KnowledgeEntry = {
  id: string;
  title: string;
  content: string;
  enabled: boolean;
  updatedAt?: string;
};

const CONFIG_KEY = "maria/config.json";
const KNOWLEDGE_KEY = "maria/knowledge.json";
const STORE_CACHE_TTL_MS = 30_000;

let configCache: { value: MariaConfigWithProvider; expiresAt: number } | null = null;
let configLoad: Promise<MariaConfigWithProvider> | null = null;
let knowledgeCache: { value: KnowledgeEntry[]; expiresAt: number } | null = null;
let knowledgeLoad: Promise<KnowledgeEntry[]> | null = null;

async function readJson<T>(key: string): Promise<T | null> {
  const response = await getRailwayObject(key);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Unable to read ${key} (${response.status})`);
  return (await response.json()) as T;
}

async function writeJson(key: string, value: unknown) {
  await putRailwayObject(key, Buffer.from(JSON.stringify(value, null, 2)), "application/json");
}

export async function getMariaConfig(): Promise<MariaConfigWithProvider> {
  if (configCache && configCache.expiresAt > Date.now()) return configCache.value;
  if (configLoad) return configLoad;

  const load = readJson<Partial<MariaConfigWithProvider>>(CONFIG_KEY).then((stored) => {
    const value = { ...DEFAULT_CONFIG, ...(stored ?? {}) };
    configCache = { value, expiresAt: Date.now() + STORE_CACHE_TTL_MS };
    return value;
  });
  configLoad = load;
  try {
    return await load;
  } finally {
    if (configLoad === load) configLoad = null;
  }
}

export async function saveMariaConfig(config: MariaConfigWithProvider): Promise<MariaConfigWithProvider> {
  const saved = { ...config, updatedAt: new Date().toISOString() };
  await writeJson(CONFIG_KEY, saved);
  configCache = { value: saved, expiresAt: Date.now() + STORE_CACHE_TTL_MS };
  return saved;
}

export async function listKnowledge(): Promise<KnowledgeEntry[]> {
  if (knowledgeCache && knowledgeCache.expiresAt > Date.now()) return knowledgeCache.value;
  if (knowledgeLoad) return knowledgeLoad;

  const load = readJson<KnowledgeEntry[]>(KNOWLEDGE_KEY).then((entries) => {
    const value = Array.isArray(entries) ? entries : [];
    knowledgeCache = { value, expiresAt: Date.now() + STORE_CACHE_TTL_MS };
    return value;
  });
  knowledgeLoad = load;
  try {
    return await load;
  } finally {
    if (knowledgeLoad === load) knowledgeLoad = null;
  }
}

export async function saveKnowledge(
  input: Pick<KnowledgeEntry, "title" | "content" | "enabled"> & { id?: string },
): Promise<KnowledgeEntry> {
  const entries = [...await listKnowledge()];
  const entry: KnowledgeEntry = {
    id: input.id || crypto.randomUUID(),
    title: input.title,
    content: input.content,
    enabled: input.enabled,
    updatedAt: new Date().toISOString(),
  };
  const index = entries.findIndex((item) => item.id === entry.id);
  if (index >= 0) entries[index] = entry;
  else entries.push(entry);
  await writeJson(KNOWLEDGE_KEY, entries);
  knowledgeCache = { value: entries, expiresAt: Date.now() + STORE_CACHE_TTL_MS };
  return entry;
}

export async function deleteKnowledge(id: string): Promise<void> {
  const entries = await listKnowledge();
  const remaining = entries.filter((entry) => entry.id !== id);
  await writeJson(KNOWLEDGE_KEY, remaining);
  knowledgeCache = { value: remaining, expiresAt: Date.now() + STORE_CACHE_TTL_MS };
}
