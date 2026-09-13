// Per-key live health store (localStorage) — powers the MONITOR tab.
// Tracks per-key: working/cooldown/dead, latency, success/rate-limit/auth-error counts,
// last error + last success. Cooldowns make rotation SMART: cooled keys are skipped
// preemptively so you never hammer an exhausted key.
//
// Keyed by keyId() (prefix+len+hash) — never stores raw keys.

import { keyId } from "./providerKeys";

export type KeyHealthStatus = "working" | "cooldown" | "dead" | "untested";

export interface KeyHealth {
  id: string; // keyId()
  prefix: string; // first 8 chars (for display + backend prefix matching)
  upstream: string; // effective upstream at last record
  status: KeyHealthStatus;
  lastLatencyMs: number;
  lastTested: number;
  lastOk: number;
  success: number;
  fail429: number;
  failAuth: number;
  failOther: number;
  lastError: string;
  cooldownUntil: number; // Date.now() ms; 0 = none
}

const HEALTH_KEY = "er_key_health_v1";
export const COOLDOWN_MS = 60_000;

function loadAll(): Record<string, KeyHealth> {
  try {
    const raw = localStorage.getItem(HEALTH_KEY);
    const p = raw ? JSON.parse(raw) : {};
    return p && typeof p === "object" ? p : {};
  } catch {
    return {};
  }
}

function saveAll(all: Record<string, KeyHealth>) {
  try {
    const keys = Object.keys(all).slice(-400);
    const pruned: Record<string, KeyHealth> = {};
    keys.forEach((k) => {
      pruned[k] = all[k];
    });
    localStorage.setItem(HEALTH_KEY, JSON.stringify(pruned));
  } catch {
    /* ignore */
  }
}

export function getKeyHealth(key: string): KeyHealth | null {
  const all = loadAll();
  return all[keyId(key)] || null;
}

export function getAllHealth(): Record<string, KeyHealth> {
  return loadAll();
}

function upsert(patch: Partial<KeyHealth> & { key: string; upstream: string }): KeyHealth {
  const all = loadAll();
  const id = keyId(patch.key);
  const prev: KeyHealth = all[id] || {
    id,
    prefix: patch.key.slice(0, 8),
    upstream: patch.upstream,
    status: "untested",
    lastLatencyMs: 0,
    lastTested: 0,
    lastOk: 0,
    success: 0,
    fail429: 0,
    failAuth: 0,
    failOther: 0,
    lastError: "",
    cooldownUntil: 0,
  };
  const next: KeyHealth = {
    ...prev,
    upstream: patch.upstream,
    prefix: patch.key.slice(0, 8),
    ...(patch.status ? { status: patch.status } : {}),
  };
  if (typeof patch.lastLatencyMs === "number") next.lastLatencyMs = patch.lastLatencyMs;
  if (typeof patch.lastTested === "number") next.lastTested = patch.lastTested;
  if (typeof patch.lastOk === "number") next.lastOk = patch.lastOk;
  if (typeof patch.success === "number") next.success = patch.success;
  if (typeof patch.fail429 === "number") next.fail429 = patch.fail429;
  if (typeof patch.failAuth === "number") next.failAuth = patch.failAuth;
  if (typeof patch.failOther === "number") next.failOther = patch.failOther;
  if (typeof patch.lastError === "string") next.lastError = patch.lastError;
  if (typeof patch.cooldownUntil === "number") next.cooldownUntil = patch.cooldownUntil;
  all[id] = next;
  saveAll(all);
  return next;
}

/** Record a successful use of a key (auto-clears cooldown). */
export function recordKeyOk(key: string, upstream: string, latencyMs = 0) {
  const prev = getKeyHealth(key);
  upsert({
    key,
    upstream,
    status: "working",
    lastLatencyMs: latencyMs,
    lastTested: Date.now(),
    lastOk: Date.now(),
    success: (prev?.success || 0) + 1,
    lastError: "",
    cooldownUntil: 0,
  });
}

