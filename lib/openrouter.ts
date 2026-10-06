// Shared constants and helpers for the browser and the API routes.
// Nothing in this file stores or logs an API key.

export const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export const DEFAULT_PROMPT = "Say hello in 5 words";
export const MAX_PROMPT_LENGTH = 200;
export const MAX_TOKENS = 50;
export const UPSTREAM_TIMEOUT_MS = 30_000;

/** What a model does, which decides the endpoint a test call goes to. */
export type ModelKind = "chat" | "embedding" | "transcription";
export const MODEL_KINDS: readonly ModelKind[] = ["chat", "embedding", "transcription"];

export function isModelKind(value: unknown): value is ModelKind {
  return MODEL_KINDS.includes(value as ModelKind);
}

// Transcription test calls send this bundled clip (public/sample-audio.wav)
// instead of the prompt.
export const SAMPLE_AUDIO_URL = "/sample-audio.wav";
export const SAMPLE_AUDIO_TEXT = "Hello! This is a test of my OpenRouter key.";
export const SAMPLE_AUDIO_SECONDS = 4;

export const MESSAGES = {
  emptyKey: "Please paste your OpenRouter API key first.",
  badFormat:
    'That doesn\'t look like an OpenRouter key. It should start with "sk-or-".',
  emptyPrompt: "Please enter a prompt for the test call.",
  longPrompt: `Prompt is too long. Keep it under ${MAX_PROMPT_LENGTH} characters.`,
  unauthorized:
    "Key is invalid or deleted. Check for typos or ask your instructor.",
  noCredit: "Credit limit reached. Contact your instructor to raise it.",
  rateLimited: "Too many requests. Wait a minute and try again.",
  badRequest: "Bad request, possibly an invalid model.",
  modelUnavailable:
    "This model isn't available for your key right now. Pick another one.",
  noModels: "OpenRouter returned no models for this key.",
  network:
    "Network error. Check your internet connection and try again.",
  upstreamUnreachable:
    "Could not reach OpenRouter. Check your connection and try again in a moment.",
  generic: "Something went wrong on OpenRouter's side. Try again in a moment.",
} as const;

/** Returns an error message if the key is unusable, otherwise null. */
export function validateKeyFormat(key: unknown): string | null {
  if (typeof key !== "string" || key.trim() === "") return MESSAGES.emptyKey;
  const trimmed = key.trim();
  if (!trimmed.startsWith("sk-or-") || /\s/.test(trimmed) || trimmed.length > 200) {
    return MESSAGES.badFormat;
  }
  return null;
}

export function isValidModelId(model: unknown): model is string {
  return (
    typeof model === "string" &&
    model.length <= 120 &&
    /^[\w.:~-]+\/[\w.:~/-]+$/.test(model)
  );
}

export function messageForStatus(status: number): string {
  switch (status) {
    case 400:
      return MESSAGES.badRequest;
    case 401:
      return MESSAGES.unauthorized;
    case 402:
      return MESSAGES.noCredit;
    case 403:
    case 404:
      return MESSAGES.modelUnavailable;
    case 429:
      return MESSAGES.rateLimited;
    default:
      return MESSAGES.generic;
  }
}

export type ApiError = { ok: false; status: number; error: string };

export type KeyInfo = {
  label: string | null;
  usage: number;
  usageDaily: number | null;
  usageWeekly: number | null;
  usageMonthly: number | null;
  limit: number | null;
  limitRemaining: number | null;
  limitReset: string | null;
  isFreeTier: boolean | null;
  expiresAt: string | null;
};

export type CheckKeyResponse = { ok: true; key: KeyInfo } | ApiError;

export type TestCallResult = {
  kind: ModelKind;
  model: string;
  /** Chat reply or transcript; empty for embeddings. */
  reply: string;
  finishReason: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  cost: number | null;
  /** Embeddings only: vector length and its first few values. */
  dimensions: number | null;
  vectorPreview: number[] | null;
  /** Transcription only: audio length OpenRouter billed for. */
  audioSeconds: number | null;
};

export type TestCallResponse = { ok: true; result: TestCallResult } | ApiError;

export type ModelInfo = {
  id: string;
  kind: ModelKind;
  name: string;
  /** USD per token; multiply by 1,000,000 for the usual "per 1M" price. */
  promptPrice: number;
  completionPrice: number;
  contextLength: number | null;
};

export type ModelsResponse = { ok: true; models: ModelInfo[] } | ApiError;
