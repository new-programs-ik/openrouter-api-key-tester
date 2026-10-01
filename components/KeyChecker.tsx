"use client";

import { useState } from "react";
import {
  DEFAULT_PROMPT,
  MAX_PROMPT_LENGTH,
  MAX_TOKENS,
  MESSAGES,
  validateKeyFormat,
  type ApiError,
  type CheckKeyResponse,
  type KeyInfo,
  type ModelInfo,
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

  // Pasting a complete key loads its usage straight away.
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

  async function runTestCall(model: string) {
    if (!checkInput(apiKey)) return;
    if (!prompt.trim()) {
      setTestResult(null);
      setTestError(MESSAGES.emptyPrompt);
      return;
    }
    setBusy("test");
    setTestingModel(model);
    const res = await postJson<TestCallResponse>("/api/test-call", {
      key: apiKey.trim(),
      model,
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
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[20rem_minmax(0,1fr)] lg:grid-rows-[auto_1fr]">
      <section className={`${card} lg:col-start-2 lg:row-start-1`}>
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
            {busy === "check" ? "Checking…" : "Check Usage"}
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
          tiny.
        </p>
      </section>

      <aside className="lg:sticky lg:top-6 lg:col-start-1 lg:row-span-2 lg:row-start-1">
        <UsageSidebar info={keyInfo} loading={busy === "check" || (busy === "models" && !keyInfo)} />
      </aside>

      <div
        aria-live="polite"
        className="flex min-w-0 flex-col gap-5 lg:col-start-2 lg:row-start-2"
      >
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

// Pie geometry: a thick ring drawn with stroke dashes on a 100x100 viewBox.
const PIE_RADIUS = 32;
const PIE_CIRCUMFERENCE = 2 * Math.PI * PIE_RADIUS;
const PIE_GAP = 1.5;

function UsagePie({
  fraction,
  centerTop,
  centerBottom,
  usedLabel,
  remainingLabel,
}: {
  /** Share of the limit used, 0..1, or null when there is nothing to split. */
  fraction: number | null;
  centerTop: string;
  centerBottom: string;
  usedLabel?: string;
  remainingLabel?: string;
}) {
  const used = (fraction ?? 0) * PIE_CIRCUMFERENCE;
  const gap = fraction !== null && fraction > 0 && fraction < 1 ? PIE_GAP : 0;
  const ring = {
    cx: 50,
    cy: 50,
    r: PIE_RADIUS,
    fill: "none",
    strokeWidth: 22,
  };

  return (
    <svg
      viewBox="0 0 100 100"
      role="img"
      aria-label={
        fraction === null
          ? `Usage pie chart: ${centerTop} ${centerBottom}`
          : `Usage pie chart: ${usedLabel}, ${remainingLabel}`
      }
      className="mx-auto h-44 w-44"
    >
      <g transform="rotate(-90 50 50)">
        {fraction === null ? (
          <circle {...ring} className="stroke-brand-tint-strong" />
        ) : (
          <>
            <circle
              {...ring}
              className="stroke-brand-tint-strong"
              strokeDasharray={`${Math.max(0, PIE_CIRCUMFERENCE - used - gap)} ${PIE_CIRCUMFERENCE}`}
              strokeDashoffset={-used}
            >
              <title>{remainingLabel}</title>
            </circle>
            <circle
              {...ring}
              className="stroke-brand"
              strokeDasharray={`${Math.max(0, used - gap)} ${PIE_CIRCUMFERENCE}`}
            >
              <title>{usedLabel}</title>
            </circle>
          </>
        )}
      </g>
      <text
        x="50"
        y="49"
        textAnchor="middle"
        className="fill-ink text-[9px] font-semibold"
      >
        {centerTop}
      </text>
      <text x="50" y="58" textAnchor="middle" className="fill-subtle text-[6px]">
        {centerBottom}
      </text>
    </svg>
  );
}

function UsageSidebar({ info, loading }: { info: KeyInfo | null; loading: boolean }) {
  if (!info) {
    return (
      <section className={card}>
        <h2 className={heading}>Usage</h2>
        <div className="mt-4">
          <UsagePie fraction={null} centerTop="–" centerBottom="no data yet" />
        </div>
        <p className="mt-4 text-center text-sm text-muted">
          {loading
            ? "Loading usage…"
            : "Paste your key to see how much of its credit has been used."}
        </p>
      </section>
    );
  }

  const hasLimit = info.limit !== null;
  // For keys whose limit resets, limit_remaining reflects the current period,
  // so prefer it over lifetime usage when splitting the pie.
  const usedOfLimit = hasLimit
    ? Math.max(
        0,
        info.limitRemaining !== null ? info.limit! - info.limitRemaining : info.usage,
      )
    : 0;
  const remaining = hasLimit
    ? Math.max(0, info.limitRemaining ?? info.limit! - info.usage)
    : 0;
  const fraction = hasLimit
    ? info.limit! > 0
      ? Math.min(1, usedOfLimit / info.limit!)
      : 1
    : null;
  const percent = (fraction ?? 0) * 100;
  const percentText = `${percent.toFixed(percent > 0 && percent < 10 ? 1 : 0)}%`;

  const periods = [
    { label: "Today", value: info.usageDaily },
    { label: "This week", value: info.usageWeekly },
    { label: "This month", value: info.usageMonthly },
  ].filter((p): p is { label: string; value: number } => p.value !== null);

  return (
    <section className={card}>
      <h2 className={heading}>Usage</h2>
      {info.label && (
        <p className="mt-1 break-all font-mono text-xs text-subtle">{info.label}</p>
      )}

      <div className="mt-4">
        {hasLimit ? (
          <UsagePie
            fraction={fraction}
            centerTop={percentText}
            centerBottom="of limit used"
            usedLabel={`Used ${usd.format(usedOfLimit)} (${percentText})`}
            remainingLabel={`Remaining ${usd.format(remaining)}`}
          />
        ) : (
          <UsagePie fraction={null} centerTop="No limit" centerBottom="on this key" />
        )}
      </div>

      {hasLimit ? (
        <ul className="mt-4 space-y-2 text-sm">
          <LegendRow
            swatch="bg-brand"
            label="Used"
            value={usd.format(usedOfLimit)}
          />
          <LegendRow
            swatch="bg-brand-tint-strong"
            label="Remaining"
            value={usd.format(remaining)}
          />
        </ul>
      ) : (
        <p className="mt-4 text-center text-sm text-muted">
          This key has no credit limit, so there is nothing to split into used
          and remaining.
        </p>
      )}

      <dl className="mt-4 divide-y divide-line border-t border-line text-sm">
        <Row label="Credit limit" value={hasLimit ? usd.format(info.limit!) : "No limit"} />
        <Row label="Spent (all time)" value={usd.format(info.usage)} />
        {periods.map((p) => (
          <Row key={p.label} label={`Spent ${p.label.toLowerCase()}`} value={usd.format(p.value)} />
        ))}
      </dl>

      {info.limitReset && (
        <p className="mt-3 text-xs text-subtle">
          This limit resets {info.limitReset}; the chart shows the current
          period. Periods use UTC.
        </p>
      )}
      {info.expiresAt && (
        <p className="mt-3 text-xs text-subtle">
          Key expires on {new Date(info.expiresAt).toLocaleDateString()}.
        </p>
      )}

      <p className="mt-4 rounded-lg bg-soft p-3 text-xs text-muted">
        <span className="font-semibold">Total tokens used:</span> OpenRouter
        reports a key&apos;s lifetime usage in dollars, not tokens. Token counts
        are shown per test call.
      </p>
    </section>
  );
}

function LegendRow({ swatch, label, value }: { swatch: string; label: string; value: string }) {
  return (
    <li className="flex items-center gap-2">
      <span aria-hidden className={`h-3 w-3 shrink-0 rounded-sm ${swatch}`} />
      <span className="text-muted">{label}</span>
      <span className="ml-auto font-semibold tabular-nums">{value}</span>
    </li>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
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
  onPick: (model: string) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visible = q
    ? models.filter(
        (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q),
      )
    : models;

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
        Pick a model to run the test prompt. Prices are per 1M tokens (input /
        output).
      </p>

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
            const free = m.promptPrice === 0 && m.completionPrice === 0;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onPick(m.id)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-soft disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{m.name}</span>
                    <span className="block truncate font-mono text-xs text-subtle">
                      {m.id}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-xs tabular-nums text-muted">
                    {testingModel === m.id
                      ? "Calling…"
                      : free
                        ? "Free"
                        : `${formatPerMillion(m.promptPrice)} / ${formatPerMillion(m.completionPrice)}`}
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
            <Stat
              label="Cost of call"
              value={result.cost === null ? "n/a" : formatCallCost(result.cost)}
            />
          </dl>
        </>
      )}
    </section>
  );
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
