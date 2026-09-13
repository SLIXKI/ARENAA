// Per-provider UNLIMITED API key pools (localStorage, zero-setup).
// Entry: { k: key, g: gmail tag, s: 'active'|'dead', a: addedAt, u?: upstreamId }.
// - `u` = explicit upstream tag (user-picked when prefix is ambiguous, e.g. DeepSeek/Together sk-... keys).
// - Legacy string[] pools and single er_api_key_<id> migrate automatically.
// Cap: 30 keys per provider, 120 total per master (token header-size guard).

export interface KeyEntry {
  k: string;
  g: string;
  s: "active" | "dead";
  a: number;
  /** Explicit upstream id (e.g. "prov-deepseek"). Set when prefix detection is ambiguous. */
  u?: string;
}

export const MAX_KEYS_PER_PROVIDER = 30;
export const MAX_KEYS_TOTAL = 120;

export const UNIVERSAL_PROVIDER_ID = "Edge Router";

// Legacy provider IDs (purane pools/chains se) — sab universal me merge hote hai.
export const LEGACY_POOL_IDS: string[] = [
  "prov-universal",
  "prov-gemini",
  "prov-groq",
  "prov-openrouter",
  "prov-cerebras",
];

// ---- Canonical upstream registry (frontend mirror — keep in sync with backend tables) ----
export const UPSTREAM_IDS: string[] = [
  "prov-gemini",
  "prov-groq",
  "prov-openrouter",
  "prov-cerebras",
  "prov-openai",
  "prov-anthropic",
  "prov-deepseek",
  "prov-mistral",
  "prov-xai",
  "prov-perplexity",
  "prov-together",
  "prov-fireworks",
  "prov-siliconflow",
  "prov-novita",
  "prov-hyperbolic",
  "prov-chutes",
  "prov-glhf",
  "prov-cohere",
];

export function isKnownUpstream(id: string): boolean {
  return UPSTREAM_IDS.includes(id);
}

// Key prefix se upstream auto-detect (user ko kuch batane ki zaroorat nahi).
// Unique prefixes only — ambiguous `sk-...` style keys stay "unknown" and rely on
// explicit `u` tag (picked in KEYS UI) or model-based routing + try-all relay.
export function detectKeyUpstream(key: string): string {
  const k = (key || "").trim();
  if (/^AIza[0-9A-Za-z\-_]{20,}/.test(k) || /^AQ\.[A-Za-z0-9\-_.]{40,}/.test(k)) return "prov-gemini";
  if (k.startsWith("gsk_")) return "prov-groq";
  if (k.startsWith("sk-or-")) return "prov-openrouter";
  if (k.startsWith("csk-")) return "prov-cerebras";
  if (k.startsWith("sk-proj-") || k.startsWith("sk-svcacct-")) return "prov-openai";
  if (k.startsWith("sk-ant-")) return "prov-anthropic";
  if (k.startsWith("xai-")) return "prov-xai";
  if (k.startsWith("pplx-")) return "prov-perplexity";
  if (k.startsWith("fw_")) return "prov-fireworks";
  if (k.startsWith("glhf_")) return "prov-glhf";
  return "unknown";
}

export const UPSTREAM_NAMES: Record<string, string> = {
  "prov-gemini": "Gemini",
  "prov-groq": "Groq",
  "prov-openrouter": "OpenRouter",
  "prov-cerebras": "Cerebras",
  "prov-openai": "OpenAI",
  "prov-anthropic": "Anthropic",
  "prov-deepseek": "DeepSeek",
  "prov-mistral": "Mistral",
  "prov-xai": "xAI",
  "prov-perplexity": "Perplexity",
  "prov-together": "Together",
  "prov-fireworks": "Fireworks",
  "prov-siliconflow": "SiliconFlow",
  "prov-novita": "Novita",
  "prov-hyperbolic": "Hyperbolic",
  "prov-chutes": "Chutes",
  "prov-glhf": "GLHF",
  "prov-cohere": "Cohere",
  unknown: "?",
};

/** Effective upstream for an entry: explicit tag wins, else prefix detection. */
export function effectiveUpstream(e: KeyEntry | string): string {
  if (typeof e === "string") return detectKeyUpstream(e);
  if (e.u && isKnownUpstream(e.u)) return e.u;
  return detectKeyUpstream(e.k);
}

