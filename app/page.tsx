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
  responseMode: "text-and-voice" | "voice-only" | "text-only";
  suggestions: string[];
};

const DEFAULT_CONFIG: PublicConfig = {
  welcomeMessage: "Magandang araw! I’m Maria, your AI Tourism Ambassador. How may I help you discover Siruma today?",
  fallbackMessage: "I’m sorry, I don’t have enough information to answer that yet.",
  defaultVoice: "filipino-female",
  defaultLanguage: "en-PH",
  avatarUrl: "/maria-veo-idle.mp4",
  avatarType: "video",
  responseMode: "text-and-voice",
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
  const heroRef = useRef<HTMLElement>(null);
  const idleVideo = useRef<HTMLVideoElement>(null);
  const currentAudio = useRef<HTMLAudioElement | null>(null);
  const configRef = useRef(DEFAULT_CONFIG);

  useEffect(() => {
    let active = true;

    async function refreshConfig() {
      try {
        const response = await fetch(`/api/config?updated=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Configuration unavailable");
        const data = await response.json() as PublicConfig;
        if (!active) return;

        const previousWelcome = configRef.current.welcomeMessage;
        configRef.current = data;
        setConfig(data);
        setMessages((currentMessages) =>
          currentMessages.length === 1 &&
          currentMessages[0].role === "maria" &&
          currentMessages[0].text === previousWelcome
            ? [{ role: "maria", text: data.welcomeMessage }]
            : currentMessages,
        );
      } catch {
        // Keep the last working configuration during a temporary refresh failure.
      }
    }

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshConfig();
    };

    void refreshConfig();
    const interval = window.setInterval(() => void refreshConfig(), 5000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  useEffect(() => {
    const hero = heroRef.current;
    if (!hero || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    const updateParallax = () => {
      frame = 0;
      const offset = Math.min(window.scrollY * 0.18, 96);
      hero.style.setProperty("--parallax-y", `${offset}px`);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(updateParallax);
    };

    updateParallax();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
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
      if (config.responseMode !== "voice-only") {
        setMessages((current) => [...current, { role: "maria", text: answer }]);
      }
      if (config.responseMode !== "text-only") {
        window.setTimeout(() => speak(answer), 150);
      }
    } catch {
      if (config.responseMode !== "voice-only") {
        setMessages((current) => [...current, { role: "maria", text: config.fallbackMessage }]);
      }
      if (config.responseMode !== "text-only") {
        window.setTimeout(() => speak(config.fallbackMessage), 150);
      }
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
    <main className="travel-shell min-h-screen text-[#182d2a]">
      <header ref={heroRef} className="travel-hero">
        <img className="travel-hero-image" src="/siruma-rolling-hills.png" alt="" aria-hidden="true" />
        <div className="relative z-10 mx-auto max-w-7xl px-5 pb-16 pt-6 sm:px-8 lg:px-10 lg:pb-24">
          <nav className="flex items-center justify-between text-white">
            <div className="flex items-center gap-3">
              <div className="brand-mark grid size-10 place-items-center rounded-full border border-white/40 text-[#f4d38a]">
                <Compass size={22} />
              </div>
              <div>
                <p className="font-serif text-2xl leading-none">Siruma</p>
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.28em] text-white/70">Digital Tourism Center</p>
              </div>
            </div>
            <div className="hero-status flex items-center gap-2 text-xs font-semibold uppercase tracking-[.12em] text-white/90">
              <span className="size-2 rounded-full bg-emerald-300" /> Maria is ready
            </div>
          </nav>

          <div className="mt-20 max-w-3xl text-white sm:mt-24 lg:mt-28">
            <p className="hero-eyebrow mb-5 text-xs font-semibold uppercase tracking-[.24em] text-[#f4d38a]">Camarines Sur · Philippines</p>
            <h1 className="hero-title font-serif text-5xl leading-[.94] sm:text-6xl lg:text-7xl">Discover the quiet beauty of Siruma.</h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-white/82 sm:text-lg">
              Wild coastlines, rolling hills, and local adventures—made easier with Maria, your digital tourism guide.
            </p>
            <div className="mt-8 flex flex-wrap gap-2 text-sm">
              <span className="travel-pill">Coastal escapes</span>
              <span className="travel-pill">Nature adventures</span>
              <span className="travel-pill">Plan with Maria</span>
            </div>
          </div>
        </div>
      </header>

      <section className="travel-content relative z-20 mx-auto grid max-w-7xl items-start gap-6 px-5 py-10 sm:px-8 lg:grid-cols-[.8fr_1.2fr] lg:px-10 lg:py-14">
        <aside className="lg:sticky lg:top-6">
          <div className="maria-guide-card relative min-h-[570px] overflow-hidden rounded-[1.5rem] bg-[#193b38]">
            <div className="guide-label absolute left-5 top-5 z-20 inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold text-[#f4d38a]">
              <Sparkles size={14} /> Your local guide
            </div>
            <div className="maria-cgi-frame" aria-label="Maria, the Siruma AI Tourism Ambassador">
              {config.avatarType === "video" ? (
                <video key={config.avatarUrl} ref={idleVideo} className="maria-cgi-portrait maria-cgi-video" src={config.avatarUrl} poster="/maria-cgi-approved.png" autoPlay muted loop playsInline preload="auto" aria-hidden="true" />
              ) : (
                <img className="maria-cgi-portrait" src={config.avatarUrl} alt="Maria, the Siruma AI Tourism Ambassador" />
              )}
              <img className="maria-cgi-portrait maria-cgi-fallback" src="/maria-cgi-approved.png" alt="Maria, the Siruma AI Tourism Ambassador, wearing an embroidered cream Filipiniana" />
            </div>
            <div className="maria-guide-gradient absolute inset-x-0 bottom-0 z-10 px-6 pb-6 pt-28 text-white">
              <p className="text-xs font-semibold uppercase tracking-[.22em] text-[#f1ce81]">Meet your host</p>
              <h2 className="mt-1 font-serif text-4xl">Maria</h2>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-white/72">A warm, multilingual guide ready to help you discover Siruma’s places, stories, and experiences.</p>
              <div className="guide-status mt-5 flex items-center justify-between rounded-xl border border-white/12 p-3.5">
                <div className="flex items-center gap-3">
                  <div className={`grid size-10 place-items-center rounded-full ${speaking ? "bg-[#d8b56b] text-[#09232d]" : "bg-white/10 text-[#f2cf82]"}`}><Volume2 size={19} /></div>
                  <div><p className="text-sm font-semibold">AI Tourism Ambassador</p><p className="text-xs text-white/55">{speaking ? "Speaking now…" : thinking ? "Preparing an answer…" : "Online and ready"}</p></div>
                </div>
                <div className="hidden items-center gap-1.5 sm:flex">{[11,20,15,24,13].map((height, i) => <span key={i} className={`w-1 rounded-full bg-[#e4c477] ${speaking ? "wave" : ""}`} style={{height}} />)}</div>
              </div>
            </div>
          </div>
        </aside>

        <div className="travel-chat-card flex min-h-[650px] flex-col rounded-[1.5rem] border border-[#183c37]/10 bg-[#fffdf8] p-4 text-[#182d2a] sm:p-7">
          <div className="flex items-center justify-between border-b border-[#153743]/10 pb-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[.2em] text-[#a57424]">Plan your visit</p>
              <p className="mt-1 font-serif text-3xl">Ask Maria</p>
              <p className="mt-1 text-sm text-[#49636b]">Speak naturally or type a question</p>
            </div>
            <Button onClick={listen} size="icon-lg" aria-label={listening ? "Listening" : "Start voice input"} className={`rounded-full ${listening ? "bg-rose-600 hover:bg-rose-600" : "bg-[#214f49] hover:bg-[#183f3a]"}`}>{listening ? <MicOff /> : <Mic />}</Button>
          </div>
          <div ref={chatBox} className="scrollbar-thin my-5 min-h-[310px] flex-1 space-y-4 overflow-y-auto pr-1" aria-live="polite">{messages.map((message, index) => <div key={index} className={`flex ${message.role === "visitor" ? "justify-end" : "justify-start"}`}><div className={`max-w-[88%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed ${message.role === "visitor" ? "rounded-br-md bg-[#214f49] text-white" : "rounded-bl-md border border-[#153743]/10 bg-white text-[#263f47] shadow-sm"}`}>{message.text}</div></div>)}{thinking && <div className="text-sm text-[#64777d]">Maria is thinking…</div>}</div>
          {!!config.suggestions.length && <div className="mb-4"><p className="mb-2 text-xs font-semibold uppercase tracking-[.16em] text-[#77898d]">Popular questions</p><div className="flex gap-2 overflow-x-auto pb-1">{config.suggestions.map((suggestion) => <button key={suggestion} onClick={() => void ask(suggestion)} disabled={thinking} className="shrink-0 rounded-full border border-[#0b5960]/15 bg-[#f7f4ea] px-4 py-2.5 text-sm font-semibold text-[#24434d] transition hover:border-[#c49c4f] hover:bg-[#fff7df] disabled:opacity-50">{suggestion}</button>)}</div></div>}
          <form onSubmit={submit} className="flex items-center gap-2 rounded-2xl border border-[#0b5960]/15 bg-white p-2.5 shadow-sm focus-within:border-[#c49c4f] focus-within:ring-4 focus-within:ring-[#c49c4f]/10"><MapPin className="ml-2 shrink-0 text-[#b68732]" size={19} /><input value={input} onChange={(event) => setInput(event.target.value)} className="min-w-0 flex-1 bg-transparent px-1 py-2.5 text-base outline-none placeholder:text-[#71868c]" placeholder="Ask about Siruma…" aria-label="Question for Maria" /><Button type="submit" size="icon-lg" disabled={thinking} className="rounded-xl bg-[#d3a64d] text-[#182d2a] hover:bg-[#e1ba6a]" aria-label="Send question"><Send /></Button></form>
          <p className="mt-4 text-center text-xs text-[#6e8186]">Knowledge-grounded local guidance • Voice: {voiceName}</p>
        </div>
      </section>

      <footer className="border-t border-[#123d48]/10 bg-[#e9efe7] px-5 py-6 text-center text-sm text-[#536a68]">
        Siruma Digital Tourism Center · Camarines Sur, Philippines
      </footer>
    </main>
  );
}
