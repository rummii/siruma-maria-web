"use client";

import Script from "next/script";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

type Config = {
  welcomeMessage: string;
  fallbackMessage: string;
  systemPrompt: string;
  defaultVoice: string;
  defaultLanguage: string;
  avatarType: "video" | "image";
  responseMode: "text-and-voice" | "voice-only" | "text-only";
  suggestions: string[];
};

type Voice = { id: string; label: string; languageCode: string };
type Entry = { id: string; title: string; content: string; enabled: boolean };

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(options: { client_id: string; callback: (response: { credential: string }) => void }): void;
          renderButton(element: HTMLElement, options: Record<string, unknown>): void;
          disableAutoSelect(): void;
        };
      };
    };
  }
}

export default function AdminPage() {
  const [clientId, setClientId] = useState("");
  const [googleReady, setGoogleReady] = useState(false);
  const [token, setToken] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [config, setConfig] = useState<Config | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [knowledge, setKnowledge] = useState({ id: "", title: "", content: "", enabled: true });
  const [deleteId, setDeleteId] = useState("");
  const [status, setStatus] = useState("Sign in with an approved Google account.");
  const knowledgeForm = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);

  const api = useCallback(async (url: string, init: RequestInit = {}): Promise<any> => {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...(init.headers || {}),
      },
    });
    const data = await response.json() as Record<string, any>;
    if (!response.ok) throw new Error(String(data.error || "Request failed"));
    return data;
  }, [token]);

  const loadDashboard = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    try {
      const [settings, knowledgeData] = await Promise.all([
        api("/api/admin/config"),
        api("/api/admin/knowledge"),
      ]);
      setConfig(settings.config);
      setVoices(settings.voices);
      setAdminEmail(settings.admin.email);
      setEntries(knowledgeData.entries);
      setStatus("Dashboard loaded.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load dashboard");
      sessionStorage.removeItem("maria-admin-token");
      setToken("");
    } finally {
      setBusy(false);
    }
  }, [api, token]);

  useEffect(() => {
    const saved = sessionStorage.getItem("maria-admin-token") || "";
    if (saved) setToken(saved);
    fetch("/api/admin/auth-config")
      .then(async (response) => await response.json() as { clientId?: string })
      .then((data) => setClientId(data.clientId || ""))
      .catch(() => setStatus("Unable to load Google Sign-In configuration."));
  }, []);

  useEffect(() => {
    if (token) void loadDashboard();
  }, [token, loadDashboard]);

  useEffect(() => {
    if (googleReady && clientId && !token) initializeGoogle();
  }, [googleReady, clientId, token]);

  function initializeGoogle() {
    const target = document.getElementById("google-admin-signin");
    if (!clientId || !target || !window.google) {
      setStatus("Google Sign-In is not configured yet.");
      return;
    }
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: ({ credential }) => {
        sessionStorage.setItem("maria-admin-token", credential);
        setToken(credential);
      },
    });
    window.google.accounts.id.renderButton(target, {
      theme: "outline",
      size: "large",
      shape: "pill",
      text: "signin_with",
    });
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    if (!config) return;
    setBusy(true);
    try {
      const data = await api("/api/admin/config", {
        method: "PUT",
        body: JSON.stringify(config),
      });
      setConfig(data.config);
      setStatus("Maria’s settings were saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveKnowledge(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const saved = await api("/api/admin/knowledge", {
        method: "POST",
        body: JSON.stringify(knowledge),
      });
      if (saved.config) setConfig(saved.config);
      setKnowledge({ id: "", title: "", content: "", enabled: true });
      const data = await api("/api/admin/knowledge");
      setEntries(data.entries);
      setStatus(
        saved.suggestionRenamed
          ? "Knowledge entry and matching suggested question updated."
          : "Knowledge entry saved.",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Knowledge save failed");
    } finally {
      setBusy(false);
    }
  }

  function editKnowledge(entry: Entry) {
    setKnowledge(entry);
    setStatus(`Editing “${entry.title}”.`);
    window.requestAnimationFrame(() => {
      knowledgeForm.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      knowledgeForm.current?.querySelector<HTMLInputElement>("input")?.focus();
    });
  }

  async function removeKnowledge(id: string) {
    setBusy(true);
    try {
      await api(`/api/admin/knowledge?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      setEntries((current) => current.filter((entry) => entry.id !== id));
      if (knowledge.id === id) setKnowledge({ id: "", title: "", content: "", enabled: true });
      setDeleteId("");
      setStatus("Knowledge entry deleted.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function uploadAvatar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await api("/api/admin/avatar", { method: "POST", body: form });
      setStatus("Avatar uploaded. Refresh the public website to view it.");
      event.currentTarget.reset();
      await loadDashboard();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Avatar upload failed");
    } finally {
      setBusy(false);
    }
  }

  function signOut() {
    sessionStorage.removeItem("maria-admin-token");
    window.google?.accounts.id.disableAutoSelect();
    setToken("");
    setConfig(null);
    setAdminEmail("");
    setStatus("Signed out.");
  }

  return (
    <main className="min-h-screen bg-[#061d28] px-5 py-8 text-[#102b34]">
      <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={() => setGoogleReady(true)} />
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4 text-white">
          <div>
            <p className="text-xs uppercase tracking-[.3em] text-[#e1bf75]">Siruma Digital Tourism Center</p>
            <h1 className="mt-2 font-serif text-4xl">Maria Administration</h1>
          </div>
          {token && <button onClick={signOut} className="rounded-full border border-white/25 px-4 py-2 text-sm hover:bg-white/10">Sign out</button>}
        </header>

        {!token ? (
          <section className="rounded-3xl bg-[#f6f1e8] p-8 shadow-2xl">
            <h2 className="font-serif text-2xl">Administrator sign-in</h2>
            <p className="mt-2 max-w-xl text-[#536970]">Only Google accounts listed in the Cloud Run ADMIN_EMAILS setting can access this dashboard.</p>
            <div id="google-admin-signin" className="mt-6" />
            {!clientId && <p className="mt-4 text-sm text-rose-700">GOOGLE_CLIENT_ID is not configured on Cloud Run.</p>}
          </section>
        ) : config ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <form onSubmit={saveSettings} className="space-y-5 rounded-3xl bg-[#f6f1e8] p-6 shadow-xl">
              <div>
                <h2 className="font-serif text-2xl">Messages and behavior</h2>
                <p className="text-sm text-[#64777d]">Signed in as {adminEmail}</p>
              </div>
              <Label title="Welcome message">
                <textarea value={config.welcomeMessage} onChange={(event) => setConfig({ ...config, welcomeMessage: event.target.value })} rows={3} className="admin-input" />
              </Label>
              <Label title="Fallback message">
                <textarea value={config.fallbackMessage} onChange={(event) => setConfig({ ...config, fallbackMessage: event.target.value })} rows={3} className="admin-input" />
              </Label>
              <Label title="Maria’s system instructions">
                <textarea value={config.systemPrompt} onChange={(event) => setConfig({ ...config, systemPrompt: event.target.value })} rows={6} className="admin-input" />
              </Label>
              <div className="rounded-xl border border-[#0b3947]/15 bg-white p-4">
                <p className="text-sm font-semibold">Visitor question buttons</p>
                <p className="mt-1 text-sm text-[#64777d]">
                  Buttons are generated automatically from enabled knowledge-base titles. Add, rename,
                  disable, or delete a knowledge entry to update the visitor page.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Label title="Voice and accent">
                  <select value={config.defaultVoice} onChange={(event) => setConfig({ ...config, defaultVoice: event.target.value })} className="admin-input">
                    {voices.map((voice) => <option key={voice.id} value={voice.id}>{voice.label}</option>)}
                  </select>
                </Label>
                <Label title="Conversation language">
                  <select value={config.defaultLanguage} onChange={(event) => setConfig({ ...config, defaultLanguage: event.target.value })} className="admin-input">
                    <option value="en-PH">English — Philippines</option>
                    <option value="en-US">English — United States</option>
                    <option value="en-GB">English — United Kingdom</option>
                    <option value="fil-PH">Filipino</option>
                    <option value="es-US">Spanish — United States</option>
                  </select>
                </Label>
              </div>
              <Label title="Response output">
                <select
                  value={config.responseMode}
                  onChange={(event) => setConfig({ ...config, responseMode: event.target.value as Config["responseMode"] })}
                  className="admin-input"
                >
                  <option value="text-and-voice">Text and voice</option>
                  <option value="voice-only">Voice only — hide Maria’s answer text</option>
                  <option value="text-only">Text only — do not play speech</option>
                </select>
                <span className="mt-1 block text-xs text-[#64777d]">Controls how Maria delivers new answers to visitors.</span>
              </Label>
              <button disabled={busy} className="rounded-xl bg-[#c99c48] px-5 py-3 font-semibold disabled:opacity-50">Save settings</button>
            </form>

            <div className="space-y-6">
              <form onSubmit={uploadAvatar} className="rounded-3xl bg-[#f6f1e8] p-6 shadow-xl">
                <h2 className="font-serif text-2xl">Avatar</h2>
                <p className="mt-1 text-sm text-[#64777d]">Upload PNG, JPEG, WebP, MP4, or WebM up to 25 MB.</p>
                <input name="avatar" type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/webm" required className="mt-5 block w-full text-sm" />
                <button disabled={busy} className="mt-5 rounded-xl bg-[#0b3947] px-5 py-3 font-semibold text-white disabled:opacity-50">Upload avatar</button>
              </form>

              <form ref={knowledgeForm} onSubmit={saveKnowledge} className="scroll-mt-6 space-y-4 rounded-3xl bg-[#f6f1e8] p-6 shadow-xl">
                <h2 className="font-serif text-2xl">{knowledge.id ? "Edit knowledge" : "Add knowledge"}</h2>
                <Label title="Title">
                  <input value={knowledge.title} onChange={(event) => setKnowledge({ ...knowledge, title: event.target.value })} className="admin-input" required />
                </Label>
                <Label title="Information Maria may use">
                  <textarea value={knowledge.content} onChange={(event) => setKnowledge({ ...knowledge, content: event.target.value })} rows={7} className="admin-input" required />
                </Label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={knowledge.enabled} onChange={(event) => setKnowledge({ ...knowledge, enabled: event.target.checked })} /> Enabled</label>
                <div className="flex gap-3">
                  <button disabled={busy} className="rounded-xl bg-[#0b3947] px-5 py-3 font-semibold text-white disabled:opacity-50">{knowledge.id ? "Update knowledge" : "Save knowledge"}</button>
                  {knowledge.id && <button type="button" onClick={() => setKnowledge({ id: "", title: "", content: "", enabled: true })} className="rounded-xl border border-[#0b3947]/20 px-5 py-3 font-semibold">Cancel edit</button>}
                </div>
              </form>
            </div>

            <section className="rounded-3xl bg-[#f6f1e8] p-6 shadow-xl lg:col-span-2">
              <h2 className="font-serif text-2xl">Knowledge base</h2>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {entries.map((entry) => (
                  <article key={entry.id} className="rounded-2xl border border-[#0b3947]/15 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div><h3 className="font-semibold">{entry.title}</h3><p className="mt-1 text-xs text-[#64777d]">{entry.enabled ? "Enabled" : "Disabled"}</p></div>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => editKnowledge(entry)} className="rounded-lg px-2 py-1 text-sm font-semibold text-[#0b5268] hover:bg-[#0b5268]/10">Edit</button>
                        {deleteId === entry.id ? (
                          <>
                            <button type="button" disabled={busy} onClick={() => void removeKnowledge(entry.id)} className="rounded-lg bg-rose-700 px-2 py-1 text-sm font-semibold text-white disabled:opacity-50">Confirm</button>
                            <button type="button" onClick={() => setDeleteId("")} className="rounded-lg px-2 py-1 text-sm font-semibold text-[#64777d]">Cancel</button>
                          </>
                        ) : (
                          <button type="button" onClick={() => setDeleteId(entry.id)} className="rounded-lg px-2 py-1 text-sm font-semibold text-rose-700 hover:bg-rose-50">Delete</button>
                        )}
                      </div>
                    </div>
                    <p className="mt-3 line-clamp-4 whitespace-pre-wrap text-sm text-[#435a62]">{entry.content}</p>
                  </article>
                ))}
                {!entries.length && <p className="text-sm text-[#64777d]">No knowledge has been added yet.</p>}
              </div>
            </section>
          </div>
        ) : (
          <section className="rounded-3xl bg-[#f6f1e8] p-8">{busy ? "Loading dashboard…" : "Unable to load dashboard."}</section>
        )}

        <div role="status" aria-live="polite" className="fixed bottom-5 left-1/2 z-50 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-full bg-[#102b34] px-5 py-3 text-center text-sm text-white shadow-2xl">{status}</div>
        <div className="h-16" />
      </div>
      <style jsx global>{`
        .admin-input { width: 100%; border: 1px solid rgba(11,57,71,.2); border-radius: .75rem; background: white; padding: .75rem; outline: none; }
        .admin-input:focus { border-color: #c99c48; box-shadow: 0 0 0 3px rgba(201,156,72,.15); }
      `}</style>
    </main>
  );
}

function Label({ title, children }: { title: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-sm font-semibold">{title}</span>{children}</label>;
}
