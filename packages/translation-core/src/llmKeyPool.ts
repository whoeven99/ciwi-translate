/** Multi-key LLM pool with adaptive concurrency (DeepSeek account in-flight). */

import { getTranslationCoreRedis } from "./runtime.js";
import {
  emptyErrorTally,
  QuotaExhaustedError,
  type LlmErrorKind,
  type LlmErrorTally,
} from "./llmErrors.js";
import {
  LLM_FIRST_TOKEN_LATENCY_FACTOR,
  LLM_FIRST_TOKEN_TIMEOUT_MAX_MS,
  LLM_FIRST_TOKEN_TIMEOUT_MS,
  MAX_POOL_CONCURRENCY,
  resolveDeepSeekChatCompletionsUrl,
  resolveDeepSeekPoolConcurrency,
  resolveModel,
  type LlmTransport,
} from "./deepseekClient.js";

type PoolInitOptions = { model?: string };

/**
 * Semaphore whose capacity can be raised or lowered at runtime.
 * Pending acquirers are woken up immediately when capacity increases.
 * setMax(0) wakes waiters so they fail fast instead of hanging.
 */
export class AdaptiveSemaphore {
  private _max: number;
  private _inflight = 0;
  private readonly _waiters: Array<() => void> = [];

  constructor(initial: number) { this._max = Math.max(1, initial); }

  setMax(n: number): void {
    this._max = Math.max(0, n);
    if (this._max <= 0) {
      while (this._waiters.length > 0) this._waiters.shift()!();
      return;
    }
    this._flush();
  }
  get max() { return this._max; }
  get inflight() { return this._inflight; }

  async acquire(): Promise<void> {
    if (this._max <= 0) {
      throw new QuotaExhaustedError();
    }
    if (this._inflight < this._max) { this._inflight++; return; }
    await new Promise<void>((r) => this._waiters.push(r));
    if (this._max <= 0) {
      throw new QuotaExhaustedError();
    }
    if (this._inflight >= this._max) {
      return this.acquire();
    }
    this._inflight++;
  }

  /**
   * Soft acquire for shop credit gates: returns false when cap is 0 instead of
   * throwing (callers settle in-flight work and return a normal stop signal).
   */
  async tryAcquire(): Promise<boolean> {
    if (this._max <= 0) return false;
    if (this._inflight < this._max) {
      this._inflight++;
      return true;
    }
    await new Promise<void>((r) => this._waiters.push(r));
    if (this._max <= 0) return false;
    if (this._inflight >= this._max) {
      return this.tryAcquire();
    }
    this._inflight++;
    return true;
  }

  release(): void {
    this._inflight = Math.max(0, this._inflight - 1);
    this._flush();
  }

  private _flush(): void {
    while (this._waiters.length > 0 && this._inflight < this._max) {
      this._waiters.shift()!();
    }
  }
}

/** Exponentially-weighted moving average (α = 0.2 by default). */
class EWMA {
  constructor(private _v: number, private readonly _a = 0.2) {}
  update(sample: number): void { this._v = this._a * sample + (1 - this._a) * this._v; }
  setValue(v: number): void { this._v = v; }
  get value(): number { return this._v; }
}

/** Copy fetch Response headers into a lowercase-key record for the pool. */
export function responseHeadersToRecord(response: Response): Record<string, string> {
  const out: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    out[name.toLowerCase()] = value;
  });
  return out;
}

const LIMIT_HINT_KEY_RE = /limit|rate|quota|throttle|remaining|retry/i;

function formatLimitHintsForLog(hints: string[]): string {
  if (hints.length === 0) return "";
  return `\n  limit-related in response body:\n${hints.map((h) => `    ${h}`).join("\n")}`;
}

function limitLikeHeaderLines(headers: Record<string, string>): string {
  return Object.entries(headers)
    .filter(([k]) =>
      k.includes("ratelimit") ||
      k.includes("rate-limit") ||
      k.includes("retry-after") ||
      k.includes("x-rds-") ||
      LIMIT_HINT_KEY_RE.test(k),
    )
    .map(([k, v]) => `    ${k}: ${v}`)
    .join("\n");
}

/**
 * Normalise provider-specific reset headers.
 * - OpenAI suffixed headers (`x-ratelimit-reset-requests`) → seconds until reset.
 * - DeepSeek bare `x-ratelimit-reset` → Unix epoch seconds (see user-facing docs).
 */
function parseRateLimitResetMs(raw: number | undefined, now: number): number | undefined {
  if (raw == null || Number.isNaN(raw)) return undefined;
  if (raw >= 1_000_000_000_000) return raw;
  if (raw >= 1_000_000_000) return raw * 1_000;
  return now + raw * 1_000;
}

