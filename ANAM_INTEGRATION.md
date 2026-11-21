# Maria × Anam — live avatar voice integration

Replaces the current TTS chain (Google Chirp/Neural2 or Deepgram Aura-2 → MP3 → `<audio>` + idle loop video)
with an Anam persona that lip-syncs Maria's own answers.

## How it fits together

```
Visitor asks
   ↓
POST /api/chat            (unchanged: knowledge base → web search → answer + speech + citations)
   ↓
speak(speech)
   ↓
config.anamEnabled ?
   ├── yes → useAnamMaria.say(speech)
   │            ↓ POST /api/anam/session  → Anam session token (API key stays server-side)
   │            ↓ createClient(token).streamToVideoElement("maria-anam-video")
   │            ↓ client.talk(speech)     → avatar speaks our text
   └── no  → POST /api/tts → MP3 → <audio>   (existing behaviour, unchanged)
```

The Anam persona runs with **`llmId: "CUSTOMER_CLIENT_V1"`**, which disables Anam's own LLM.
`talk(text)` then makes the avatar speak whatever text we send, so Maria's knowledge base,
web search, citations and `voiceId` logic all stay exactly as they are.

## Files

| File | Purpose |
| --- | --- |
| `lib/anam.ts` | Server-only: `isAnamConfigured()`, `createAnamSessionToken()` |
| `app/api/anam/session/route.ts` | `POST` → `{ sessionToken }`, never exposes the API key |
| `hooks/use-anam-maria.ts` | Client hook: connect, `say(text)`, speaking state, teardown |
| `app/api/config/route.ts` | Adds `anamEnabled` to the public config |
| `app/page.tsx` | Renders the Anam `<video>`, prefers Anam in `speak()`, falls back to TTS |

## Environment variables

Set these on the deployment (Railway) — **never in the repository**.

| Variable | Required | Notes |
| --- | --- | --- |
| `ANAM_API_KEY` | yes | Server-only. Create at https://lab.anam.ai/api-keys |
| `ANAM_PERSONA_ID` | yes | ID of the Maria persona in Anam |

Anam is **optional by design**: if either variable is missing, `anamEnabled` is `false`
and the app keeps using the existing Google/Deepgram pipeline. No deployment breaks.

## Admin controls (dashboard at `/admin`)

The dashboard manages the Anam side of Maria. Values are stored with the rest of the config in Railway object storage:

| Setting | Field | Meaning |
| --- | --- | --- |
| Live avatar toggle | `anamEnabled` | Off forces the Google/Deepgram path even when Anam is fully configured |
| Anam persona | `anamPersonaId` | Blank means “use the deployment default `ANAM_PERSONA_ID`” |

New endpoint: **`GET /api/admin/anam`** (admin-authenticated)

- Lists the organization’s personas with name, avatar image, **voice model name/provider/country**.
- Fetches the selected persona in full, because the Anam list endpoint omits `llmId` — the dashboard needs it to warn when a persona is *not* `CUSTOMER_CLIENT_V1`.
- Degrades gracefully: a missing or rejected API key returns the error string instead of throwing, and the persona ID can still be pasted by hand.

`/api/config` reports `anamEnabled` as true only when **all three** hold: an API key exists, the admin toggle is on, and a persona resolves (admin value or env fallback). Anything less falls back to the premium TTS voice.

## Creating the Maria persona


The Maria persona already exists in **SPS ASEAN's Organization**:

| Setting | Value |
| --- | --- |
| Persona ID (`ANAM_PERSONA_ID`) | `7fa2225a-0fc2-464f-9468-175a13390d9a` |
| Name | Maria — Siruma |
| LLM | **`CUSTOMER_CLIENT_V1`** (Anam's brain disabled — required) |
| Avatar | `282aeb00-a69c-4e86-9620-4943f8313ebe` — built from `public/maria-cgi-approved.png` |
| Avatar model | `cara-4-latest` |
| Voice | `8cc80a30-4fc0-11f1-84b0-52bacf74fa75` — “Dana - Balanced Spirit” (Cartesia Sonic-3.6, US) |
| Language | `en` |
| Director notes | `presetStyle: "playful"`, `expressivity: 0.7`, dynamic cues on |
| Greeting | skipped — the app drives every utterance via `talk()` |

The custom avatar was generated from the live production asset
`https://maria-web-production.up.railway.app/maria-cgi-approved.png`, so it is the
same Maria face already used across the site.

> **Critical:** `llmId` must stay `CUSTOMER_CLIENT_V1`. Any other LLM re-enables
> Anam's own brain and will fight the text sent by `talk()`.

The persona's system prompt is unused while the LLM is disabled; Maria's actual prompt
lives in `lib/maria-store.ts` (`systemPrompt`) and is sent to `/api/chat` as before.


## Fallback behaviour

If the Anam session, connection or `talk()` fails, `speak()` logs the error, sets a
notice ("Live avatar unavailable — using the premium voice instead.") and continues into
the existing `/api/tts` path. Visitors always get audio.

## Rollback

Remove `ANAM_API_KEY` (or `ANAM_PERSONA_ID`) and redeploy. `anamEnabled` flips to `false`
and the page renders the previous idle video plus premium TTS again. No code changes needed.

## Cost and privacy notes

- Anam bills per session minute; a session stays open until the visitor's page unmounts
  or `stopStreaming()` runs. `useAnamMaria` disconnects on unmount.
- Anam's STT is not used in this mode (the visitor still types, or uses the browser
  `SpeechRecognition` already wired in `app/page.tsx`), so no visitor audio leaves the
  browser for transcription.
- The answer text *is* sent to Anam to be spoken, same as it was sent to Google/Deepgram before.
