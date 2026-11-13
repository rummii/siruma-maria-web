import { getRailwayObject, putRailwayObject } from "@/lib/railway-storage";

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
  updatedAt?: string;
};

export type MariaVoiceProvider = "google" | "deepgram";

export type MariaConfigWithProvider = MariaConfig & { defaultVoiceProvider?: MariaVoiceProvider };

export const DEFAULT_CONFIG: MariaConfigWithProvider = {
  welcomeMessage: "Magandang araw! I’m Maria, your AI Tourism Ambassador. How may I help you discover Siruma today?",
  fallbackMessage: "I’m sorry, I don’t have enough information to answer that yet. Please ask about Siruma’s destinations and activities.",
  systemPrompt: "You are Maria, Siruma’s warm and accurate tourism ambassador. Treat the official knowledge base as authoritative for Siruma products, services, and official information. For broader non-commercial visitor questions, provide cautious general guidance when reliable. Keep answers concise and visitor-friendly.",
  defaultVoice: "us-female",
  defaultLanguage: "en-US",
  avatarObject: "",
  avatarType: "video",
  responseMode: "text-and-voice",
  suggestions: ["What can I do in Siruma?", "Tell me about paragliding", "Plan a day trip"],
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
  const stored = await readJson<Partial<MariaConfigWithProvider>>(CONFIG_KEY);
  return { ...DEFAULT_CONFIG, ...(stored ?? {}) };
}

export async function saveMariaConfig(config: MariaConfigWithProvider): Promise<MariaConfigWithProvider> {
  const saved = { ...config, updatedAt: new Date().toISOString() };
  await writeJson(CONFIG_KEY, saved);
  return saved;
}

export async function listKnowledge(): Promise<KnowledgeEntry[]> {
  const entries = await readJson<KnowledgeEntry[]>(KNOWLEDGE_KEY);
  return Array.isArray(entries) ? entries : [];
}

export async function saveKnowledge(
  input: Pick<KnowledgeEntry, "title" | "content" | "enabled"> & { id?: string },
): Promise<KnowledgeEntry> {
  const entries = await listKnowledge();
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
  return entry;
}

export async function deleteKnowledge(id: string): Promise<void> {
  const entries = await listKnowledge();
  await writeJson(KNOWLEDGE_KEY, entries.filter((entry) => entry.id !== id));
}
