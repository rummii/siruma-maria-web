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

export type KnowledgeEntry = {
  id: string;
  title: string;
  content: string;
  enabled: boolean;
  updatedAt?: string;
};

export const DEFAULT_CONFIG: MariaConfig = {
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

type MariaData = {
  config: MariaConfig;
  knowledge: KnowledgeEntry[];
};

const DATA_OBJECT = "maria/data.json";
let mutationQueue: Promise<void> = Promise.resolve();

function defaultData(): MariaData {
  return { config: { ...DEFAULT_CONFIG }, knowledge: [] };
}

function normalizeData(value: Partial<MariaData> | null): MariaData {
  return {
    config: { ...DEFAULT_CONFIG, ...(value?.config || {}) },
    knowledge: Array.isArray(value?.knowledge) ? value.knowledge : [],
  };
}

async function readData(): Promise<MariaData> {
  const response = await getRailwayObject(DATA_OBJECT);
  if (response.status === 404) return defaultData();
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Railway data read failed (${response.status}): ${details.slice(0, 300)}`);
  }
  return normalizeData((await response.json()) as Partial<MariaData>);
}

async function writeData(data: MariaData) {
  await putRailwayObject(
    DATA_OBJECT,
    Buffer.from(JSON.stringify(data)),
    "application/json; charset=utf-8",
  );
}

async function mutate<T>(operation: (data: MariaData) => T | Promise<T>): Promise<T> {
  let result!: T;
  const next = mutationQueue.then(async () => {
    const data = await readData();
    result = await operation(data);
    await writeData(data);
  });
  mutationQueue = next.then(() => undefined, () => undefined);
  await next;
  return result;
}

export async function getMariaConfig(): Promise<MariaConfig> {
  return (await readData()).config;
}

export async function saveMariaConfig(config: MariaConfig) {
  return mutate((data) => {
    const saved = { ...config, updatedAt: new Date().toISOString() };
    data.config = saved;
    return saved;
  });
}

export async function listKnowledge(): Promise<KnowledgeEntry[]> {
  const entries = (await readData()).knowledge;
  return [...entries].sort((a, b) => a.title.localeCompare(b.title));
}

export async function saveKnowledge(entry: KnowledgeEntry) {
  return mutate((data) => {
    const id = entry.id || crypto.randomUUID();
    const saved = { ...entry, id, updatedAt: new Date().toISOString() };
    const index = data.knowledge.findIndex((item) => item.id === id);
    if (index >= 0) data.knowledge[index] = saved;
    else data.knowledge.push(saved);
    return saved;
  });
}

export async function deleteKnowledge(id: string) {
  await mutate((data) => {
    data.knowledge = data.knowledge.filter((entry) => entry.id !== id);
  });
}
