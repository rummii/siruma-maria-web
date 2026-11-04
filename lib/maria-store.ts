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
