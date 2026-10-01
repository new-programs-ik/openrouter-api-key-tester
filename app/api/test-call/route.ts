// PRIVACY: The learner's API key is NEVER stored, logged, or persisted.
// It arrives in the request body, is used once to call OpenRouter, and is
// discarded when this function returns. Do not add console.log of the key,
// the request body, or any headers, and do not send them to analytics.

import {
  MAX_PROMPT_LENGTH,
  MAX_TOKENS,
  MESSAGES,
  OPENROUTER_BASE,
  UPSTREAM_TIMEOUT_MS,
  isValidModelId,
  messageForStatus,
  validateKeyFormat,
  type TestCallResponse,
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

export async function POST(request: Request) {
  const limit = rateLimit(getClientIp(request));
  if (!limit.allowed) {
    return json({ ok: false, status: 429, error: MESSAGES.rateLimited }, 429, {
      "Retry-After": String(limit.retryAfter),
    });
  }

  let body: { key?: unknown; model?: unknown; prompt?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail(400, MESSAGES.emptyKey);
  }

  const formatError = validateKeyFormat(body?.key);
  if (formatError) return fail(400, formatError);
  const key = (body.key as string).trim();

  // The learner picks from the models list for their key (/api/models).
  // Cost stays bounded by the prompt length cap and max_tokens below.
  if (!isValidModelId(body.model)) return fail(400, MESSAGES.badRequest);
  const model = body.model;

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return fail(400, MESSAGES.emptyPrompt);
  if (prompt.length > MAX_PROMPT_LENGTH) return fail(400, MESSAGES.longPrompt);

  let upstream: Response;
  try {
    upstream = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Title": "OpenRouter Key Tester",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: MAX_TOKENS,
      }),
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

  const choice = payload?.choices?.[0];
  if (!choice) return fail(502, MESSAGES.generic);

  const content = choice.message?.content;
  const usage = payload.usage ?? {};

  return json(
    {
      ok: true,
      result: {
        model: typeof payload.model === "string" ? payload.model : model,
        reply: typeof content === "string" ? content : "",
        finishReason:
          typeof choice.finish_reason === "string" ? choice.finish_reason : null,
        promptTokens: num(usage.prompt_tokens),
        completionTokens: num(usage.completion_tokens),
        totalTokens: num(usage.total_tokens),
        cost: num(usage.cost),
      },
    },
    200,
  );
}