// ── Congestion-guard thresholds (timeout-rate driven backoff) ──────────────────
// DeepSeek 200s carry no quota headers and never 429 here, so the pool needs its
// own pressure signal. The right signal is the TIMEOUT RATE — requests dying
// before they finish — NOT absolute latency: big HTML/JSON batches legitimately
// take 20–30s per request, so an absolute-latency brake just serialised the job
// at the floor while latency stayed high anyway. We back off (same multiplicative
// cut as a 429) when timeouts climb. High avg latency under load is expected (queueing
// at the provider) — use it only to stop ramping, never to shed concurrency.
/** Recent timeout rate (EWMA, 0..1) above this → shed concurrency. Primary brake. */
const LLM_TIMEOUT_RATE_HIGH = Math.min(1, Math.max(0.01, Number(process.env.TRANSLATE_LLM_TIMEOUT_RATE_HIGH) || 0.25));
/** Avg latency above this → hold concurrency steady (no ramp). Does NOT trigger backoff. */
const RAMP_LATENCY_INHIBIT_MS = Math.max(
  10_000,
  Number(process.env.TRANSLATE_RAMP_LATENCY_INHIBIT_MS) ||
    Number(process.env.TRANSLATE_LLM_LATENCY_HIGH_MS) ||
    15_000,
);
/** Min gap between successive soft backoffs (ms) — let the cut take effect first. */
const SOFT_BACKOFF_MIN_INTERVAL_MS = Math.max(500, Number(process.env.TRANSLATE_SOFT_BACKOFF_MIN_INTERVAL_MS) || 3_000);
/** Multiplicative factor applied on each backoff (soft latency/timeout or 429). */
const BACKOFF_FACTOR = 0.7;
/** Soft back-off floor — stay above serial crawl (was 4, too easy to stall). */
const SOFT_BACKOFF_FLOOR = Math.max(1, Number(process.env.TRANSLATE_SOFT_BACKOFF_FLOOR) || 16);
/** Half-life for timeout-rate decay when no new timeouts (wall clock, not success count). */
const TIMEOUT_RATE_HALF_LIFE_MS = Math.max(
  5_000,
  Number(process.env.TRANSLATE_TIMEOUT_RATE_HALF_LIFE_MS) || 30_000,
);
/** If no timeout for this long, allow timed concurrency recovery. */
const RECOVERY_NO_TIMEOUT_MS = Math.max(
  2_000,
  Number(process.env.TRANSLATE_RECOVERY_NO_TIMEOUT_MS) || 8_000,
);
/** Min interval between timed recovery ticks. */
const RECOVERY_RAMP_INTERVAL_MS = Math.max(
  3_000,
  Number(process.env.TRANSLATE_RECOVERY_RAMP_INTERVAL_MS) || 10_000,
);
/** Concurrency added on each timed recovery tick. */
const RECOVERY_RAMP_ADD = Math.max(1, Number(process.env.TRANSLATE_RECOVERY_RAMP_ADD) || 4);

type PoolLimitMode = "headers" | "deepseek-concurrency" | "blind";

type SlotRateLimit = {
  limitReq: number;     // max requests per window (RPM equivalent)
  remainingReq: number; // remaining requests in current window
  resetReqMs: number;   // epoch ms when the request window resets
  limitTok: number;     // max tokens per window (TPM equivalent)
  remainingTok: number;
  resetTokMs: number;
};

type KeySlotStats = {
  calls: number;
  tokens: number;
  totalLatencyMs: number;
  throttleCount: number;
  errors: number;               // total failed call attempts (any kind, incl. retried-then-recovered)
  errorsByKind: LlmErrorTally;  // same total, split by cause for telemetry
};

type KeySlot = {
  transport: LlmTransport;
  model: string;
  label: string;
  throttledUntil: number;
  rateLimit: SlotRateLimit | null;
  stats: KeySlotStats;
};

// ── Pool ─────────────────────────────────────────────────────────────────────

function formatSlotQuota(rl: SlotRateLimit): string {
  const tpm =
    rl.limitTok === Infinity
      ? "TPM n/a"
      : `TPM ${rl.remainingTok}/${rl.limitTok}`;
  return `RPM ${rl.remainingReq}/${rl.limitReq}, ${tpm}`;
}

class LLMKeyPool {
  private readonly slots: KeySlot[];
  private cursor = 0;
  private readonly sem: AdaptiveSemaphore;
  /** EWMA of LLM call durations (ms). Seed at 3 s — conservative starting point. */
  private readonly latency = new EWMA(3_000);
  /** EWMA of tokens consumed per request. Used for TPM-based concurrency calc. */
  private readonly tokPerReq = new EWMA(1_000);
  /** Per-slot quota log throttle (epoch ms). */
  private readonly _quotaLogAt = new Map<string, number>();
  /** Last logged quota snapshot per slot — skip duplicate lines. */
  private readonly _lastQuotaSnap = new Map<string, string>();
  /** Slots that have logged their first successful response. */
  private readonly _firstResponseLogged = new Set<string>();
  private static readonly QUOTA_LOG_INTERVAL_MS = 10_000;

  // ── Blind AIMD (used when the provider returns no rate-limit headers) ───────
  /** True once any slot has reported recognised rate-limit headers. */
  private _hasSeenAnyHeaders = false;
  /** Successful call counter — drives additive-increase ramp in blind mode. */
  private _blindSuccesses = 0;
  /**
   * Max concurrency per key in blind mode.
   * Default 8; override with LLM_BLIND_PER_KEY_MAX env var.
   * With N keys the hard ceiling is N × this value (also bounded by MAX_POOL_CONCURRENCY).
   */
  private readonly _blindPerKeyCap =
    Math.max(1, Number(process.env.LLM_BLIND_PER_KEY_MAX) || 8);