/** Short stable hash for a key (for health maps — avoids storing raw keys as map keys). */
export function keyId(k: string): string {
  const s = (k || "").trim();
  let h1 = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h1 ^= s.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193) >>> 0;
  }
  return `${s.slice(0, 6)}:${s.length}:${h1.toString(36)}`;
}

// Purani per-provider pools (+ legacy singles) ko universal pool me merge karo.
// Keys + gmail + status + upstream-tag safe rehte hai. Returns merged count.
export function migratePoolsToUniversal(): number {
  try {
    const seen = new Set<string>();
    const merged: KeyEntry[] = [];
    const take = (entries: KeyEntry[]) => {
      entries.forEach((e) => {
        if (e?.k && !seen.has(e.k)) {
          seen.add(e.k);
          merged.push(e);
        }
      });
    };
    take(getProviderKeyEntries(UNIVERSAL_PROVIDER_ID));
    LEGACY_POOL_IDS.forEach((pid) => {
      if (pid === UNIVERSAL_PROVIDER_ID) return;
      take(getProviderKeyEntries(pid));
    });
    // Legacy single slots (bahut purana data)
    ["er_gemini_key"].forEach((slot) => {
      const v = localStorage.getItem(slot);
      if (v && v.trim() && !seen.has(v.trim())) {
        seen.add(v.trim());
        merged.push({ k: v.trim(), g: "", s: "active", a: Date.now() });
      }
    });
    localStorage.setItem(`er_api_keys_${UNIVERSAL_PROVIDER_ID}`, JSON.stringify(merged));
    // Purane pool slots saaf karo (double-count se bachao)
    LEGACY_POOL_IDS.forEach((pid) => {
      if (pid !== UNIVERSAL_PROVIDER_ID) {
        localStorage.removeItem(`er_api_keys_${pid}`);
        localStorage.removeItem(`er_api_key_${pid}`);
      }
    });
    return merged.length;
  } catch {
    return 0;
  }
}

function poolKey(providerId: string): string {
  return `er_api_keys_${providerId}`;
}

function normEntry(v: any): KeyEntry | null {
  if (typeof v === "string" && v.trim()) {
    return { k: v.trim(), g: "", s: "active", a: Date.now() };
  }
  if (v && typeof v.k === "string" && v.k.trim()) {
    const u = typeof v.u === "string" && isKnownUpstream(v.u) ? v.u : undefined;
    return {
      k: v.k.trim(),
      g: typeof v.g === "string" ? v.g.trim() : "",
      s: v.s === "dead" ? "dead" : "active",
      a: typeof v.a === "number" ? v.a : Date.now(),
      ...(u ? { u } : {}),
    };
  }
  return null;
}

export function getProviderKeyEntries(providerId: string): KeyEntry[] {
  try {
    const raw = localStorage.getItem(poolKey(providerId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const out: KeyEntry[] = [];
        parsed.forEach((v) => {
          const e = normEntry(v);
          if (e) out.push(e);
        });
        return out;
      }
    }
    // One-time migration from legacy single-key slot
    const legacy =
      localStorage.getItem(`er_api_key_${providerId}`) ||
      (providerId === "prov-gemini" ? localStorage.getItem("er_gemini_key") : "");
    if (legacy && legacy.trim()) {
      const arr: KeyEntry[] = [{ k: legacy.trim(), g: "", s: "active", a: Date.now() }];
      localStorage.setItem(poolKey(providerId), JSON.stringify(arr));
      return arr;
    }
    return [];
  } catch {
    return [];
  }
}

function saveEntries(providerId: string, entries: KeyEntry[]) {
  localStorage.setItem(poolKey(providerId), JSON.stringify(entries));
  if (providerId === "prov-gemini") {
    const first = entries.find((e) => e.s === "active") || entries[0];
    localStorage.setItem("er_gemini_key", first ? first.k : "");
  }
}

// All key strings in stable pool order (dead included — backend tries + reports,
// which enables self-heal if a dead key works again).
export function getProviderKeys(providerId: string): string[] {
  return getProviderKeyEntries(providerId).map((e) => e.k);
}

export function getAllProviderKeys(providerIds: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  providerIds.forEach((id) => {
    out[id] = getProviderKeys(id);
  });
  return out;
}

