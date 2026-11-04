export type MariaVoice = {
  id: string;
  label: string;
  languageCode: string;
  name: string;
  gender: "FEMALE" | "MALE";
  provider: "google" | "deepgram";
};

export const MARIA_VOICES: MariaVoice[] = [
  { id: "filipino-female", label: "Filipino — Female (Deepgram Aura-2)", languageCode: "fil-PH", name: "aura-2-amalthea-en", gender: "FEMALE", provider: "deepgram" },
  { id: "us-female-hd", label: "English (US) — Female (Chirp 3: HD)", languageCode: "en-US", name: "en-US-Chirp3-HD-Aoede", gender: "FEMALE", provider: "google" },
  { id: "uk-female-hd", label: "English (UK) — Female (Chirp 3: HD)", languageCode: "en-GB", name: "en-GB-Chirp3-HD-Kore", gender: "FEMALE", provider: "google" },
  { id: "en-au-female-hd", label: "English (Australia) — Female (Chirp 3: HD)", languageCode: "en-AU", name: "en-AU-Chirp3-HD-Sadachbia", gender: "FEMALE", provider: "google" },
  { id: "en-in-female-hd", label: "English (India) — Female (Chirp 3: HD)", languageCode: "en-IN", name: "en-IN-Chirp3-HD-Iapetus", gender: "FEMALE", provider: "google" },
  { id: "us-female", label: "English (US) — Female (WaveNet)", languageCode: "en-US", name: "en-US-Neural2-F", gender: "FEMALE", provider: "google" },
  { id: "spanish-us-female", label: "Spanish (US) — Female (Neural2)", languageCode: "es-US", name: "es-US-Neural2-A", gender: "FEMALE", provider: "google" },
];

export function voiceById(id?: string) {
  return MARIA_VOICES.find((voice) => voice.id === id) || MARIA_VOICES[0];
}
