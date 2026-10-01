// PRIVACY: The learner's API key is NEVER stored, logged, or persisted.
// It arrives in the request body, is used once to call OpenRouter, and is
// discarded when this function returns. Do not add console.log of the key,
// the request body, or any headers, and do not send them to analytics.

import {
  MESSAGES,
  OPENROUTER_BASE,
  UPSTREAM_TIMEOUT_MS,
  messageForStatus,
  validateKeyFormat,
  type ModelInfo,
  type ModelsResponse,
} from "@/lib/openrouter";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

function json(body: ModelsResponse, status: number, headers?: HeadersInit) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

function fail(status: number, error: string = messageForStatus(status)) {
  return json({ ok: false, status, error }, status);
}

function price(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : NaN;
}

export async function POST(request: Request) {
  const limit = rateLimit(getClientIp(request));
  if (!limit.allowed) {
    return json({ ok: false, status: 429, error: MESSAGES.rateLimited }, 429, {
      "Retry-After": String(limit.retryAfter),
    });
  }

  let body: { key?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail(400, MESSAGES.emptyKey);
  }

  const formatError = validateKeyFormat(body?.key);
  if (formatError) return fail(400, formatError);
  const key = (body.key as string).trim();

  // /models/user returns the models this key can actually use, after the
  // account's provider preferences, privacy settings and guardrails.
  let upstream: Response;
  try {
    upstream = await fetch(`${OPENROUTER_BASE}/models/user`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    // Deliberately not logging the error: it must never carry the key.
    return fail(502, MESSAGES.upstreamUnreachable);
  }

  if (!upstream.ok) {
    // A missing list is not a missing model; keep the 401/402/429 messages.
    const status = upstream.status;
    return fail(status, status === 403 || status === 404 ? MESSAGES.generic : undefined);
  }

  const payload = await upstream.json().catch(() => null);
  if (!Array.isArray(payload?.data)) return fail(502, MESSAGES.generic);

  const models: ModelInfo[] = [];
  for (const m of payload.data) {
    if (typeof m?.id !== "string") continue;
    const outputs = m.architecture?.output_modalities;
    if (Array.isArray(outputs) && !outputs.includes("text")) continue;

    const promptPrice = price(m.pricing?.prompt);
    const completionPrice = price(m.pricing?.completion);
    // Routers such as openrouter/auto report -1 (variable price); skip them so
    // a test call always has a known, bounded cost.
    if (!(promptPrice >= 0) || !(completionPrice >= 0)) continue;

    models.push({
      id: m.id,
      name: typeof m.name === "string" ? m.name : m.id,
      promptPrice,
      completionPrice,
      contextLength:
        typeof m.context_length === "number" ? m.context_length : null,
    });
  }

  if (models.length === 0) return fail(502, MESSAGES.noModels);

  // Cheapest first, so learners naturally test with an inexpensive model.
  models.sort(
    (a, b) =>
      a.promptPrice + a.completionPrice - (b.promptPrice + b.completionPrice) ||
      a.name.localeCompare(b.name),
  );

  return json({ ok: true, models }, 200);
}
