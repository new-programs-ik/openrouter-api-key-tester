// PRIVACY: The learner's API key is NEVER stored, logged, or persisted.
// It arrives in the request body, is used once to call OpenRouter, and is
// discarded when this function returns. Do not add console.log of the key,
// the request body, or any headers, and do not send them to analytics.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  MAX_PROMPT_LENGTH,
  MAX_TOKENS,
  MESSAGES,
  OPENROUTER_BASE,
  UPSTREAM_TIMEOUT_MS,
  isModelKind,
  isValidModelId,
  messageForStatus,
  validateKeyFormat,
  type ModelKind,
  type TestCallResponse,
  type TestCallResult,
} from "@/lib/openrouter";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

function json(body: TestCallResponse, status: number, headers?: HeadersInit) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function fail(status: number, error: string = messageForStatus(status)) {
  return json({ ok: false, status, error }, status);
}

// Read once per instance. Only this fixed clip is ever sent, so the cost of a
// transcription test stays bounded by its length.
let sampleAudio: Promise<string> | null = null;
function loadSampleAudio(): Promise<string> {
  sampleAudio ??= readFile(join(process.cwd(), "public", "sample-audio.wav")).then((buf) =>
    buf.toString("base64"),
  );
  return sampleAudio;
}

type UpstreamRequest = { path: string; body: Record<string, unknown> };

async function buildRequest(
  kind: ModelKind,
  model: string,
  prompt: string,
): Promise<UpstreamRequest> {
  switch (kind) {
    case "chat":
      return {
        path: "/chat/completions",
        body: {
          model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: MAX_TOKENS,
        },
      };
    case "embedding":
      return { path: "/embeddings", body: { model, input: prompt } };
    case "transcription":
      return {
        path: "/audio/transcriptions",
        body: {
          model,
          input_audio: { data: await loadSampleAudio(), format: "wav" },
          language: "en",
        },
      };
  }
}

const VECTOR_PREVIEW_LENGTH = 6;

/** Turns an upstream success payload into a result, or null if it's malformed. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseResult(kind: ModelKind, model: string, payload: any): TestCallResult | null {
  const usage = payload?.usage ?? {};
  const base = {
    kind,
    model: typeof payload?.model === "string" ? payload.model : model,
    reply: "",
    finishReason: null,
    promptTokens: num(usage.prompt_tokens),
    completionTokens: num(usage.completion_tokens),
    totalTokens: num(usage.total_tokens),
    cost: num(usage.cost),
    dimensions: null,
    vectorPreview: null,
    audioSeconds: null,
  };

  switch (kind) {
    case "chat": {
      const choice = payload?.choices?.[0];
      if (!choice) return null;
      const content = choice.message?.content;
      return {
        ...base,
        reply: typeof content === "string" ? content : "",
        finishReason:
          typeof choice.finish_reason === "string" ? choice.finish_reason : null,
      };
    }
    case "embedding": {
      const vector = payload?.data?.[0]?.embedding;
      // Base64 vectors only come back when asked for, and this route never asks.
      if (!Array.isArray(vector)) return null;
      return {
        ...base,
        dimensions: vector.length,
        vectorPreview: vector
          .slice(0, VECTOR_PREVIEW_LENGTH)
          .filter((v): v is number => typeof v === "number"),
      };
    }
    case "transcription": {
      if (typeof payload?.text !== "string") return null;
      return {
        ...base,
        reply: payload.text,
        promptTokens: num(usage.input_tokens),
        completionTokens: num(usage.output_tokens),
        audioSeconds: num(usage.seconds),
      };
    }
  }
}

export async function POST(request: Request) {
  const limit = rateLimit(getClientIp(request));
  if (!limit.allowed) {
    return json({ ok: false, status: 429, error: MESSAGES.rateLimited }, 429, {
      "Retry-After": String(limit.retryAfter),
    });
  }

  let body: { key?: unknown; model?: unknown; kind?: unknown; prompt?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail(400, MESSAGES.emptyKey);
  }

  const formatError = validateKeyFormat(body?.key);
  if (formatError) return fail(400, formatError);
  const key = (body.key as string).trim();

  // The learner picks from the models list for their key (/api/models).
  // Cost stays bounded by the prompt length cap, max_tokens and the fixed
  // sample clip below.
  if (!isValidModelId(body.model)) return fail(400, MESSAGES.badRequest);
  const model = body.model;
  if (body.kind !== undefined && !isModelKind(body.kind)) {
    return fail(400, MESSAGES.badRequest);
  }
  const kind: ModelKind = isModelKind(body.kind) ? body.kind : "chat";

  // Transcription tests use the sample clip, so they don't need a prompt.
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (kind !== "transcription") {
    if (!prompt) return fail(400, MESSAGES.emptyPrompt);
    if (prompt.length > MAX_PROMPT_LENGTH) return fail(400, MESSAGES.longPrompt);
  }

  let upstream: Response;
  try {
    const { path, body: upstreamBody } = await buildRequest(kind, model, prompt);
    upstream = await fetch(`${OPENROUTER_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Title": "OpenRouter Key Tester",
      },
      body: JSON.stringify(upstreamBody),
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    // Deliberately not logging the error: it must never carry the key.
    return fail(502, MESSAGES.upstreamUnreachable);
  }

  if (!upstream.ok) return fail(upstream.status);

  const payload = await upstream.json().catch(() => null);

  // OpenRouter can report a provider error inside a 200 response.
  if (payload?.error) {
    const code = num(payload.error.code);
    return fail(code && code >= 400 && code < 600 ? code : 502);
  }

  const result = parseResult(kind, model, payload);
  if (!result) return fail(502, MESSAGES.generic);

  return json({ ok: true, result }, 200);
}
