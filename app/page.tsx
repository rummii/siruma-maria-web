"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Compass, MapPin, Mic, MicOff, Send, Sparkles, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Message = { role: "maria" | "visitor"; text: string };
const suggestions = ["What can I do in Siruma?", "Tell me about paragliding", "Plan a day trip"];

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

function answerFor(question: string) {
  const q = question.toLowerCase();
  if (q.includes("paraglid") || q.includes("fly")) return "Siruma’s coastal landscapes make paragliding an exciting part of the adventure story. For a real trip, I’ll connect you with certified operators and confirm weather and site conditions first.";
  if (q.includes("day") || q.includes("itinerary") || q.includes("plan")) return "Here’s a relaxed day: begin with a coastal viewpoint, enjoy a local lunch, spend the afternoon exploring the shore, then finish at sunset. Tell me your interests and I can personalize it.";
  if (q.includes("beach") || q.includes("island")) return "Siruma invites visitors to slow down and enjoy its coast, islands, and open scenery. I can help shape an island-hopping or beach-focused visit for families, friends, or adventure groups.";
  if (q.includes("hello") || q.includes("hi") || q.includes("magandang")) return "Magandang araw! I’m happy to welcome you. Ask me about places to explore, adventure activities, or a sample itinerary.";
  return "Siruma is a beautiful destination for nature, coastal experiences, and outdoor adventure. For this showcase, ask me about paragliding, beaches, island experiences, or planning a day trip.";
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([{ role: "maria", text: "Magandang araw! I’m Maria, your AI Tourism Ambassador. How may I help you discover Siruma today?" }]);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [blinking, setBlinking] = useState(false);
  const [voiceName, setVoiceName] = useState("Google Filipino female");
  const chatBox = useRef<HTMLDivElement>(null);
  const avatarFrame = useRef<HTMLDivElement>(null);
  const idleVideo = useRef<HTMLVideoElement>(null);
  const currentAudio = useRef<HTMLAudioElement | null>(null);
  const stopLipSync = useRef<(() => void) | null>(null);

  useEffect(() => {
    const panel = chatBox.current;
    if (!panel) return;
    const frame = window.requestAnimationFrame(() => {
      panel.scrollTo({ top: panel.scrollHeight, behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages]);

  useEffect(() => {
    let blinkTimer = 0;
    let resetTimer = 0;

    const scheduleBlink = () => {
      blinkTimer = window.setTimeout(() => {
        setBlinking(true);
        resetTimer = window.setTimeout(() => {
          setBlinking(false);
          scheduleBlink();
        }, 135);
      }, 3800 + Math.random() * 4200);
    };

    scheduleBlink();
    return () => {
      window.clearTimeout(blinkTimer);
      window.clearTimeout(resetTimer);
    };
  }, []);

  useEffect(() => {
    if (idleVideo.current) idleVideo.current.playbackRate = speaking ? 0.52 : 0.68;
  }, [speaking]);

  useEffect(() => () => {
    currentAudio.current?.pause();
    stopLipSync.current?.();
  }, []);

  async function beginLipSync(audio: HTMLAudioElement) {
    const context = new AudioContext();
    const source = context.createMediaElementSource(audio);
    const analyser = context.createAnalyser();

    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.62;
    const waveform = new Uint8Array(analyser.fftSize);
    source.connect(analyser);
    analyser.connect(context.destination);

    let animationFrame = 0;
    let smoothedLevel = 0;
    let stopped = false;

    const updateMouth = () => {
      analyser.getByteTimeDomainData(waveform);
      let energy = 0;
      for (const sample of waveform) {
        const normalized = (sample - 128) / 128;
        energy += normalized * normalized;
      }

      const rms = Math.sqrt(energy / waveform.length);
      const target = clamp((rms - 0.018) * 8.5, 0, 0.72);
      smoothedLevel += (target - smoothedLevel) * (target > smoothedLevel ? 0.48 : 0.2);
      avatarFrame.current?.style.setProperty("--speech-level", smoothedLevel.toFixed(3));
      animationFrame = window.requestAnimationFrame(updateMouth);
    };

    await context.resume();
    updateMouth();

    return () => {
      if (stopped) return;
      stopped = true;
      window.cancelAnimationFrame(animationFrame);
      avatarFrame.current?.style.setProperty("--speech-level", "0");
      source.disconnect();
      analyser.disconnect();
      void context.close();
    };
  }

  async function speak(text: string) {
    const previousAudio = currentAudio.current;
    if (previousAudio) {
      previousAudio.pause();
      if (previousAudio.src.startsWith("blob:")) URL.revokeObjectURL(previousAudio.src);
    }
    stopLipSync.current?.();
    stopLipSync.current = null;
    setSpeaking(false);

    let audioUrl = "";
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) throw new Error("Voice request failed");

      audioUrl = URL.createObjectURL(await response.blob());
      const audio = new Audio(audioUrl);
      currentAudio.current = audio;
      setVoiceName(response.headers.get("X-Maria-Voice") || "Google Filipino female");

      stopLipSync.current = await beginLipSync(audio);
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        setSpeaking(false);
        stopLipSync.current?.();
        stopLipSync.current = null;
        URL.revokeObjectURL(audioUrl);
      };

      audio.onplay = () => setSpeaking(true);
      audio.onended = finish;
      audio.onerror = finish;
      await audio.play();
    } catch {
      setSpeaking(false);
      stopLipSync.current?.();
      stopLipSync.current = null;
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setMessages((current) => [...current, { role: "maria", text: "My Google voice is temporarily unavailable. Please try again in a moment." }]);
    }
  }

  function ask(text: string) {
    const clean = text.trim();
    if (!clean) return;
    const response = answerFor(clean);
    setMessages((current) => [...current, { role: "visitor", text: clean }, { role: "maria", text: response }]);
    setInput("");
    window.setTimeout(() => speak(response), 220);
  }

  function submit(event: FormEvent) { event.preventDefault(); ask(input); }

  function listen() {
    const speechWindow = window as unknown as { webkitSpeechRecognition?: new () => any; SpeechRecognition?: new () => any };
    const SpeechRecognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMessages((current) => [...current, { role: "maria", text: "Voice input is not available in this browser yet. You can type your question below." }]);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "en-PH";
    recognition.interimResults = false;
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognition.onresult = (event: any) => ask(event.results[0][0].transcript);
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
          <div className="absolute left-6 top-6 z-10 max-w-xs lg:left-9 lg:top-9"><div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#e2c27e]/25 bg-black/20 px-3 py-1.5 text-xs font-medium text-[#f5d994] backdrop-blur"><Sparkles size={14} /> Your local guide</div><h1 className="font-serif text-4xl leading-[1.02] sm:text-5xl lg:text-6xl">Meet Maria.</h1><p className="mt-3 max-w-[27rem] text-base leading-relaxed text-white/68">A warm, bilingual digital ambassador designed to welcome visitors and bring Siruma’s stories to life.</p></div>
          <div
            ref={avatarFrame}
            className={`maria-cgi-frame ${speaking ? "maria-is-speaking" : ""} ${blinking ? "maria-is-blinking" : ""}`}
            aria-label="Maria, the Siruma AI Tourism Ambassador"
          >
            <video
              ref={idleVideo}
              className="maria-cgi-portrait maria-cgi-video"
              src="/maria-veo-idle.mp4"
              poster="/maria-cgi-approved.png"
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
              aria-hidden="true"
            />
            <img className="maria-cgi-portrait maria-mouth-layer" src="/maria-talk.png" alt="" aria-hidden="true" />
            <img className="maria-cgi-portrait maria-blink-layer" src="/maria-blink.png" alt="" aria-hidden="true" />
            <img className="maria-cgi-portrait maria-cgi-fallback" src="/maria-cgi-approved.png" alt="Maria, the Siruma AI Tourism Ambassador, wearing an embroidered cream Filipiniana" />
          </div>
          <div className="absolute bottom-5 left-5 right-5 flex items-center justify-between rounded-2xl border border-white/10 bg-[#061921]/75 p-3.5 backdrop-blur-xl lg:left-8 lg:right-8"><div className="flex items-center gap-3"><div className={`grid size-10 place-items-center rounded-full ${speaking ? "bg-[#d8b56b] text-[#09232d]" : "bg-white/10 text-[#f2cf82]"}`}><Volume2 size={19} /></div><div><p className="text-sm font-semibold">Maria</p><p className="text-xs text-white/55">{speaking ? "Speaking now…" : "AI Tourism Ambassador"}</p></div></div><div className="hidden items-center gap-1.5 sm:flex">{[11,20,15,24,13].map((height, i) => <span key={i} className={`w-1 rounded-full bg-[#e4c477] ${speaking ? "wave" : ""}`} style={{height}} />)}</div></div>
        </div>

        <div className="flex min-h-[520px] flex-col rounded-[2rem] bg-[#f6f1e8] p-4 text-[#102b34] shadow-2xl shadow-black/20 sm:p-6">
          <div className="flex items-center justify-between border-b border-[#153743]/10 pb-4"><div><p className="font-serif text-2xl">Ask Maria</p><p className="text-sm text-[#49636b]">Speak naturally or type a question</p></div><Button onClick={listen} size="icon-lg" aria-label={listening ? "Listening" : "Start voice input"} className={`rounded-full ${listening ? "bg-rose-600 hover:bg-rose-600" : "bg-[#0b3947] hover:bg-[#125064]"}`}>{listening ? <MicOff /> : <Mic />}</Button></div>
          <div ref={chatBox} className="scrollbar-thin my-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1" aria-live="polite">{messages.map((message, index) => <div key={index} className={`flex ${message.role === "visitor" ? "justify-end" : "justify-start"}`}><div className={`max-w-[88%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed ${message.role === "visitor" ? "rounded-br-md bg-[#0b3947] text-white" : "rounded-bl-md border border-[#153743]/10 bg-white text-[#263f47] shadow-sm"}`}>{message.text}</div></div>)}</div>
          <div className="mb-3 flex gap-2 overflow-x-auto pb-1">{suggestions.map((suggestion) => <button key={suggestion} onClick={() => ask(suggestion)} className="shrink-0 rounded-full border border-[#0b3947]/15 bg-white px-3 py-2 text-sm font-medium text-[#24434d] transition hover:border-[#c49c4f] hover:bg-[#fffaf0]">{suggestion}</button>)}</div>
          <form onSubmit={submit} className="flex items-center gap-2 rounded-2xl border border-[#0b3947]/15 bg-white p-2 shadow-sm focus-within:border-[#c49c4f] focus-within:ring-4 focus-within:ring-[#c49c4f]/10"><MapPin className="ml-2 shrink-0 text-[#b68732]" size={19} /><input value={input} onChange={(event) => setInput(event.target.value)} className="min-w-0 flex-1 bg-transparent px-1 py-2.5 text-base outline-none placeholder:text-[#71868c]" placeholder="Ask about Siruma…" aria-label="Question for Maria" /><Button type="submit" size="icon-lg" className="rounded-xl bg-[#c99c48] text-[#102b34] hover:bg-[#deb968]" aria-label="Send question"><Send /></Button></form>
          <p className="mt-3 text-center text-xs text-[#6e8186]">Interactive showcase • Voice: {voiceName}</p>
        </div>
      </section>
    </main>
  );
}
