"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AnamClient, Message } from "@anam-ai/js-sdk";

export type AnamStatus = "idle" | "connecting" | "ready" | "error";

/** How long to wait for SESSION_READY before giving up on a connection attempt. */
const SESSION_READY_TIMEOUT_MS = 20_000;

/**
 * The SDK is loaded in the browser only, on first use.
 * A static import pulls it into the server/SSR build graph and stalls `next build`.
 */
let sdkPromise: Promise<typeof import("@anam-ai/js-sdk")> | null = null;
function loadAnamSdk() {
  if (!sdkPromise) sdkPromise = import("@anam-ai/js-sdk");
  return sdkPromise;
}

/**
 * Streams the Maria Anam persona into a <video> element and lets the app push
 * its own answer text via talk(). Requires an active stream before talk().
 */
export function useAnamMaria(videoElementId: string) {
  const clientRef = useRef<AnamClient | null>(null);
  const connectPromiseRef = useRef<Promise<AnamClient> | null>(null);
  const [status, setStatus] = useState<AnamStatus>("idle");
  const [speaking, setSpeaking] = useState(false);

  const disconnect = useCallback(() => {
    const client = clientRef.current;
    clientRef.current = null;
    connectPromiseRef.current = null;
    setStatus("idle");
    setSpeaking(false);
    if (client) {
      try {
        client.stopStreaming();
      } catch {
        // Stopping an already-closed stream is not an error worth surfacing.
      }
    }
  }, []);

  const connect = useCallback(() => {
    if (clientRef.current) return Promise.resolve(clientRef.current);
    if (connectPromiseRef.current) return connectPromiseRef.current;

    const run = (async () => {
      setStatus("connecting");
      try {
        const response = await fetch("/api/anam/session", { method: "POST", cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Anam session token request failed (${response.status})`);
        }

        const data = (await response.json()) as { sessionToken?: string };
        if (!data.sessionToken) throw new Error("Anam session token was missing");

        const { createClient, AnamEvent, MessageRole } = await loadAnamSdk();
        const client = createClient(data.sessionToken);

        let resolveReady!: () => void;
        let rejectReady!: (error: Error) => void;
        const sessionReady = new Promise<void>((resolve, reject) => {
          resolveReady = resolve;
          rejectReady = reject;
        });
        // Readiness can settle after the race below has already finished.
        void sessionReady.catch(() => undefined);

        client.addListener(AnamEvent.SESSION_READY, () => resolveReady());

        // MESSAGE_HISTORY_UPDATED fires when a persona turn completes, which is the
        // only reliable "finished speaking" signal the SDK exposes.
        client.addListener(AnamEvent.MESSAGE_HISTORY_UPDATED, (messages: Message[]) => {
          const last = messages[messages.length - 1];
          if (last && last.role === MessageRole.PERSONA) setSpeaking(false);
        });

        client.addListener(AnamEvent.CONNECTION_CLOSED, () => {
          rejectReady(new Error("Anam connection closed before the session was ready"));
          clientRef.current = null;
          connectPromiseRef.current = null;
          setStatus("idle");
          setSpeaking(false);
        });

        await client.streamToVideoElement(videoElementId);

        // talk() is rejected until SESSION_READY fires. Waiting here is what stops the
        // first visitor question from falling back to the premium TTS voice.
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            sessionReady,
            new Promise<never>((_, reject) => {
              timeout = setTimeout(
                () => reject(new Error("Timed out waiting for the Anam session to become ready")),
                SESSION_READY_TIMEOUT_MS,
              );
            }),
          ]);
        } finally {
          if (timeout) clearTimeout(timeout);
        }

        clientRef.current = client;
        setStatus("ready");
        return client;
      } catch (error) {
        console.error("Anam connection failed", error);
        setSpeaking(false);
        setStatus("error");
        throw error;
      } finally {
        connectPromiseRef.current = null;
      }
    })();

    connectPromiseRef.current = run;
    return run;
  }, [videoElementId]);

  /** Speaks the given text with the avatar. Connects first if needed. */
  const say = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean) return;
      const client = await connect();
      setSpeaking(true);
      try {
        await client.talk(clean);
      } catch (error) {
        setSpeaking(false);
        throw error;
      }
    },
    [connect],
  );

  useEffect(() => () => disconnect(), [disconnect]);

  return {
    status,
    speaking,
    isReady: status === "ready",
    connect,
    say,
    disconnect,
  };
}

