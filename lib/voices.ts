export type MariaVoice = {
  id: string;
  label: string;
  languageCode: string;
  name: string;
  gender: "FEMALE" | "MALE";
};

export const MARIA_VOICES: MariaVoice[] = [
  { id: "filipino-female", label: "Filipino — Female", languageCode: "fil-PH", name: "fil-PH-Wavenet-A", gender: "FEMALE" },
  { id: "us-female", label: "English (US) — Female", languageCode: "en-US", name: "en-US-Neural2-F", gender: "FEMALE" },
  { id: "us-female-c", label: "English (US) — Female C", languageCode: "en-US", name: "en-US-Neural2-C", gender: "FEMALE" },
  { id: "uk-female", label: "English (UK) — Female", languageCode: "en-GB", name: "en-GB-Neural2-A", gender: "FEMALE" },
  { id: "australian-female", label: "English (Australia) — Female", languageCode: "en-AU", name: "en-AU-Neural2-A", gender: "FEMALE" },
  { id: "spanish-us-female", label: "Spanish (US) — Female", languageCode: "es-US", name: "es-US-Neural2-A", gender: "FEMALE" },
];

export function voiceById(id?: string) {
  return MARIA_VOICES.find((voice) => voice.id === id) || MARIA_VOICES[0];
}
