# Maria Admin Backend — Railway Setup

This document describes how the live deployment actually works. An earlier version of this file described a Google Cloud / Firestore / Vertex AI stack that the application does not use.

## What the app runs on

- **Hosting:** Railway, Next.js App Router (`app/`).
- **Content storage:** a Railway S3-compatible bucket, accessed through `lib/railway-storage.ts` with AWS Signature V4. Config and knowledge entries are JSON objects (`maria/config.json`, `maria/knowledge.json`). Avatar uploads go to the same bucket and are streamed back through `/api/avatar`, so the bucket stays private.
- **Answering model:** DeepSeek, OpenAI-compatible chat completions at `https://api.deepseek.com/chat/completions`. Tool calling and JSON mode are both used.
- **Web search (optional):** Tavily, behind the provider abstraction in `lib/web-search.ts`.
- **Speech:** Google Cloud Text-to-Speech via `GOOGLE_TTS_API_KEY`, plus Deepgram Aura-2 through `/api/tts`.

## Required environment variables

Core:

- `DEEPSEEK_API_KEY` — enables Maria's reasoning. Without it the API returns the best local knowledge-base match instead of an error.
- `GOOGLE_CLIENT_ID` — OAuth client used both by the admin sign-in button and by server-side ID-token audience validation.
- `ADMIN_EMAILS` — comma-separated allowlist of administrator emails.

Storage:

- `RAILWAY_S3_ENDPOINT`, `RAILWAY_S3_BUCKET`
- `RAILWAY_S3_ACCESS_KEY_ID`, `RAILWAY_S3_SECRET_ACCESS_KEY`
- `RAILWAY_S3_REGION` (defaults to `sin`; `auto` is accepted)
- `RAILWAY_S3_URL_STYLE` (`path` or `virtual-host`, defaults to `path`)

Optional:

- `DEEPSEEK_MODEL` — defaults to `deepseek-flash`.
- `TAVILY_API_KEY` — enables Tier 2 web answers. Leave unset to run knowledge-base-only; the `search_web` tool simply reports that web search is unavailable.
- `TAVILY_SEARCH_DEPTH` — `basic` (default) or `advanced`. Advanced costs roughly twice as much per search.
- `GOOGLE_TTS_API_KEY`, `VERTEX_AI_REGION` — speech synthesis.
- `DEEPGRAM_API_KEY` — the Filipino Aura-2 voice.


## Admin dashboard

Open `/admin` and sign in with an approved Google account. The dashboard controls:

- Welcome and fallback messages, plus Maria's system instructions.
- Conversation language, voice and accent, and the text/voice response mode.
- Conversation memory: how many previous exchanges are sent back to the model.
- Off-topic handling: the configured fallback message, or a brief redirect with topic suggestions.
- Web search: on/off, and how many results each search may return (1 to 8).
- Avatar upload and the knowledge-base entries, including their enabled state.

Visitor question buttons are generated from enabled knowledge-base titles; there is no separate list to maintain.

## How Maria decides what to answer

Answers are layered, and a higher tier always wins over a lower one.

1. **Siruma facts.** Places, activities, operators, prices, fees, schedules, boat departures, policies, contacts, and safety rules come from the enabled knowledge-base entries. If a figure is not there, Maria says it is unconfirmed and points to the tourism office. The model may translate the entry but not change it.
2. **Travel logistics.** Routes, terminals, transfers, distances, and travel times that the knowledge base does not cover are answered with the `search_web` tool (Tavily). The reply names the source and flags information that may be outdated.
3. **General guidance.** Harmless travel advice is answered from general knowledge behind a short disclosure such as "this is general travel advice, not official Siruma information".
4. **Fallback and redirect.** Off-topic requests are declined politely with two suggestions drawn from the knowledge base.

Mechanics worth knowing:

- `POST /api/chat` accepts `{ question, history }`. History is a list of `{ role: "visitor" | "maria", text }` turns; the server keeps only the last N exchanges, caps each turn at 1000 characters, and caps the whole history at 6000 characters.
- A confident knowledge-base match answers in a single JSON-mode call. Otherwise Maria may call `search_knowledge` and `search_web` (at most 3 tool calls over 2 rounds) and then composes the final JSON answer.
- Every response has the shape `{ answer, speech, source, citations, followUps, voiceId }`. `answer` is the readable reply, `speech` is a citation-free version for text-to-speech, and `citations` only ever contains URLs that a real `search_web` call returned. A web answer with no surviving citation is downgraded to `general`.
- Web searches are cached for 10 minutes per query and limited to a global hourly budget of 60 searches per process. Chat itself is limited to 20 messages per 10 minutes per IP. Both counters are in-memory, so with multiple replicas each replica enforces its own budget.
- If DeepSeek is unreachable or returns unusable JSON after one retry, the endpoint degrades to the best local knowledge-base match rather than returning a 5xx. If `TAVILY_API_KEY` is unset, Maria simply answers without web search.

## Troubleshooting

- **Every answer is the fallback message:** check `DEEPSEEK_API_KEY`, then confirm at least one knowledge entry is enabled.
- **Answers never cite the web:** check `TAVILY_API_KEY`, confirm web search is enabled in the dashboard, and check the Railway logs for Tavily or budget messages.
- **410/500 on admin save:** the S3 credentials or bucket name are wrong; `lib/railway-storage.ts` throws a descriptive error.
- **Admin sign-in fails:** `GOOGLE_CLIENT_ID` must match the OAuth client whose origin is the deployed URL, and the signed-in email must appear in `ADMIN_EMAILS`.

