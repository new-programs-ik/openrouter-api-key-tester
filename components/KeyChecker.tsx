"use client";

import { useState } from "react";
import {
  DEFAULT_PROMPT,
  MAX_PROMPT_LENGTH,
  MAX_TOKENS,
  MESSAGES,
  MODEL_KINDS,
  SAMPLE_AUDIO_SECONDS,
  SAMPLE_AUDIO_TEXT,
  SAMPLE_AUDIO_URL,
  validateKeyFormat,
  type ApiError,
  type CheckKeyResponse,
  type KeyInfo,
  type ModelInfo,
  type ModelKind,
  type ModelsResponse,
  type TestCallResponse,
  type TestCallResult,
} from "@/lib/openrouter";

type Status = { valid: boolean; message: string };
type Action = "check" | "models" | "test";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

// Single calls cost fractions of a cent, so show significant digits instead.
function formatCallCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost >= 0.01) return usd.format(cost);
  return `$${new Intl.NumberFormat("en-US", {
    maximumSignificantDigits: 3,
    maximumFractionDigits: 12,
    useGrouping: false,
  }).format(cost)}`;
}

// Model prices are quoted per 1M tokens.
function formatPerMillion(pricePerToken: number): string {
  const perMillion = pricePerToken * 1_000_000;
  return `$${perMillion.toLocaleString("en-US", {
    maximumFractionDigits: perMillion < 1 ? 3 : 2,
  })}`;
}

const KIND_LABELS: Record<ModelKind, string> = {
  chat: "Chat",
  embedding: "Embeddings",
  transcription: "Transcription",
};

function modelPrice(m: ModelInfo): string {
  if (m.promptPrice === 0 && m.completionPrice === 0) return "Free";
  switch (m.kind) {
    case "chat":
      return `${formatPerMillion(m.promptPrice)} / ${formatPerMillion(m.completionPrice)}`;
    case "embedding":
      return `${formatPerMillion(m.promptPrice)} input`;
    case "transcription":
      // OpenRouter doesn't say whether this is per second or per token, so
      // don't guess; the test call reports the real cost.
      return "Billed by audio";
  }
}

function count(value: number | null): string {
  return value === null ? "n/a" : value.toLocaleString("en-US");
}

// The key travels only in this POST body to our own API route, which forwards
// it to OpenRouter. It is kept in React state only: no localStorage, no cookies.
async function postJson<T>(url: string, body: unknown): Promise<T | ApiError> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    return (await res.json()) as T;
  } catch {
    return { ok: false, status: 0, error: MESSAGES.network };
  }
}

