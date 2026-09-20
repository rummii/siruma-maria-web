"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowLeft, Clock3, Send, Sparkles, Volume2 } from "lucide-react";
import Link from "next/link";
import { MariaFaceLab } from "@/components/maria-face-lab";
import { Button } from "@/components/ui/button";

const samples = [
  "Magandang araw! Ako si Maria, ang inyong tourism ambassador sa Siruma.",
  "Welcome to Siruma. I can help you discover beaches, islands, and outdoor adventures.",
  "Would you like me to prepare a relaxing day trip or an exciting paragliding experience?",
];

export default function AvatarLabPage() {
  const [text, setText] = useState(samples[0]);
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);
  const [error, setError] = useState("");
  const currentAudio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => {
    currentAudio.current?.pause();
    if (currentAudio.current?.src.startsWith("blob:")) URL.revokeObjectURL(currentAudio.current.src);
  }, []);

  async function speak(event?: FormEvent) {
    event?.preventDefault();
    const clean = text.trim();
    if (!clean || loading || speaking) return;

    currentAudio.current?.pause();
    setLoading(true);
    setError("");
    const started = performance.now();
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: clean }),
      });
      if (!response.ok) throw new Error("Google voice request failed");

      const url = URL.createObjectURL(await response.blob());
      const nextAudio = new Audio(url);
      currentAudio.current = nextAudio;
      setAudio(nextAudio);
      setLatency(Math.round(performance.now() - started));
      nextAudio.onplay = () => setSpeaking(true);
      nextAudio.onended = () => {
        setSpeaking(false);
        URL.revokeObjectURL(url);
      };
      nextAudio.onerror = () => {
        setSpeaking(false);
        setError("The generated voice could not be played.");
      };
      await nextAudio.play();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Voice generation failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#061d28] px-4 py-5 text-white sm:px-6 lg:px-10">
      <div className="mx-auto max-w-6xl">
        <header className="mb-5 flex items-center justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#e8c879]">
              <Sparkles size={14} /> Real-time avatar laboratory
            </div>
            <h1 className="font-serif text-3xl sm:text-4xl">Maria facial lip-sync proof</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/60">Google TTS plays immediately while the browser drives facial blendshapes. No generated video and no GPU job.</p>
          </div>
          <Link href="/" className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm text-white/75 transition hover:bg-white/10"><ArrowLeft size={16} /> Main site</Link>
        </header>

        <section className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
          <div className="min-h-[520px] rounded-[2rem] border border-white/10 bg-white/5 p-3 shadow-2xl shadow-black/25">
            <MariaFaceLab audio={audio} speaking={speaking} />
          </div>

          <div className="flex min-h-[520px] flex-col rounded-[2rem] bg-[#f6f1e8] p-5 text-[#102b34] sm:p-7">
            <div className="flex items-center justify-between border-b border-[#153743]/10 pb-5">
              <div><p className="font-serif text-2xl">Make the face speak</p><p className="mt-1 text-sm text-[#60777e]">Test speed before visual customization</p></div>
              <div className={`grid size-12 place-items-center rounded-full ${speaking ? "bg-[#d3a44b]" : "bg-[#0b3947] text-white"}`}><Volume2 /></div>
            </div>

            <div className="my-5 space-y-2">
              {samples.map((sample) => <button key={sample} disabled={loading || speaking} onClick={() => setText(sample)} className="w-full rounded-xl border border-[#0b3947]/10 bg-white px-4 py-3 text-left text-sm leading-relaxed transition hover:border-[#c99c48] disabled:opacity-50">{sample}</button>)}
            </div>

            <form onSubmit={speak} className="mt-auto">
              <textarea value={text} onChange={(event) => setText(event.target.value)} disabled={loading || speaking} rows={4} className="w-full resize-none rounded-2xl border border-[#0b3947]/15 bg-white p-4 text-[15px] leading-relaxed outline-none focus:border-[#c99c48] disabled:opacity-60" aria-label="Text for Maria to speak" />
              <Button type="submit" disabled={loading || speaking || !text.trim()} className="mt-3 h-12 w-full rounded-xl bg-[#c99c48] text-[#102b34] hover:bg-[#deb968] disabled:opacity-60">
                {loading ? "Generating Google voice…" : speaking ? "Maria is speaking…" : <><Send /> Speak now</>}
              </Button>
            </form>

            <div className="mt-4 min-h-6 text-center text-xs text-[#60777e]">
              {latency !== null && !error && <span className="inline-flex items-center gap-1.5"><Clock3 size={13} /> Voice ready in {(latency / 1000).toFixed(2)} seconds</span>}
              {error && <span className="text-rose-700">{error}</span>}
            </div>
            <p className="mt-3 text-center text-[11px] leading-relaxed text-[#71858a]">Prototype head: “Lisa” by skullvez, licensed CC BY 4.0. This asset proves browser facial animation; it is not Maria’s final appearance.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
