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
  type CheckKeyResponse,
} from "@/lib/openrouter";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

function json(body: CheckKeyResponse, status: number, headers?: HeadersInit) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
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
    return json({ ok: false, status: 400, error: MESSAGES.emptyKey }, 400);
  }

  const formatError = validateKeyFormat(body?.key);
  if (formatError) {
    return json({ ok: false, status: 400, error: formatError }, 400);
  }
  const key = (body.key as string).trim();

  let upstream: Response;
  try {
    upstream = await fetch(`${OPENROUTER_BASE}/key`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    // Deliberately not logging the error: it must never carry the key.
    return json(
      { ok: false, status: 502, error: MESSAGES.upstreamUnreachable },
      502,
    );
  }

  if (!upstream.ok) {
    return json(
      {
        ok: false,
        status: upstream.status,
        error: messageForStatus(upstream.status),
      },
      upstream.status,
    );
  }

  const payload = await upstream.json().catch(() => null);
  const data = payload?.data;
  if (!data || typeof data !== "object") {
    return json({ ok: false, status: 502, error: MESSAGES.generic }, 502);
  }

  // Only forward the fields the UI needs.
  return json(
    {
      ok: true,
      key: {
        label: str(data.label),
        usage: num(data.usage) ?? 0,
        usageDaily: num(data.usage_daily),
        usageWeekly: num(data.usage_weekly),
        usageMonthly: num(data.usage_monthly),
        limit: num(data.limit),
        limitRemaining: num(data.limit_remaining),
        limitReset: str(data.limit_reset),
        isFreeTier: typeof data.is_free_tier === "boolean" ? data.is_free_tier : null,
        expiresAt: str(data.expires_at),
      },
    },
    200,
  );
}