  /** DeepSeek: account-level in-flight cap. */
  private readonly _limitMode: PoolLimitMode;
  private _deepseekConcCeiling = 0;
  private _deepseekRampSuccesses = 0;
  /** EWMA of recent timeout occurrences (1=timeout, 0=ok). Congestion signal. */
  private readonly _timeoutRate = new EWMA(0, 0.1);
  /** Wall-clock anchor for time-based timeout-rate decay (not success-driven). */
  private _timeoutRateDecayedAt = Date.now();
  /** Epoch ms of last LLM timeout — drives timed recovery. */
  private _lastTimeoutAt = 0;
  /** Epoch ms of last timed +N recovery step. */
  private _lastTimedRecoveryAt = 0;
  /** Epoch ms of last soft backoff — rate-limits successive cuts. */
  private _lastSoftBackoffAt = 0;
  /** Pool-level count of fields that exhausted retries and fell back to original. */
  private _terminalFallbacks = 0;

  constructor(slots: KeySlot[], options?: PoolInitOptions) {
    if (slots.length === 0) throw new Error("[llm-pool] no LLM API keys configured");
    this.slots = slots;

    const model = options?.model ?? (process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat");
    const slotLabels = slots.map((s) => s.label).join(", ");

    this._limitMode = "deepseek-concurrency";
    const cfg = resolveDeepSeekPoolConcurrency(model);
    this._deepseekConcCeiling = cfg.ceiling;
    this.sem = new AdaptiveSemaphore(cfg.initial);
    console.log(
      `[llm-pool] initialised — ${slots.length} slot(s): ${slotLabels}, ` +
      `deepseek concurrency mode (model=${model}, accountLimit=${cfg.accountLimit}, ` +
      `ceiling=${cfg.ceiling}, initial=${cfg.initial}; keys share account quota)`,
    );
  }

  get size(): number { return this.slots.length; }

  /**
   * Acquire a key slot + semaphore slot for one LLM call.
   * Blocks if at max concurrency or if all slots are throttled.
   *
   * Caller MUST call `release()` in a finally block.
   * Caller SHOULD call `onResponse()` on success and `onThrottle()` on 429.
   */
  async acquire(): Promise<{
    transport: LlmTransport;
    model: string;
    label: string;
    onThrottle: (waitMs: number) => void;
    onResponse: (
      headers: Record<string, string>,
      durationMs: number,
      tokens: number,
      limitHints?: string[],
    ) => void;
    onError: (kind: LlmErrorKind) => void;
    release: () => void;
  }> {
    await this.sem.acquire();

    const now = Date.now();
    for (let i = 0; i < this.slots.length; i++) {
      const idx = (this.cursor + i) % this.slots.length;
      const slot = this.slots[idx];
      if (slot.throttledUntil <= now) {
        this.cursor = (idx + 1) % this.slots.length;
        return {
          transport: slot.transport,
          model: slot.model,
          label: slot.label,
          onResponse: (
            headers: Record<string, string>,
            durationMs: number,
            tokens: number,
            limitHints: string[] = [],
          ) => {
            const headersApplied = this._applyHeaders(slot, headers);
            if (headersApplied) this._hasSeenAnyHeaders = true;
            this.latency.update(durationMs);
            if (tokens > 0) this.tokPerReq.update(tokens);
            slot.stats.calls++;
            slot.stats.tokens += tokens;
            slot.stats.totalLatencyMs += Math.round(durationMs);
            this._logResponseQuota(slot, headers, headersApplied, durationMs, tokens, limitHints);
            this._recalc();
            this._blindOnSuccess(); // no-op once headers are seen
          },
          onThrottle: (waitMs: number) => {
            slot.throttledUntil = Date.now() + waitMs;
            slot.stats.throttleCount++;
            this._recalc();
            this._blindOnThrottle(); // no-op once headers are seen
            console.warn(`[llm-pool] slot ${slot.label} throttled for ${(waitMs / 1_000).toFixed(1)}s`);
          },
          onError: (kind: LlmErrorKind) => {
            slot.stats.errors++;
            slot.stats.errorsByKind[kind]++;
            this._onAttemptError(kind);
          },
          release: () => this.sem.release(),
        };
      }
    }

    // All slots throttled: release semaphore, wait for earliest recovery, retry.
    this.sem.release();
    const earliest = Math.min(...this.slots.map((s) => s.throttledUntil));
    const waitMs = Math.max(earliest - now, 200);
    console.warn(`[llm-pool] all ${this.slots.length} slot(s) throttled — waiting ${(waitMs / 1_000).toFixed(1)}s`);
    await new Promise((r) => setTimeout(r, waitMs));
    return this.acquire();
  }

  // ── Header parsing ─────────────────────────────────────────────────────────

  private _applyHeaders(slot: KeySlot, h: Record<string, string>): boolean {
    const n = (key: string): number | undefined => {
      const v = h[key];
      return v !== undefined ? Number(v) : undefined;
    };

    // Prefer the more specific -requests/-tokens suffixed form
    const limitReq  = n("x-ratelimit-limit-requests")    ?? n("x-ratelimit-limit");
    const remReq    = n("x-ratelimit-remaining-requests") ?? n("x-ratelimit-remaining");
    const resetReqS = n("x-ratelimit-reset-requests")     ?? n("x-ratelimit-reset");
    const limitTok  = n("x-ratelimit-limit-tokens");
    const remTok    = n("x-ratelimit-remaining-tokens");
    const resetTokS = n("x-ratelimit-reset-tokens");

    if (limitReq == null || remReq == null || resetReqS == null) return false; // incomplete headers

    const now = Date.now();
    const resetReqMs = parseRateLimitResetMs(resetReqS, now);
    const resetTokMs = resetTokS != null
      ? parseRateLimitResetMs(resetTokS, now)
      : undefined;
    slot.rateLimit = {
      limitReq,
      remainingReq: remReq,
      resetReqMs:   resetReqMs ?? (slot.rateLimit?.resetReqMs ?? now + 60_000),
      limitTok:     limitTok  ?? (slot.rateLimit?.limitTok  ?? Infinity),
      remainingTok: remTok    ?? (slot.rateLimit?.remainingTok ?? Infinity),
      resetTokMs:   resetTokMs ?? (slot.rateLimit?.resetTokMs ?? now + 60_000),
    };
    return true;
  }

  /** Log first response per slot, then quota changes (throttled). */
  private _logResponseQuota(
    slot: KeySlot,
    allHeaders: Record<string, string>,
    headersApplied: boolean,
    durationMs: number,
    tokens: number,
    limitHints: string[] = [],
  ): void {
    const headerRlLines = limitLikeHeaderLines(allHeaders);
    const bodyLimitBlock = formatLimitHintsForLog(limitHints);

    if (!this._firstResponseLogged.has(slot.label)) {
      this._firstResponseLogged.add(slot.label);
      if (headersApplied && slot.rateLimit) {
        const bare = [
          allHeaders["x-ratelimit-limit"] != null
            ? `limit=${allHeaders["x-ratelimit-limit"]}`
            : null,
          allHeaders["x-ratelimit-remaining"] != null
            ? `remaining=${allHeaders["x-ratelimit-remaining"]}`
            : null,
          allHeaders["x-ratelimit-reset"] != null
            ? `reset=${allHeaders["x-ratelimit-reset"]}`
            : null,
        ].filter(Boolean).join(", ");
        console.log(
          `[llm-pool] ${slot.label} first response — ${formatSlotQuota(slot.rateLimit)}` +
          ` (${durationMs.toFixed(0)}ms, ${tokens} tok)` +
          (bare ? ` [${bare}]` : "") +
          (headerRlLines ? `\n  rate-limit-like headers:\n${headerRlLines}` : "") +
          bodyLimitBlock,
        );
        this._lastQuotaSnap.set(slot.label, formatSlotQuota(slot.rateLimit));
        this._quotaLogAt.set(slot.label, Date.now());
      } else if (this._limitMode === "deepseek-concurrency") {
        console.log(
          `[llm-pool] ${slot.label} first response — deepseek concurrency mode` +
          ` (${durationMs.toFixed(0)}ms, ${tokens} tok; no quota headers on 200 — expected per DeepSeek docs)` +
          `\n  pool concurrency=${this.sem.max}/${this._deepseekConcCeiling} (account in-flight limit)` +
          bodyLimitBlock,
        );
      } else {
        const blindCeil = this.slots.length * this._blindPerKeyCap;
        console.log(
          `[llm-pool] ${slot.label} first response — no recognized rate-limit headers` +
          ` (${durationMs.toFixed(0)}ms, ${tokens} tok)` +
          (headerRlLines
            ? `\n  rate-limit-like headers found (different names?):\n${headerRlLines}`
            : `\n  no rate-limit-like headers at all — using blind AIMD (target ceil=${blindCeil})`) +
          bodyLimitBlock,
        );
      }
      return;
    }

    if (headersApplied && slot.rateLimit) {
      this._maybeLogQuota(slot, "updated");
    }
  }

  private _maybeLogQuota(slot: KeySlot, reason: "updated" | "recalc"): void {
    const rl = slot.rateLimit;
    if (!rl) return;

    const snap = formatSlotQuota(rl);
    const now = Date.now();
    const lastAt = this._quotaLogAt.get(slot.label) ?? 0;
    const prevSnap = this._lastQuotaSnap.get(slot.label);
    const lowQuota =
      rl.limitReq > 0 && rl.remainingReq / rl.limitReq < 0.2 ||
      (rl.limitTok !== Infinity && rl.limitTok > 0 && rl.remainingTok / rl.limitTok < 0.2);
    const changed = snap !== prevSnap;
    const intervalElapsed = now - lastAt >= LLMKeyPool.QUOTA_LOG_INTERVAL_MS;

    if (!changed && !lowQuota && !intervalElapsed) return;

    this._quotaLogAt.set(slot.label, now);
    this._lastQuotaSnap.set(slot.label, snap);
    console.log(
      `[llm-pool] ${slot.label} quota ${reason} — ${snap}, pool concurrency=${this.sem.max}` +
      (lowQuota ? " (low remaining)" : ""),
    );
  }

  // ── Blind AIMD methods ─────────────────────────────────────────────────────
  //
  // Called after every successful response (_blindOnSuccess) and every 429
  // (_blindOnThrottle).  Both are no-ops once real rate-limit headers have been
  // seen, because the Little's Law path in _recalc() takes over.

  /**
   * Additive increase: after every RAMP_STEP successful calls without a 429,
   * increment the semaphore cap by 1.  The ceiling is slots × _blindPerKeyCap
   * (default 8 per key, so 24 total with 3 keys).
   */
  private _blindOnSuccess(): void {
    if (this._limitMode === "deepseek-concurrency") {
      this._deepseekOnSuccess();
      return;
    }
    if (this._hasSeenAnyHeaders) return;
    this._blindSuccesses++;
    const RAMP_STEP = 2; // add 1 concurrency unit every 2 successful calls
    const blindCeil = Math.min(this.slots.length * this._blindPerKeyCap, MAX_POOL_CONCURRENCY);
    if (this._blindSuccesses % RAMP_STEP === 0 && this.sem.max < blindCeil) {
      const newMax = this.sem.max + 1;
      this.sem.setMax(newMax);
      console.log(
        `[llm-pool] blind ramp → concurrency=${newMax}/${blindCeil}` +
        ` (${this._blindSuccesses} total successes, no rate-limit headers)`,
      );
    }
  }

  /**
   * Multiplicative decrease: on a 429, halve the concurrency cap and reset the
   * success counter so the ramp restarts from the new lower baseline.
   */
  /**
   * DeepSeek docs: limit = concurrent in-flight requests per account.
   * Ramp toward documented ceiling; back off on 429.
   */
  private _deepseekOnSuccess(): void {
    if (this._hasSeenAnyHeaders) return;
    const now = Date.now();
    this._applyTimeoutRateTimeDecay(now);
    this._maybeTimedRecovery(now);

    // ── Congestion guard (timeout-rate driven) ────────────────────────────────
    // Brake on timeouts, not on absolute latency: a slow-but-completing endpoint
    // (big HTML batches at 60–120s under load) is fine and should keep its
    // concurrency. High latency only stops the ramp — shedding on latency alone
    // caused a death spiral (concurrency 77→4 while timeoutRate stayed 0%).
    if (this._timeoutRate.value > LLM_TIMEOUT_RATE_HIGH) {
      this._softBackoff("timeout rate");
      return;
    }
    // Ramp up only while timeouts are rare (well under the brake threshold), so
    // we grow when requests are completing cleanly and hold steady near the knee.
    if (this._timeoutRate.value > LLM_TIMEOUT_RATE_HIGH / 2) return;
    if (this.latency.value > RAMP_LATENCY_INHIBIT_MS) return;

    // ── Adaptive ramp: add amount decays as latency climbs; step count scales
    //     with current concurrency so the ramp naturally plateaus at the knee.
    //     Produces a sigmoid-shaped QPS curve instead of spike-then-crash.
    const lat = this.latency.value;
    let rampAdd: number;
    if (lat < 3000)       rampAdd = 8;   // fast climb — plenty of headroom
    else if (lat < 6000)  rampAdd = 4;   // normal
    else if (lat < 10000) rampAdd = 2;   // slow — approaching the knee
    else if (lat < 15000) rampAdd = 1;   // crawl — near capacity
    else                  rampAdd = 0;   // hold — already at inhibit threshold

    if (rampAdd === 0) return;

    // Ramp step grows with concurrency: at higher concurrency, require more
    // successful calls between increments to avoid overshooting the knee.
    //   conc=32 → step≈8  (fast initial ramp)
    //   conc=64 → step≈16 (moderate)
    //   conc=96 → step≈24 (slow, deliberate)
    const rampStep = Math.max(4, Math.ceil(this.sem.max / 4));

    this._deepseekRampSuccesses++;
    if (
      this._deepseekRampSuccesses % rampStep === 0 &&
      this.sem.max < this._deepseekConcCeiling
    ) {
      const newMax = Math.min(this._deepseekConcCeiling, this.sem.max + rampAdd);
      if (newMax !== this.sem.max) {
        this.sem.setMax(newMax);
        console.log(
          `[llm-pool] deepseek ramp → concurrency=${newMax}/${this._deepseekConcCeiling}` +
          ` (${this._deepseekRampSuccesses} successes, latency=${lat.toFixed(0)}ms, add=${rampAdd}, step=${rampStep})`,
        );
      }
    }
  }

  /** Feed a failed attempt into the congestion guard. Timeouts drive the brake. */
  private _onAttemptError(kind: LlmErrorKind): void {
    if (this._limitMode !== "deepseek-concurrency" || this._hasSeenAnyHeaders) return;
    const now = Date.now();
    // A timed-out request never reaches onResponse, so its (huge) latency is NOT
    // in the latency EWMA — the timeout rate is the only signal that catches it.
    this._applyTimeoutRateTimeDecay(now);
    if (kind === "timeout") {
      this._timeoutRate.update(1);
      this._lastTimeoutAt = now;
      this._timeoutRateDecayedAt = now;
    }
    if (kind === "timeout" && this._timeoutRate.value > LLM_TIMEOUT_RATE_HIGH) {
      this._softBackoff("timeout rate");
    }
  }

  /**
   * Decay timeout-rate EWMA toward 0 on wall clock — avoids staying "guilty" at
   * floor 4 when successes are sparse (40s+ latency) and success-count decay stalls.
   */
  private _applyTimeoutRateTimeDecay(now = Date.now()): void {
    const elapsed = now - this._timeoutRateDecayedAt;
    if (elapsed <= 0) return;
    const factor = Math.pow(0.5, elapsed / TIMEOUT_RATE_HALF_LIFE_MS);
    if (factor >= 0.999) return;
    this._timeoutRate.setValue(this._timeoutRate.value * factor);
    this._timeoutRateDecayedAt = now;
  }

  /**
   * Timed recovery: if no recent timeouts, add concurrency on an interval.
   * Recovery speed adapts to conditions — fast when healthy, cautious when near
   * the ceiling or when latency is elevated. This ensures the pool climbs back
   * from a backoff-induced floor without waiting for the success-count ramp
   * (which stalls when concurrency is very low and successes are sparse).
   */
  private _maybeTimedRecovery(now = Date.now()): void {
    if (this.sem.max >= this._deepseekConcCeiling) return;
    if (now - this._lastTimedRecoveryAt < RECOVERY_RAMP_INTERVAL_MS) return;
    if (this._lastTimeoutAt > 0 && now - this._lastTimeoutAt < RECOVERY_NO_TIMEOUT_MS) return;
    if (this._timeoutRate.value > LLM_TIMEOUT_RATE_HIGH / 2) return;

    this._lastTimedRecoveryAt = now;

    const lat = this.latency.value;
    const gap = this._deepseekConcCeiling - this.sem.max;
    const isQuiet = this._timeoutRate.value === 0;

    // Adaptive recovery step — timeout rate is the only true safety signal.
    // High latency without timeouts means "slow but healthy": safe to push more.
    let add: number;
    if (isQuiet && lat < 3000 && gap > 40) {
      add = Math.max(RECOVERY_RAMP_ADD * 2, Math.ceil(gap / 2));   // fast catch-up
    } else if (isQuiet && lat < 8000) {
      add = RECOVERY_RAMP_ADD * 3;                                  // aggressive: +12
    } else if (isQuiet) {
      add = RECOVERY_RAMP_ADD * 2;                                  // quiet but slow: +8
    } else if (lat < 10000) {
      add = RECOVERY_RAMP_ADD;                                      // normal: +4
    } else {
      add = Math.max(1, Math.floor(RECOVERY_RAMP_ADD / 2));        // cautious: +2
    }

    const newMax = Math.min(this._deepseekConcCeiling, this.sem.max + add);
    if (newMax === this.sem.max) return;
    this.sem.setMax(newMax);

    const quietSec =
      this._lastTimeoutAt > 0 ? Math.round((now - this._lastTimeoutAt) / 1000) : null;
    console.log(
      `[llm-pool] timed recovery → concurrency=${newMax}/${this._deepseekConcCeiling}` +
      ` (+${add}, timeoutRate=${(this._timeoutRate.value * 100).toFixed(0)}%` +
      `, latency=${lat.toFixed(0)}ms` +
      `${quietSec != null ? `, quiet=${quietSec}s` : ""})`,
    );
  }

  /** Multiplicative concurrency cut from a soft (latency/timeout) congestion signal. */
  private _softBackoff(reason: string): void {
    const now = Date.now();
    if (now - this._lastSoftBackoffAt < SOFT_BACKOFF_MIN_INTERVAL_MS) return;
    this._lastSoftBackoffAt = now;
    const floor = Math.max(this.slots.length, SOFT_BACKOFF_FLOOR);
    const newMax = Math.max(floor, Math.floor(this.sem.max * BACKOFF_FACTOR));
    this._deepseekRampSuccesses = 0;
    if (newMax !== this.sem.max) {
      this.sem.setMax(newMax);
      console.warn(
        `[llm-pool] soft back-off → concurrency=${newMax} (${reason}; ` +
        `latency=${this.latency.value.toFixed(0)}ms, timeoutRate=${(this._timeoutRate.value * 100).toFixed(0)}%)`,
      );
    }
  }

  /**
   * Adaptive "wait for first token" budget (ms). When the endpoint is slow or
   * queued, the first token legitimately takes longer; being patient here turns
   * a premature abort + retry (which wastes work AND adds load) into a slow
   * success. Scales with observed latency, clamped to a sane floor/ceiling.
   */
  firstTokenBudgetMs(): number {
    const fromLatency = this.latency.value * LLM_FIRST_TOKEN_LATENCY_FACTOR;
    return Math.min(
      LLM_FIRST_TOKEN_TIMEOUT_MAX_MS,
      Math.max(LLM_FIRST_TOKEN_TIMEOUT_MS, Math.round(fromLatency)),
    );
  }

  /** Record fields that exhausted retries and fell back to the original text. */
  recordTerminalFallback(n = 1): void {
    this._terminalFallbacks += Math.max(0, n);
  }

  /** Aggregate failed-attempt counts by cause + terminal fallbacks across slots. */
  getErrorBreakdown(): { byKind: LlmErrorTally; terminalFallbacks: number } {
    const byKind = emptyErrorTally();
    for (const slot of this.slots) {
      byKind.timeout += slot.stats.errorsByKind.timeout;
      byKind.parse   += slot.stats.errorsByKind.parse;
      byKind.http    += slot.stats.errorsByKind.http;
      byKind.api     += slot.stats.errorsByKind.api;
      byKind.other   += slot.stats.errorsByKind.other;
    }
    return { byKind, terminalFallbacks: this._terminalFallbacks };
  }

  private _deepseekOnThrottle(): void {
    const floor = Math.max(this.slots.length, SOFT_BACKOFF_FLOOR);
    const newMax = Math.max(floor, Math.floor(this.sem.max * BACKOFF_FACTOR));
    this._deepseekRampSuccesses = 0;
    if (newMax !== this.sem.max) {
      this.sem.setMax(newMax);
      console.log(`[llm-pool] deepseek back-off → concurrency=${newMax} (429, account quota)`);
    }
  }

  private _blindOnThrottle(): void {
    if (this._limitMode === "deepseek-concurrency") {
      this._deepseekOnThrottle();
      return;
    }
    if (this._hasSeenAnyHeaders) return;
    const floor  = this.slots.length;          // never go below 1 per slot
    const newMax = Math.max(floor, Math.floor(this.sem.max * 0.5));
    this._blindSuccesses = 0;
    if (newMax !== this.sem.max) {
      this.sem.setMax(newMax);
      console.log(`[llm-pool] blind back-off → concurrency=${newMax} (429, ramp reset)`);
    }
  }

  private _quotaSummary(): string {
    const now = Date.now();
    return this.slots
      .filter((s) => s.throttledUntil <= now && s.rateLimit)
      .map((s) => `${s.label}[${formatSlotQuota(s.rateLimit!)}]`)
      .join("; ") || "no quota headers yet";
  }

  // ── Adaptive concurrency (Little's Law) ───────────────────────────────────

  /**
   * Recalculate the safe concurrency ceiling based on current rate-limit state.
   *
   * For each active slot:
   *   safeRPS   = remainingRequests / windowRemainSeconds   (sustainable req/s)
   *   safeConc  = safeRPS × avgLatencySeconds               (Little's Law)
   *
   * Both the requests dimension and the token dimension are evaluated; the
   * stricter constraint wins.  Results are summed across slots and clamped to
   * [1, MAX_POOL_CONCURRENCY].
   */
  private _recalc(): void {
    // DeepSeek 200 responses omit quota headers — concurrency is managed separately.
    if (this._limitMode === "deepseek-concurrency" && !this._hasSeenAnyHeaders) {
      return;
    }

    const now = Date.now();
    const latS = this.latency.value / 1_000;    // avg call duration in seconds
    const avgTok = this.tokPerReq.value;         // avg tokens per call

    let totalConc = 0;
    for (const slot of this.slots) {
      if (slot.throttledUntil > now) continue; // 429'd — skip

      const rl = slot.rateLimit;
      if (!rl) {
        totalConc += 1; // no data yet — contribute 1 to avoid starvation
        continue;
      }

      // ── Requests dimension ──────────────────────────────────────────────
      const reqRemainS = Math.max((rl.resetReqMs - now) / 1_000, 0.5);
      // If the window already reset, treat as full bucket
      const effRemReq  = rl.resetReqMs <= now ? rl.limitReq : rl.remainingReq;
      const safeRPS_req = effRemReq / reqRemainS;
      const concByReq   = safeRPS_req * latS;

      // ── Tokens dimension ────────────────────────────────────────────────
      const tokRemainS  = Math.max((rl.resetTokMs - now) / 1_000, 0.5);
      const effRemTok   = rl.resetTokMs <= now ? rl.limitTok : rl.remainingTok;
      // Safe req/s derived from token budget
      const safeRPS_tok = effRemTok / tokRemainS / Math.max(avgTok, 100);
      const concByTok   = safeRPS_tok * latS;

      // Most conservative dimension wins; 0.5 floor so throttled-but-not-zero
      // slots still contribute fractionally when they recover
      const slotConc = rl.limitTok === Infinity ? concByReq : Math.min(concByReq, concByTok);
      totalConc += Math.max(0.5, slotConc);
    }

    const newMax = Math.max(1, Math.min(MAX_POOL_CONCURRENCY, Math.round(totalConc)));
    if (newMax !== this.sem.max) {
      const active = this.slots.filter((s) => s.throttledUntil <= now).length;
      console.log(
        `[llm-pool] concurrency ${this.sem.max} → ${newMax}` +
        ` (latency=${this.latency.value.toFixed(0)}ms, tok/req=${this.tokPerReq.value.toFixed(0)},` +
        ` active=${active}/${this.slots.length}, ${this._quotaSummary()})`,
      );
      this.sem.setMax(newMax);
      return;
    }

    // Concurrency unchanged — still log quota drift on a throttled interval.
    for (const slot of this.slots) {
      if (slot.throttledUntil > now || !slot.rateLimit) continue;
      this._maybeLogQuota(slot, "recalc");
    }
  }

  // ── Key stats snapshot ─────────────────────────────────────────────────────

  getKeyStats(): Array<{
    label: string;
    calls: number;
    tokens: number;
    avgLatencyMs: number;
    throttleCount: number;
    errors: number;
    errorsByKind: LlmErrorTally;
    poolConcurrency: number;
    rateLimit: SlotRateLimit | null;
  }> {
    return this.slots.map((slot) => ({
      label: slot.label,
      calls: slot.stats.calls,
      tokens: slot.stats.tokens,
      avgLatencyMs: slot.stats.calls > 0
        ? Math.round(slot.stats.totalLatencyMs / slot.stats.calls)
        : 0,
      throttleCount: slot.stats.throttleCount,
      errors: slot.stats.errors,
      errorsByKind: { ...slot.stats.errorsByKind },
      poolConcurrency: this.sem.max,
      rateLimit: slot.rateLimit,
    }));
  }
}

// ─── Pool construction ────────────────────────────────────────────────────────

function buildKeySlots(): KeySlot[] {
  const multi = process.env.DEEPSEEK_API_KEYS?.trim();
  const single = process.env.DEEPSEEK_API_KEY?.trim();
  const keys = multi
    ? multi.split(",").map((k) => k.trim()).filter(Boolean)
    : single ? [single] : [];
  if (keys.length === 0) throw new Error("DEEPSEEK_API_KEY / DEEPSEEK_API_KEYS required");
  const baseURL = process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com";
  const chatUrl = resolveDeepSeekChatCompletionsUrl(baseURL);
  const model = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat";
  return keys.map((apiKey, i) => ({
    transport: { kind: "deepseek-fetch" as const, apiKey, chatUrl },
    model,
    label: `deepseek-${i + 1}(…${apiKey.slice(-4)})`,
    throttledUntil: 0,
    rateLimit: null,
    stats: _initStats(),
  }));
}

/** Zero-fill a fresh slot stats counter. */
function _initStats(): KeySlotStats {
  return {
    calls: 0,
    tokens: 0,
    totalLatencyMs: 0,
    throttleCount: 0,
    errors: 0,
    errorsByKind: emptyErrorTally(),
  };
}

let _pool: LLMKeyPool | null = null;

export function getPool(): LLMKeyPool {
  if (_pool) return _pool;
  const model = resolveModel();
  _pool = new LLMKeyPool(buildKeySlots(), { model });
  return _pool;
}

/** 仅测试用：切换 provider/env 后重建 key pool */
export function resetLlmPoolForTests(): void {
  _pool = null;
}

// ── Key-stats flush to Redis ─────────────────────────────────────────────────
//
// Called from translateWorker's progress callback (already runs on every batch
// completion). The module-level timestamp throttles actual Redis writes to
// once per STAT_FLUSH_INTERVAL_MS regardless of how often callers invoke it.
// Errors are silently swallowed — stats are strictly best-effort telemetry.

let _lastStatFlush = 0;
const STAT_FLUSH_INTERVAL_MS = 10_000;

/**
 * Tracks the cumulative call/token counts as of the previous flush for each
 * slot, so we can compute per-interval deltas for the history log.
 */
const _slotFlushState = new Map<string, { flushedCalls: number; flushedTokens: number }>();

/**
 * Write the current key-pool stats snapshot to Redis.
 * Throttled internally to at most one write per 10 seconds.
 * Safe to call in a hot path (progress callback, etc.).
 */
/** Synchronous snapshot of LLM key pool stats. Returns [] if pool not yet initialised. */
export function getLlmPoolStats(): ReturnType<LLMKeyPool["getKeyStats"]> {
  return _pool?.getKeyStats() ?? [];
}

/** Aggregate failed-attempt counts by cause + terminal fallbacks. For QPS telemetry. */
export function getLlmErrorBreakdown(): { byKind: LlmErrorTally; terminalFallbacks: number } {
  return _pool?.getErrorBreakdown() ?? { byKind: emptyErrorTally(), terminalFallbacks: 0 };
}

/** Record that `n` fields exhausted retries and fell back to the original text. */
export function recordLlmTerminalFallback(n = 1): void {
  _pool?.recordTerminalFallback(n);
}

export async function flushKeyStats(): Promise<void> {
  const now = Date.now();
  if (now - _lastStatFlush < STAT_FLUSH_INTERVAL_MS) return;
  _lastStatFlush = now;
  if (!_pool) return;

  const stats = _pool.getKeyStats();
  if (stats.length === 0) return;

  try {
    const redis = getTranslationCoreRedis();
    const SNAP_TTL = 24 * 3600; // 24 h for current snapshot
    const LOG_TTL  =  2 * 3600; //  2 h for history log
    const LOG_MAX  = 180;        // 180 × 10 s = 30 min of history
    const pipe = redis.pipeline();

    for (const s of stats) {
      // ── Current snapshot (overwrites previous) ─────────────────────────────
      const snapKey = `translate:v4:keystat:${s.label}`;
      const remTok  = s.rateLimit?.remainingTok === Infinity ? -1 : (s.rateLimit?.remainingTok ?? -1);
      const limTok  = s.rateLimit?.limitTok      === Infinity ? -1 : (s.rateLimit?.limitTok      ?? -1);
      pipe.hset(snapKey, {
        label:           s.label,
        calls:           s.calls,
        tokens:          s.tokens,
        avgLatencyMs:    s.avgLatencyMs,
        throttleCount:   s.throttleCount,
        errors:          s.errors,
        poolConcurrency: s.poolConcurrency,
        limitReq:        s.rateLimit?.limitReq     ?? -1,
        remainingReq:    s.rateLimit?.remainingReq ?? -1,
        limitTok:        limTok,
        remainingTok:    remTok,
        updatedAt:       now,
      });
      pipe.expire(snapKey, SNAP_TTL);

      // ── History log entry (incremental delta + snapshot fields) ────────────
      // Delta calls/tokens since last flush lets the UI chart throughput over time.
      const prev = _slotFlushState.get(s.label) ?? { flushedCalls: 0, flushedTokens: 0 };
      const dCalls  = Math.max(0, s.calls  - prev.flushedCalls);
      const dTokens = Math.max(0, s.tokens - prev.flushedTokens);
      _slotFlushState.set(s.label, { flushedCalls: s.calls, flushedTokens: s.tokens });

      // Compact field names keep each entry small (< 100 bytes).
      const entry = JSON.stringify({
        t:    now,
        dC:   dCalls,
        dT:   dTokens,
        lat:  s.avgLatencyMs,
        conc: s.poolConcurrency,
        rR:   s.rateLimit?.remainingReq ?? -1,
        lR:   s.rateLimit?.limitReq     ?? -1,
        rT:   remTok,
        lT:   limTok,
      });
      const logKey = `translate:v4:keystatlog:${s.label}`;
      pipe.rpush(logKey, entry);
      pipe.ltrim(logKey, -LOG_MAX, -1); // keep last 30 min
      pipe.expire(logKey, LOG_TTL);
    }
    await pipe.exec();
  } catch {
    // Redis unavailable or not configured — stats are best-effort, ignore
  }
}
