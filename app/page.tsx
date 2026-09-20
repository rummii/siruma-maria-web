"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Compass, MapPin, Mic, MicOff, Send, Sparkles, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Message = { role: "maria" | "visitor"; text: string };
type PublicConfig = {
  welcomeMessage: string;
  fallbackMessage: string;
  defaultVoice: string;
  defaultLanguage: string;
  avatarUrl: string;
  avatarType: "video" | "image";
  suggestions: string[];
};

const DEFAULT_CONFIG: PublicConfig = {
  welcomeMessage: "Magandang araw! I’m Maria, your AI Tourism Ambassador. How may I help you discover Siruma today?",
  fallbackMessage: "I’m sorry, I don’t have enough information to answer that yet.",
  defaultVoice: "filipino-female",
  defaultLanguage: "en-PH",
  avatarUrl: "/maria-veo-idle.mp4",
  avatarType: "video",
  suggestions: ["What can I do in Siruma?", "Tell me about paragliding", "Plan a day trip"],
};

export default function Home() {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [messages, setMessages] = useState<Message[]>([{ role: "maria", text: DEFAULT_CONFIG.welcomeMessage }]);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [voiceName, setVoiceName] = useState("Google Filipino female");
  const chatBox = useRef<HTMLDivElement>(null);
  const idleVideo = useRef<HTMLVideoElement>(null);
  const currentAudio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/config", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data: PublicConfig) => {
        if (!active) return;
        setConfig(data);
        setMessages((current) =>
          current.length === 1 && current[0].text === DEFAULT_CONFIG.welcomeMessage
            ? [{ role: "maria", text: data.welcomeMessage }]
            : current,
        );
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const panel = chatBox.current;
    if (!panel) return;
    const frame = window.requestAnimationFrame(() => {
      panel.scrollTo({ top: panel.scrollHeight, behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, thinking]);

  useEffect(() => {
    if (idleVideo.current) idleVideo.current.playbackRate = speaking ? 1 : 0.9;
  }, [speaking]);

  useEffect(() => () => {
    const audio = currentAudio.current;
    audio?.pause();
    if (audio?.src.startsWith("blob:")) URL.revokeObjectURL(audio.src);
  }, []);

  async function speak(text: string) {
    const previousAudio = currentAudio.current;
    if (previousAudio) {
      previousAudio.pause();
      if (previousAudio.src.startsWith("blob:")) URL.revokeObjectURL(previousAudio.src);
    }
    setSpeaking(false);

    let audioUrl = "";
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: config.defaultVoice }),
      });
      if (!response.ok) throw new Error("Voice request failed");

      audioUrl = URL.createObjectURL(await response.blob());
      const audio = new Audio(audioUrl);
      currentAudio.current = audio;
      setVoiceName(response.headers.get("X-Maria-Voice") || "Google Cloud voice");

      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        setSpeaking(false);
        URL.revokeObjectURL(audioUrl);
      };
      audio.onplay = () => setSpeaking(true);
      audio.onended = finish;
      audio.onerror = finish;
      await audio.play();
    } catch {
      setSpeaking(false);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    }
  }

  async function ask(text: string) {
    const clean = text.trim();
    if (!clean || thinking) return;
    setInput("");
    setMessages((current) => [...current, { role: "visitor", text: clean }]);
    setThinking(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: clean }),
      });
      const data = (await response.json()) as { answer?: string; error?: string };
      const answer = response.ok && data.answer ? data.answer : config.fallbackMessage;
      setMessages((current) => [...current, { role: "maria", text: answer }]);
      window.setTimeout(() => speak(answer), 150);
    } catch {
      setMessages((current) => [...current, { role: "maria", text: config.fallbackMessage }]);
    } finally {
      setThinking(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void ask(input);
  }

  function listen() {
    const speechWindow = window as unknown as { webkitSpeechRecognition?: new () => any; SpeechRecognition?: new () => any };
    const SpeechRecognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMessages((current) => [...current, { role: "maria", text: "Voice input is not available in this browser yet. You can type your question below." }]);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = config.defaultLanguage;
    recognition.interimResults = false;
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognition.onresult = (event: any) => void ask(event.results[0][0].transcript);
    recognition.start();
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#061d28] text-white">
      <div className="ambient" aria-hidden="true" />
      <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-5 py-5 lg:px-10">
        <div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-full border border-[#d8b56b]/50 bg-[#d8b56b]/10 text-[#f2cf82]"><Compass size={21} /></div><div><p className="font-serif text-lg leading-none">Siruma</p><p className="mt-1 text-xs uppercase tracking-[0.24em] text-white/55">Digital Tourism Center</p></div></div>
        <div className="hidden items-center gap-2 text-sm text-white/65 sm:flex"><span className="size-2 rounded-full bg-emerald-400" /> Maria is ready</div>
      </header>

      <section className="relative z-10 mx-auto grid min-h-[calc(100vh-80px)] max-w-7xl items-stretch gap-6 px-5 pb-5 lg:grid-cols-[1.05fr_.95fr] lg:px-10 lg:pb-10">
        <div className="relative min-h-[520px] overflow-hidden rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_50%_25%,#174c5c_0%,#0a2c38_45%,#061c26_100%)]">
          <div className="absolute left-6 top-6 z-10 max-w-xs lg:left-9 lg:top-9"><div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#e2c27e]/25 bg-black/20 px-3 py-1.5 text-xs font-medium text-[#f5d994] backdrop-blur"><Sparkles size={14} /> Your local guide</div><h1 className="font-serif text-4xl leading-[1.02] sm:text-5xl lg:text-6xl">Meet Maria.</h1><p className="mt-3 max-w-[27rem] text-base leading-relaxed text-white/68">A warm, multilingual digital ambassador designed to welcome visitors and bring Siruma’s stories to life.</p></div>
          <div className="maria-cgi-frame" aria-label="Maria, the Siruma AI Tourism Ambassador">
            {config.avatarType === "video" ? (
              <video key={config.avatarUrl} ref={idleVideo} className="maria-cgi-portrait maria-cgi-video" src={config.avatarUrl} poster="/maria-cgi-approved.png" autoPlay muted loop playsInline preload="auto" aria-hidden="true" />
            ) : (
              <img className="maria-cgi-portrait" src={config.avatarUrl} alt="Maria, the Siruma AI Tourism Ambassador" />
            )}
            <img className="maria-cgi-portrait maria-cgi-fallback" src="/maria-cgi-approved.png" alt="Maria, the Siruma AI Tourism Ambassador, wearing an embroidered cream Filipiniana" />
          </div>
          <div className="absolute bottom-5 left-5 right-5 flex items-center justify-between rounded-2xl border border-white/10 bg-[#061921]/75 p-3.5 backdrop-blur-xl lg:left-8 lg:right-8"><div className="flex items-center gap-3"><div className={`grid size-10 place-items-center rounded-full ${speaking ? "bg-[#d8b56b] text-[#09232d]" : "bg-white/10 text-[#f2cf82]"}`}><Volume2 size={19} /></div><div><p className="text-sm font-semibold">Maria</p><p className="text-xs text-white/55">{speaking ? "Speaking now…" : thinking ? "Preparing an answer…" : "AI Tourism Ambassador"}</p></div></div><div className="hidden items-center gap-1.5 sm:flex">{[11,20,15,24,13].map((height, i) => <span key={i} className={`w-1 rounded-full bg-[#e4c477] ${speaking ? "wave" : ""}`} style={{height}} />)}</div></div>
        </div>

        <div className="flex min-h-[520px] flex-col rounded-[2rem] bg-[#f6f1e8] p-4 text-[#102b34] shadow-2xl shadow-black/20 sm:p-6">
          <div className="flex items-center justify-between border-b border-[#153743]/10 pb-4"><div><p className="font-serif text-2xl">Ask Maria</p><p className="text-sm text-[#49636b]">Speak naturally or type a question</p></div><Button onClick={listen} size="icon-lg" aria-label={listening ? "Listening" : "Start voice input"} className={`rounded-full ${listening ? "bg-rose-600 hover:bg-rose-600" : "bg-[#0b3947] hover:bg-[#125064]"}`}>{listening ? <MicOff /> : <Mic />}</Button></div>
          <div ref={chatBox} className="scrollbar-thin my-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1" aria-live="polite">{messages.map((message, index) => <div key={index} className={`flex ${message.role === "visitor" ? "justify-end" : "justify-start"}`}><div className={`max-w-[88%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed ${message.role === "visitor" ? "rounded-br-md bg-[#0b3947] text-white" : "rounded-bl-md border border-[#153743]/10 bg-white text-[#263f47] shadow-sm"}`}>{message.text}</div></div>)}{thinking && <div className="text-sm text-[#64777d]">Maria is thinking…</div>}</div>
          <div className="mb-3 flex gap-2 overflow-x-auto pb-1">{config.suggestions.map((suggestion) => <button key={suggestion} onClick={() => void ask(suggestion)} disabled={thinking} className="shrink-0 rounded-full border border-[#0b3947]/15 bg-white px-3 py-2 text-sm font-medium text-[#24434d] transition hover:border-[#c49c4f] hover:bg-[#fffaf0] disabled:opacity-50">{suggestion}</button>)}</div>
          <form onSubmit={submit} className="flex items-center gap-2 rounded-2xl border border-[#0b3947]/15 bg-white p-2 shadow-sm focus-within:border-[#c49c4f] focus-within:ring-4 focus-within:ring-[#c49c4f]/10"><MapPin className="ml-2 shrink-0 text-[#b68732]" size={19} /><input value={input} onChange={(event) => setInput(event.target.value)} className="min-w-0 flex-1 bg-transparent px-1 py-2.5 text-base outline-none placeholder:text-[#71868c]" placeholder="Ask about Siruma…" aria-label="Question for Maria" /><Button type="submit" size="icon-lg" disabled={thinking} className="rounded-xl bg-[#c99c48] text-[#102b34] hover:bg-[#deb968]" aria-label="Send question"><Send /></Button></form>
          <p className="mt-3 text-center text-xs text-[#6e8186]">Knowledge-grounded assistant • Voice: {voiceName}</p>
        </div>
      </section>
    </main>
  );
}