export default function KeyChecker() {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);

  const [busy, setBusy] = useState<Action | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [keyInfo, setKeyInfo] = useState<KeyInfo | null>(null);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [testingModel, setTestingModel] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestCallResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  // Everything on screen belongs to one key, so a different key starts clean.
  function handleKeyChange(value: string) {
    setApiKey(value);
    setInputError(null);
    setStatus(null);
    setKeyInfo(null);
    setModels(null);
    setTestResult(null);
    setTestError(null);
  }

  function checkInput(key: string): boolean {
    const error = validateKeyFormat(key);
    setInputError(error);
    return error === null;
  }

  function applyKeyResponse(res: CheckKeyResponse | ApiError) {
    if (res.ok) {
      setStatus({ valid: true, message: "Key is valid." });
      setKeyInfo(res.key);
    } else {
      setStatus({ valid: false, message: res.error });
      setKeyInfo(null);
    }
  }

  async function checkUsage(key: string = apiKey) {
    if (!checkInput(key)) return;
    setBusy("check");
    const res = await postJson<CheckKeyResponse>("/api/check-key", {
      key: key.trim(),
    });
    setBusy(null);
    applyKeyResponse(res);
  }

  // Pasting a complete key checks it straight away.
  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text").trim();
    if (busy !== null || validateKeyFormat(pasted) !== null) return;
    e.preventDefault();
    handleKeyChange(pasted);
    checkUsage(pasted);
  }

  // "Run Test Call" first shows the models this key can use; picking one runs it.
  async function showModels() {
    if (!checkInput(apiKey)) return;
    setBusy("models");
    setTestError(null);
    const key = apiKey.trim();
    const [modelsRes, keyRes] = await Promise.all([
      postJson<ModelsResponse>("/api/models", { key }),
      keyInfo ? null : postJson<CheckKeyResponse>("/api/check-key", { key }),
    ]);
    setBusy(null);

    if (keyRes) applyKeyResponse(keyRes);
    if (modelsRes.ok) {
      setModels(modelsRes.models);
    } else {
      setModels(null);
      setTestResult(null);
      setTestError(modelsRes.error);
      if (modelsRes.status === 401) {
        setStatus({ valid: false, message: modelsRes.error });
        setKeyInfo(null);
      }
    }
  }

  async function runTestCall({ id: model, kind }: ModelInfo) {
    if (!checkInput(apiKey)) return;
    if (kind !== "transcription" && !prompt.trim()) {
      setTestResult(null);
      setTestError(MESSAGES.emptyPrompt);
      return;
    }
    setBusy("test");
    setTestingModel(model);
    const res = await postJson<TestCallResponse>("/api/test-call", {
      key: apiKey.trim(),
      model,
      kind,
      prompt: prompt.trim(),
    });
    setBusy(null);
    setTestingModel(null);

    if (res.ok) {
      setStatus({ valid: true, message: "Key is valid. Test call succeeded." });
      setTestResult(res.result);
      setTestError(null);
    } else {
      setTestResult(null);
      setTestError(res.error);
      if (res.status === 401) {
        setStatus({ valid: false, message: res.error });
        setKeyInfo(null);
      }
    }
  }

  const disabled = busy !== null;

  return (
    <div className="flex flex-col gap-5">
      <section className={card}>
        <label htmlFor="api-key" className={labelClass}>
          OpenRouter API key
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="api-key"
            name="openrouter-key-not-saved"
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => handleKeyChange(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !disabled) checkUsage();
            }}
            placeholder="sk-or-v1-..."
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            aria-invalid={inputError !== null}
            aria-describedby={inputError ? "api-key-error" : undefined}
            className={`${inputClass} min-w-0 flex-1 font-mono`}
          />
          <button
            type="button"
            onClick={() => setShowKey((s) => !s)}
            aria-pressed={showKey}
            className="shrink-0 rounded-md border border-line-strong px-3 text-sm font-medium text-muted hover:bg-soft"
          >
            {showKey ? "Hide" : "Show"}
          </button>
        </div>
        {inputError && (
          <p id="api-key-error" role="alert" className="mt-2 text-sm text-red-600">
            {inputError}
          </p>
        )}

        <div className="mt-5">
          <label htmlFor="prompt" className={labelClass}>
            Test prompt
          </label>
          <input
            id="prompt"
            type="text"
            value={prompt}
            maxLength={MAX_PROMPT_LENGTH}
            onChange={(e) => setPrompt(e.target.value)}
            className={`${inputClass} mt-2 w-full`}
          />
          <p className="mt-1 text-right text-xs text-subtle">
            {prompt.length}/{MAX_PROMPT_LENGTH}
          </p>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => checkUsage()}
            disabled={disabled}
            className="rounded-md bg-linear-to-r from-brand-strong to-brand-mid px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy === "check" ? "Checking…" : "Check Key"}
          </button>
          <button
            type="button"
            onClick={showModels}
            disabled={disabled}
            className="rounded-md bg-brand-tint px-4 py-2.5 text-sm font-semibold text-brand-strong hover:bg-brand-tint-strong disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy === "models" ? "Loading models…" : "Run Test Call"}
          </button>
        </div>
        <p className="mt-3 text-xs text-subtle">
          Run Test Call lists the models available to your key. Pick one to send
          the prompt. Replies are capped at {MAX_TOKENS} tokens to keep the cost
          tiny. Embedding models embed the prompt; transcription models
          transcribe a {SAMPLE_AUDIO_SECONDS}-second sample clip.
        </p>
      </section>

      <div aria-live="polite" className="flex min-w-0 flex-col gap-5">
        {status && <StatusCard status={status} label={keyInfo?.label ?? null} />}
        {(testResult || testError) && (
          <TestCallCard result={testResult} error={testError} />
        )}
        {models && (
          <ModelsCard
            models={models}
            disabled={disabled}
            testingModel={testingModel}
            onPick={runTestCall}
          />
        )}
      </div>
    </div>
  );
}