/** Parallel upstream hints aligned with getProviderKeys() order (for smart backend routing). */
export function getProviderKeyHints(providerId: string): string[] {
  return getProviderKeyEntries(providerId).map((e) => effectiveUpstream(e));
}

export function isValidGmail(g: string): boolean {
  return /.+@.+\..{2,}/.test((g || "").trim());
}

export function addProviderKey(
  providerId: string,
  key: string,
  gmail = "",
  upstreamTag = ""
): { ok: boolean; error?: string } {
  const k = (key || "").replace(/[\s'"`]+/g, "").trim();
  if (k.length < 10) return { ok: false, error: "Key bahut chhoti hai — full key paste karo" };
  const entries = getProviderKeyEntries(providerId);
  if (entries.length >= MAX_KEYS_PER_PROVIDER) {
    return { ok: false, error: `Max ${MAX_KEYS_PER_PROVIDER} keys per provider` };
  }
  if (entries.some((e) => e.k === k)) return { ok: false, error: "Ye key already added hai" };
  const g = (gmail || "").trim();
  const u = upstreamTag && isKnownUpstream(upstreamTag) ? upstreamTag : undefined;
  entries.push({ k, g: isValidGmail(g) ? g : "", s: "active", a: Date.now(), ...(u ? { u } : {}) });
  try {
    saveEntries(providerId, entries);
  } catch {
    return { ok: false, error: "Save fail ho gaya" };
  }
  return { ok: true };
}

/** Set/change the explicit upstream tag for a key (used when prefix is ambiguous). */
export function setKeyUpstream(providerId: string, index: number, upstreamId: string): boolean {
  try {
    const entries = getProviderKeyEntries(providerId);
    if (!entries[index]) return false;
    if (upstreamId && !isKnownUpstream(upstreamId)) return false;
    entries[index] = { ...entries[index], ...(upstreamId ? { u: upstreamId } : { u: undefined }) };
    if (!upstreamId) delete (entries[index] as any).u;
    saveEntries(providerId, entries);
    return true;
  } catch {
    return false;
  }
}

export function removeProviderKey(providerId: string, index: number): void {
  try {
    const entries = getProviderKeyEntries(providerId);
    entries.splice(index, 1);
    saveEntries(providerId, entries);
  } catch { /* ignore */ }
}

export function setKeyStatus(providerId: string, index: number, status: "active" | "dead"): boolean {
  try {
    const entries = getProviderKeyEntries(providerId);
    if (!entries[index] || entries[index].s === status) return false;
    entries[index] = { ...entries[index], s: status };
    saveEntries(providerId, entries);
    return true;
  } catch {
    return false;
  }
}

// Mark dead by upstream-reported key prefixes (order-independent, robust to pool edits).
// Returns newly-dead entries (for notifications with Gmail tags).
export function markDeadByPrefixes(providerId: string, prefixes: string[]): KeyEntry[] {
  const fresh: KeyEntry[] = [];
  try {
    const entries = getProviderKeyEntries(providerId);
    let changed = false;
    prefixes.forEach((p) => {
      const idx = entries.findIndex((e) => e.s === "active" && e.k.startsWith(p));
      if (idx !== -1) {
        entries[idx] = { ...entries[idx], s: "dead" };
        fresh.push(entries[idx]);
        changed = true;
      }
    });
    if (changed) saveEntries(providerId, entries);
  } catch { /* ignore */ }
  return fresh;
}

export function reviveProviderKey(providerId: string, index: number): boolean {
  return setKeyStatus(providerId, index, "active");
}

export function maskKey(key: string): string {
  if (!key) return "(khali)";
  if (key.length <= 12) return "••••••••";
  return `${key.slice(0, 8)}•••• (${key.length} chars)`;
}

// Canonical snapshot string of pools (for master-key staleness compare).
export function poolsSnapshot(providerIds: string[]): string {
  try {
    const snap: Record<string, { k: string; g: string; u?: string }[]> = {};
    providerIds.forEach((id) => {
      snap[id] = getProviderKeyEntries(id).map((e) => ({ k: e.k, g: e.g, ...(e.u ? { u: e.u } : {}) }));
    });
    return JSON.stringify(snap);
  } catch {
    return "";
  }
}
