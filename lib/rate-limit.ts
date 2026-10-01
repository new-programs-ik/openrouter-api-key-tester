// Simple in-memory, per-IP fixed-window rate limiter.
// State lives in this module's memory, so it resets whenever a serverless
// instance is recycled and is not shared between instances (see README).

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 10;
const MAX_TRACKED_IPS = 5_000;

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

function prune(now: number) {
  for (const [ip, w] of windows) {
    if (w.resetAt <= now) windows.delete(ip);
  }
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export function rateLimit(ip: string): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  if (windows.size > MAX_TRACKED_IPS) prune(now);

  const current = windows.get(ip);
  if (!current || current.resetAt <= now) {
    windows.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfter: 0 };
  }

  current.count += 1;
  if (current.count > MAX_REQUESTS) {
    return {
      allowed: false,
      retryAfter: Math.ceil((current.resetAt - now) / 1000),
    };
  }
  return { allowed: true, retryAfter: 0 };
}