function StatusCard({ status, label }: { status: Status; label: string | null }) {
  const tone = status.valid
    ? "border-emerald-300 bg-emerald-50 text-emerald-900"
    : "border-red-300 bg-red-50 text-red-900";
  return (
    <section className={`rounded-xl border p-4 sm:p-5 ${tone}`}>
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={`h-2.5 w-2.5 rounded-full ${status.valid ? "bg-emerald-500" : "bg-red-500"}`}
        />
        <h2 className="text-sm font-semibold uppercase tracking-wide">
          {status.valid ? "Valid" : "Invalid"}
        </h2>
      </div>
      <p className="mt-2 text-sm">{status.message}</p>
      {status.valid && label && (
        <p className="mt-1 break-all font-mono text-xs opacity-80">{label}</p>
      )}
    </section>
  );
}

function ModelsCard({
  models,
  disabled,
  testingModel,
  onPick,
}: {
  models: ModelInfo[];
  disabled: boolean;
  testingModel: string | null;
  onPick: (model: ModelInfo) => void;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<ModelKind | "all">("all");
  const q = query.trim().toLowerCase();
  const visible = models.filter(
    (m) =>
      (kind === "all" || m.kind === kind) &&
      (!q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)),
  );
  const tabs: { value: ModelKind | "all"; label: string; count: number }[] = [
    { value: "all", label: "All", count: models.length },
    ...MODEL_KINDS.map((k) => ({
      value: k,
      label: KIND_LABELS[k],
      count: models.filter((m) => m.kind === k).length,
    })).filter((t) => t.count > 0),
  ];

  return (
    <section className={card}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={heading}>Available models</h2>
        <p className="text-xs text-subtle">
          {visible.length === models.length
            ? `${models.length} models, cheapest first`
            : `${visible.length} of ${models.length} models`}
        </p>
      </div>
      <p className="mt-1 text-sm text-muted">
        Pick a model to run the test. Chat prices are per 1M tokens (input /
        output); embedding prices are per 1M input tokens.
      </p>

      {tabs.length > 2 && (
        <div role="group" aria-label="Filter by model type" className="mt-3 flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button
              key={t.value}
              type="button"
              aria-pressed={kind === t.value}
              onClick={() => setKind(t.value)}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                kind === t.value
                  ? "border-brand bg-brand-tint text-brand-strong"
                  : "border-line-strong text-muted hover:bg-soft"
              }`}
            >
              {t.label} <span className="tabular-nums opacity-70">{t.count}</span>
            </button>
          ))}
        </div>
      )}

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search models, e.g. gpt-4o-mini"
        aria-label="Search models"
        className={`${inputClass} mt-3 w-full`}
      />

      {visible.length === 0 ? (
        <p className="mt-4 text-sm text-subtle">No models match that search.</p>
      ) : (
        <ul className="mt-3 max-h-96 divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {visible.map((m) => {
            return (
              <li key={m.id}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onPick(m)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-soft disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{m.name}</span>
                      {m.kind !== "chat" && (
                        <span className="shrink-0 rounded bg-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                          {KIND_LABELS[m.kind]}
                        </span>
                      )}
                    </span>
                    <span className="block truncate font-mono text-xs text-subtle">
                      {m.id}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-xs tabular-nums text-muted">
                    {testingModel === m.id
                      ? "Calling…"
                      : modelPrice(m)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function TestCallCard({
  result,
  error,
}: {
  result: TestCallResult | null;
  error: string | null;
}) {
  return (
    <section className={card}>
      <h2 className={heading}>Test call</h2>

      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {error}
        </p>
      )}

      {result && (
        <>
          <p className="mt-1 break-all font-mono text-xs text-subtle">{result.model}</p>
          {result.kind === "chat" && <ChatResult result={result} />}
          {result.kind === "embedding" && <EmbeddingResult result={result} />}
          {result.kind === "transcription" && <TranscriptionResult result={result} />}
        </>
      )}
    </section>
  );
}

function ChatResult({ result }: { result: TestCallResult }) {
  return (
    <>
      <blockquote className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-soft p-3 text-sm">
        {result.reply || (
          <span className="italic text-subtle">
            The model returned an empty reply. Reasoning models can spend the
            whole {MAX_TOKENS}-token test limit thinking; try another model.
          </span>
        )}
      </blockquote>
      {result.reply && result.finishReason === "length" && (
        <p className="mt-2 text-xs text-subtle">
          Reply was cut off at the {MAX_TOKENS}-token test limit.
        </p>
      )}
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Prompt tokens" value={count(result.promptTokens)} />
        <Stat label="Completion tokens" value={count(result.completionTokens)} />
        <Stat label="Total tokens" value={count(result.totalTokens)} />
        <CostStat cost={result.cost} />
      </dl>
    </>
  );
}

function EmbeddingResult({ result }: { result: TestCallResult }) {
  const preview = result.vectorPreview ?? [];
  const more = result.dimensions !== null && result.dimensions > preview.length;
  return (
    <>
      <p className="mt-3 text-sm">
        Your prompt was turned into a vector of{" "}
        <span className="font-semibold">{count(result.dimensions)}</span> numbers.
        The first few:
      </p>
      <pre className="mt-2 overflow-x-auto rounded-lg bg-soft p-3 font-mono text-xs">
        [{preview.map((v) => v.toFixed(5)).join(", ")}
        {more ? ", …" : ""}]
      </pre>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Input tokens" value={count(result.promptTokens ?? result.totalTokens)} />
        <Stat label="Dimensions" value={count(result.dimensions)} />
        <CostStat cost={result.cost} />
      </dl>
    </>
  );
}

function TranscriptionResult({ result }: { result: TestCallResult }) {
  return (
    <>
      <div className="mt-3 rounded-lg border border-line p-3">
        <p className="text-xs text-subtle">Sample clip sent</p>
        <audio controls preload="none" src={SAMPLE_AUDIO_URL} className="mt-2 w-full" />
        <p className="mt-2 text-xs text-subtle">
          It says: &ldquo;{SAMPLE_AUDIO_TEXT}&rdquo;
        </p>
      </div>
      <p className="mt-3 text-xs text-subtle">Transcript</p>
      <blockquote className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-soft p-3 text-sm">
        {result.reply || (
          <span className="italic text-subtle">The model returned an empty transcript.</span>
        )}
      </blockquote>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat
          label="Audio billed"
          value={result.audioSeconds === null ? "n/a" : `${result.audioSeconds} s`}
        />
        <Stat label="Total tokens" value={count(result.totalTokens)} />
        <CostStat cost={result.cost} />
      </dl>
    </>
  );
}

function CostStat({ cost }: { cost: number | null }) {
  return <Stat label="Cost of call" value={cost === null ? "n/a" : formatCallCost(cost)} />;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line p-3">
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className="mt-1 break-words text-base font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

const card =
  "rounded-xl border border-line bg-white p-4 shadow-card sm:p-6";
const heading = "font-heading text-lg font-semibold text-ink";
const labelClass = "block text-sm font-medium text-ink";
const inputClass =
  "rounded-lg border border-line-strong bg-white px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand-tint-strong";
