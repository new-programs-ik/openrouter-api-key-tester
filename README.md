# OpenRouter Key Tester

A small Next.js (App Router, TypeScript, Tailwind) app for learners to check their own OpenRouter API key. They can:

1. **Check the key is valid.**
2. **See usage** in the left sidebar: a pie chart of credit used vs remaining, plus the credit limit, amount spent (USD), and spend for today / this week / this month. Usage loads automatically when a key is pasted.
3. **Run a test call**: clicking the button lists the models available to the key: chat, embedding and transcription (speech-to-text, e.g. Whisper) models, cheapest first, searchable and filterable by type. Picking one runs a test and shows the result and the cost of that call:
   - **Chat**: sends the prompt and shows the reply and token counts.
   - **Embeddings**: embeds the prompt and shows the vector size and its first few values.
   - **Transcription**: sends a bundled 4-second spoken clip (`public/sample-audio.wav`) and shows the transcript next to the expected text.

## Run locally

Requires Node.js 20.9 or newer.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

To check a production build:

```bash
npm run build
npm start
```

No environment variables or secrets are needed. The app has no key of its own.

## Deploy to Vercel

**From GitHub (recommended)**

1. Push this folder to a GitHub repository.
2. Go to <https://vercel.com/new> and import the repository.
3. Vercel detects Next.js automatically. Leave the build settings as they are, add no environment variables, and click **Deploy**.

**From the CLI**

```bash
npm i -g vercel
vercel          # preview deployment
vercel --prod   # production deployment
```

## How it works

| Route | What it does |
| --- | --- |
| `POST /api/check-key` | Calls `GET https://openrouter.ai/api/v1/key` with the learner's key and returns usage and limit fields. |
| `POST /api/models` | Calls `GET https://openrouter.ai/api/v1/models/user` with the learner's key and `output_modalities=text,embeddings,transcription` (OpenRouter returns only text models by default), and returns the models that key can use, with prices. |
| `POST /api/test-call` | Depending on the model type, calls `POST /chat/completions` (with `max_tokens: 50`), `POST /embeddings` or `POST /audio/transcriptions` (with the sample clip), and returns the result, token counts and cost. |

The browser calls these routes instead of OpenRouter directly, so learners don't hit CORS issues.

### Key handling

- The key is sent from the browser in the request body over HTTPS, used once to call OpenRouter, and discarded.
- It is never stored, logged or persisted: no database, no `console.log` of the key or headers, no analytics.
- In the browser the key lives only in React state. There is no `localStorage` or cookie, so refreshing the page clears it.

If you add logging or analytics later, make sure request bodies and headers for `/api/*` are excluded.

### Test call limits

- The model list comes from OpenRouter per key, so it reflects the account's provider, privacy and guardrail settings. Router models with variable pricing (such as `openrouter/auto`) are left out.
- Learners can pick any listed model, including expensive ones. Prompts are capped at 200 characters and replies at 50 tokens, so even the most expensive model currently listed costs about 3 cents per test call; typical cheap models cost a tiny fraction of a cent.
- Reasoning models may use all 50 tokens thinking and return an empty reply; the app says so when that happens.
- Transcription tests only ever send the bundled 4-second clip, never user audio, so their cost is bounded by that clip. OpenRouter doesn't say whether a transcription model's listed price is per second or per token, so the list shows "Billed by audio" and the test result shows the actual cost.

### Why there is no "total tokens used"

OpenRouter's `/api/v1/key` endpoint reports a key's usage in dollars only. The endpoints that report token totals (`/api/v1/activity` and the analytics API) require a management key, and `/api/v1/generation` only returns one generation at a time. So the app shows lifetime usage in dollars and token counts per test call.

## Rate limiting

All three API routes share a simple in-memory limit of 10 requests per minute per IP address (`lib/rate-limit.ts`).

**The limit is kept in memory, so it resets per serverless instance.** On Vercel each function instance has its own counter, and counters are lost when an instance is recycled. A determined user can therefore exceed 10 requests per minute. This is a basic guard against accidental hammering, not strong abuse protection. For a hard limit, use a shared store (for example Upstash Redis) or Vercel Firewall rate-limiting rules.

## Error messages

| Status | Message shown |
| --- | --- |
| 401 | Key is invalid or deleted. Check for typos or ask your instructor. |
| 402 | Credit limit reached. Contact your instructor to raise it. |
| 429 | Too many requests. Wait a minute and try again. |
| 400 | Bad request, possibly an invalid model. |
| 403 / 404 on a test call | This model isn't available for your key right now. Pick another one. |

Empty input, keys that don't start with `sk-or-`, and network failures also get their own messages.
