"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnamEvent, MessageRole, createClient } from "@anam-ai/js-sdk";

export type AnamStatus = "idle" | "connecting" | "ready" | "error";

type AnamClient = ReturnType<typeof createClient>;

/**
 * Streams the Maria Anam persona into a <video> element and lets the app push
 * its own answer text via talk(). Requires an active stream before talk().
 */
export function useAnamMaria(videoElementId: string) {
  const clientRef = useRef<AnamClient | null>(null);
  const [status, setStatus] = useState<AnamStatus>("idle");
  const [speaking, setSpeaking] = useState(false);

  const disconnect = useCallback(() => {
    const client = clientRef.current;
    clientRef.current = null;
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

  const connect = useCallback(async () => {
    if (clientRef.current) return clientRef.current;

    setStatus("connecting");
    try {
      const response = await fetch("/api/anam/session", { method: "POST", cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Anam session token request failed (${response.status})`);
      }

      const data = (await response.json()) as { sessionToken?: string };
      if (!data.sessionToken) throw new Error("Anam session token was missing");

      const client = createClient(data.sessionToken);

      // MESSAGE_HISTORY_UPDATED fires when a persona turn completes, which is the
      // only reliable "finished speaking" signal the SDK exposes.
      client.addListener(AnamEvent.MESSAGE_HISTORY_UPDATED, (messages) => {
        const last = messages[messages.length - 1];
        if (last && last.role === MessageRole.PERSONA) setSpeaking(false);
      });

      client.addListener(AnamEvent.CONNECTION_CLOSED, () => {
        clientRef.current = null;
        setStatus("idle");
        setSpeaking(false);
      });

      await client.streamToVideoElement(videoElementId);

      clientRef.current = client;
      setStatus("ready");
      return client;
    } catch (error) {
      console.error("Anam connection failed", error);
      setSpeaking(false);
      setStatus("error");
      throw error;
    }
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
