import { googleJson, projectId } from "@/lib/google-cloud";

export type MariaConfig = {
  welcomeMessage: string;
  fallbackMessage: string;
  systemPrompt: string;
  defaultVoice: string;
  defaultLanguage: string;
  avatarObject: string;
  avatarType: "video" | "image";
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
  systemPrompt: "You are Maria, Siruma’s warm and accurate tourism ambassador. Answer only from the supplied knowledge base. If the answer is not present, use the configured fallback message. Keep answers concise and visitor-friendly.",
  defaultVoice: "filipino-female",
  defaultLanguage: "en-PH",
  avatarObject: "",
  avatarType: "video",
  suggestions: ["What can I do in Siruma?", "Tell me about paragliding", "Plan a day trip"],
};

type FirestoreValue = {
  stringValue?: string;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number;
  nullValue?: null;
  arrayValue?: { values?: FirestoreValue[] };
  mapValue?: { fields?: Record<string, FirestoreValue> };
};

type FirestoreDocument = {
  name?: string;
  fields?: Record<string, FirestoreValue>;
};

function encode(value: unknown): FirestoreValue {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  const fields: Record<string, FirestoreValue> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) fields[key] = encode(item);
  return { mapValue: { fields } };
}

function decode(value: FirestoreValue): unknown {
  if ("stringValue" in value) return value.stringValue || "";
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("arrayValue" in value) return (value.arrayValue?.values || []).map(decode);
  if ("mapValue" in value) return decodeFields(value.mapValue?.fields || {});
  return null;
}

function decodeFields(fields: Record<string, FirestoreValue>) {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) result[key] = decode(value);
  return result;
}

function baseUrl() {
  return `https://firestore.googleapis.com/v1/projects/${projectId()}/databases/(default)/documents`;
}

async function getDocument(path: string) {
  const token = await import("@/lib/google-cloud").then((module) => module.googleAccessToken());
  const response = await fetch(`${baseUrl()}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Firestore read failed: ${response.status}`);
  const document = (await response.json()) as FirestoreDocument;
  return decodeFields(document.fields || {});
}

async function setDocument(path: string, value: Record<string, unknown>) {
  return googleJson<FirestoreDocument>(`${baseUrl()}/${path}`, {
    method: "PATCH",
    body: JSON.stringify({ fields: encode(value).mapValue?.fields || {} }),
  });
}

export async function getMariaConfig(): Promise<MariaConfig> {
  const stored = await getDocument("maria_config/public");
  return { ...DEFAULT_CONFIG, ...(stored || {}) } as MariaConfig;
}

export async function saveMariaConfig(config: MariaConfig) {
  const saved = { ...config, updatedAt: new Date().toISOString() };
  await setDocument("maria_config/public", saved as unknown as Record<string, unknown>);
  return saved;
}

export async function listKnowledge(): Promise<KnowledgeEntry[]> {
  const token = await import("@/lib/google-cloud").then((module) => module.googleAccessToken());
  const response = await fetch(`${baseUrl()}/maria_knowledge?pageSize=100`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`Firestore list failed: ${response.status}`);
  const data = (await response.json()) as { documents?: FirestoreDocument[] };
  return (data.documents || []).map((document) => {
    const values = decodeFields(document.fields || {});
    const id = document.name?.split("/").pop() || "";
    return { id, ...values } as KnowledgeEntry;
  });
}

export async function saveKnowledge(entry: KnowledgeEntry) {
  const id = entry.id || crypto.randomUUID();
  const saved = { ...entry, id, updatedAt: new Date().toISOString() };
  await setDocument(`maria_knowledge/${encodeURIComponent(id)}`, saved as unknown as Record<string, unknown>);
  return saved;
}

export async function deleteKnowledge(id: string) {
  const token = await import("@/lib/google-cloud").then((module) => module.googleAccessToken());
  const response = await fetch(`${baseUrl()}/maria_knowledge/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok && response.status !== 404) throw new Error(`Firestore delete failed: ${response.status}`);
}
