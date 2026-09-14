// Live probe — real telemetry, accumulated over time.
//
// The old health sweep fabricated latency from a region-name lookup plus
// `Math.random()`, and uptime from `99.9 + random*0.09`. Those numbers were
// theatre. This module measures the gateway for real: every probe is an actual
// round-trip, and uptime is a rolling success ratio over the stored history.
//
// Anything that has not been measured reads as 0 / "unmeasured" — the UI renders
// that honestly instead of inventing a plausible-looking figure.

export interface ProbeSample {
  t: number; // epoch ms
  ok: boolean;
  ms: number; // round-trip time, 0 when the probe failed
  status?: number;
}

export interface ProbeStats {
  samples: number;
  ok: number;
  failed: number;
  uptimePct: number; // 0 when nothing measured yet
  medianMs: number;
  p95Ms: number;
  lastMs: number;
  lastOk: boolean | null;
  lastChecked: number;
  measured: boolean; // false => no real data at all
}

const STORE_KEY = 'er_probe_history_v1';
const MAX_SAMPLES = 300;
const PROBE_TIMEOUT_MS = 8000;

function safeParse(raw: string | null): ProbeSample[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? arr.filter((s) => s && typeof s.t === 'number' && typeof s.ok === 'boolean')
      : [];
  } catch {
    return [];
  }
}

export function readProbeHistory(): ProbeSample[] {
  if (typeof window === 'undefined') return [];
  return safeParse(window.localStorage.getItem(STORE_KEY));
}

export function recordProbe(sample: ProbeSample): ProbeSample[] {
  if (typeof window === 'undefined') return [];
  const next = [...readProbeHistory(), sample].slice(-MAX_SAMPLES);
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch {
    /* quota — telemetry is best-effort, never break the app */
  }
  return next;
}

export function clearProbeHistory(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export function computeStats(history: ProbeSample[] = readProbeHistory()): ProbeStats {
  const empty: ProbeStats = {
    samples: 0, ok: 0, failed: 0, uptimePct: 0, medianMs: 0, p95Ms: 0,
    lastMs: 0, lastOk: null, lastChecked: 0, measured: false,
  };
  if (history.length === 0) return empty;

  const okSamples = history.filter((h) => h.ok);
  const latencies = okSamples.map((h) => h.ms).filter((ms) => ms > 0).sort((a, b) => a - b);
  const last = history[history.length - 1];

  return {
    samples: history.length,
    ok: okSamples.length,
    failed: history.length - okSamples.length,
    uptimePct: Math.round((okSamples.length / history.length) * 1000) / 10,
    medianMs: latencies.length ? Math.round(percentile(latencies, 50)) : 0,
    p95Ms: latencies.length ? Math.round(percentile(latencies, 95)) : 0,
    lastMs: last?.ok ? Math.round(last.ms) : 0,
    lastOk: last ? last.ok : null,
    lastChecked: last?.t || 0,
    measured: true,
  };
}

/**
 * One real round-trip against the gateway. Uses /api/health because it is the
 * cheapest honest endpoint: no upstream calls, no key material, no cost.
 */
export async function probeGateway(baseUrl?: string): Promise<ProbeSample> {
  const origin =
    typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
  // Accept either ".../api/v1" (endpoint base) or a bare origin.
  const root = baseUrl ? baseUrl.replace(/\/api\/v1\/?$/, '').replace(/\/+$/, '') : origin;
  const url = `${root || origin}/api/health`;

  const started = performance.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'GET', cache: 'no-store', signal: ctl.signal });
    const ms = performance.now() - started;
    const sample: ProbeSample = { t: Date.now(), ok: res.ok, ms, status: res.status };
    recordProbe(sample);
    return sample;
  } catch {
    const sample: ProbeSample = { t: Date.now(), ok: false, ms: 0 };
    recordProbe(sample);
    return sample;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Is this endpoint on our own origin (and therefore honestly probeable)?
 * Third-party endpoints cannot be probed from the browser without CORS, so we
 * leave them unmeasured rather than inventing a number.
 */
export function isSameOriginEndpoint(baseUrl: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const u = new URL(baseUrl, window.location.origin);
    return u.origin === window.location.origin;
  } catch {
    return false;
  }
}