/** Record a 429/quota exhaustion (starts 60s cooldown). */
export function recordKey429(key: string, upstream: string, err = "429 rate limit") {
  const prev = getKeyHealth(key);
  upsert({
    key,
    upstream,
    status: "cooldown",
    lastTested: Date.now(),
    fail429: (prev?.fail429 || 0) + 1,
    lastError: err.slice(0, 140),
    cooldownUntil: Date.now() + COOLDOWN_MS,
  });
}

/** Record a 401/403 auth failure (dead key). */
export function recordKeyDead(key: string, upstream: string, err = "401/403 auth failed") {
  const prev = getKeyHealth(key);
  upsert({
    key,
    upstream,
    status: "dead",
    lastTested: Date.now(),
    failAuth: (prev?.failAuth || 0) + 1,
    lastError: err.slice(0, 140),
    cooldownUntil: 0,
  });
}

/** Record a generic failure (5xx/network) — counts but doesn't quarantine. */
export function recordKeyError(key: string, upstream: string, err: string) {
  const prev = getKeyHealth(key);
  upsert({
    key,
    upstream,
    status: prev?.status === "working" ? "working" : prev?.status || "untested",
    lastTested: Date.now(),
    failOther: (prev?.failOther || 0) + 1,
    lastError: err.slice(0, 140),
  });
}

/** Is this key currently in 429 cooldown? (auto-expires) */
export function isKeyCooling(key: string): boolean {
  const h = getKeyHealth(key);
  if (!h || !h.cooldownUntil) return false;
  if (h.cooldownUntil <= Date.now()) {
    // Expired — flip back to working/untested lazily
    const all = loadAll();
    const id = keyId(key);
    if (all[id]) {
      all[id] = {
        ...all[id],
        cooldownUntil: 0,
        status: all[id].success > 0 ? "working" : "untested",
      };
      saveAll(all);
    }
    return false;
  }
  return true;
}

export function cooldownLeftMs(key: string): number {
  const h = getKeyHealth(key);
  if (!h || !h.cooldownUntil) return 0;
  return Math.max(0, h.cooldownUntil - Date.now());
}

/** Clear cooldown early (manual revive / test-now). */
export function clearKeyCooldown(key: string) {
  const h = getKeyHealth(key);
  if (!h) return;
  upsert({ key, upstream: h.upstream, cooldownUntil: 0, status: h.success > 0 ? "working" : "untested" });
}

/** Resolve display status (cooldown auto-expiry aware). */
export function displayStatus(key: string, poolDead: boolean): KeyHealthStatus {
  if (poolDead) return "dead";
  const h = getKeyHealth(key);
  if (!h) return "untested";
  if (h.cooldownUntil && h.cooldownUntil > Date.now()) return "cooldown";
  return h.status === "cooldown" ? (h.success > 0 ? "working" : "untested") : h.status;
}

/** Order keys smartly: working+untested first (LRU), cooling last. Returns indexes. */
export function smartOrderIndexes(keys: string[]): number[] {
  const now = Date.now();
  const all = loadAll();
  const score = (k: string, i: number): [number, number, number] => {
    const h = all[keyId(k)];
    const cooling = h && h.cooldownUntil && h.cooldownUntil > now ? 1 : 0;
    const fails = h ? h.fail429 * 3 + h.failOther : 0;
    const lastOk = h?.lastOk || 0;
    // [cooling penalty, fail penalty, recency] — lower is better; older lastOk first (spread load)
    return [cooling, fails, lastOk || -i];
  };
  return keys
    .map((_, i) => i)
    .sort((a, b) => {
      const sa = score(keys[a], a);
      const sb = score(keys[b], b);
      if (sa[0] !== sb[0]) return sa[0] - sb[0];
      if (sa[1] !== sb[1]) return sa[1] - sb[1];
      return sa[2] - sb[2];
    });
}
