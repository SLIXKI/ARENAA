// Live model catalog: provider /models fan-out results, cached locally.
// Sync: login + har 6h + manual button. Diff -> added/removed notifications.
import { notify } from "./notify";
import { getProviderKeyEntries, effectiveUpstream, UPSTREAM_IDS } from "./providerKeys";

export interface LiveModel {
  id: string;
  name: string;
  upstream: string;
  free?: boolean;
}

export interface LiveCatalog {
  syncedAt: number;
  models: LiveModel[];
  perUpstream: Record<string, { ok: boolean; count: number; error?: string }>;
}

const CATALOG_KEY = "er_live_catalog";
const MODEL_STATUS_KEY = "er_model_status";
export const CATALOG_INTERVAL_MS = 6 * 3600 * 1000;

export function loadLiveCatalog(): LiveCatalog | null {
  try {
    const raw = localStorage.getItem(CATALOG_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (!c || !Array.isArray(c.models)) return null;
    return c as LiveCatalog;
  } catch {
    return null;
  }
}

export function saveLiveCatalog(c: LiveCatalog) {
  try {
    localStorage.setItem(CATALOG_KEY, JSON.stringify(c));
  } catch { /* ignore */ }
}

export function diffCatalog(
  oldC: LiveCatalog | null,
  fresh: LiveModel[]
): { added: LiveModel[]; removed: LiveModel[] } {
  const oldIds = new Set((oldC?.models || []).map((m) => `${m.upstream}::${m.id}`));
  const freshIds = new Set(fresh.map((m) => `${m.upstream}::${m.id}`));
  return {
    added: fresh.filter((m) => !oldIds.has(`${m.upstream}::${m.id}`)),
    removed: (oldC?.models || []).filter((m) => !freshIds.has(`${m.upstream}::${m.id}`)),
  };
}

// ---- Per-model working status (verified live / failed) ----
export type ModelState = "ok" | "failed";

export function getModelStatus(): Record<string, { state: ModelState; ts: number }> {
  try {
    const raw = localStorage.getItem(MODEL_STATUS_KEY);
    const p = raw ? JSON.parse(raw) : {};
    return p && typeof p === "object" ? p : {};
  } catch {
    return {};
  }
}

function setModelStatus(id: string, state: ModelState) {
  try {
    const all = getModelStatus();
    all[id] = { state, ts: Date.now() };
    const keys = Object.keys(all).slice(-300);
    const pruned: Record<string, { state: ModelState; ts: number }> = {};
    keys.forEach((k) => {
      pruned[k] = all[k];
    });
    localStorage.setItem(MODEL_STATUS_KEY, JSON.stringify(pruned));
  } catch { /* ignore */ }
}

export function markModelOk(id: string) {
  setModelStatus(id, "ok");
}

export function markModelFailed(id: string) {
  setModelStatus(id, "failed");
}

// Model-existence failures only (quota/auth yaha kabhi nahi — wo keys pe lagta hai).
export function isModelGoneError(message: string): boolean {
  return /model.*not.?found|not.?found.*model|does not exist|unknown model|invalid model|no endpoints enabled for model/i.test(
    message || ""
  );
}

// ---- Sync runner (auto + manual dono yahi call karte hai) ----
export async function runCatalogSync(providerIds: string[]): Promise<LiveCatalog | null> {
  const pools: Record<string, string[]> = {};
  try {
    providerIds.forEach((pid) => {
      const live = getProviderKeyEntries(pid)
        .filter((e) => e.s === "active")
        .map((e) => e.k);
      if (live.length > 0) pools[pid] = live;
    });
  } catch { /* ignore */ }

  // Pools ko upstream-wise batch karo (sync endpoint first-active-key use karta hai).
  // Grouping = explicit tag `u` first, else prefix detect (covers all 18 upstreams).
  const byUpstream: Record<string, string[]> = {};
  UPSTREAM_IDS.forEach((up) => {
    byUpstream[up.replace(/^prov-/, "")] = [];
  });
  try {
    providerIds.forEach((pid) => {
      getProviderKeyEntries(pid)
        .filter((e) => e.s === "active")
        .forEach((e) => {
          const up = effectiveUpstream(e);
          const short = up.replace(/^prov-/, "");
          if (byUpstream[short] && byUpstream[short].length < 2) byUpstream[short].push(e.k);
        });
    });
  } catch { /* ignore */ }

  let res: Response;
  try {
    res = await fetch("/api/catalog/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys: byUpstream }),
    });
  } catch {
    notify("error", "Catalog sync fail", "Network error — dobara try karo.");
    return null;
  }
  const data: any = await res.json().catch(() => null);
  if (!res.ok || !data || !Array.isArray(data.models)) {
    notify("error", "Catalog sync fail", data?.error || `HTTP ${res.status}`);
    return null;
  }

  const fresh: LiveCatalog = {
    syncedAt: data.syncedAt || Date.now(),
    models: data.models.filter((m: any) => m && typeof m.id === "string"),
    perUpstream: data.perUpstream || {},
  };
  const old = loadLiveCatalog();
  const { added, removed } = diffCatalog(old, fresh.models);
  saveLiveCatalog(fresh);

  if (!old) {
    notify("success", `Catalog live: ${fresh.models.length} models`, "Providers se fresh list aa gayi.");
  } else if (added.length > 0 || removed.length > 0) {
    const bits: string[] = [];
    if (added.length > 0) {
      bits.push(`${added.length} naye: ${added.slice(0, 5).map((m) => m.id).join(", ")}${added.length > 5 ? "…" : ""}`);
    }
    if (removed.length > 0) {
      bits.push(`${removed.length} hate: ${removed.slice(0, 5).map((m) => m.id).join(", ")}${removed.length > 5 ? "…" : ""}`);
    }
    notify("warn", "Catalog badla", bits.join(" • "));
  } else {
    notify("info", "Catalog fresh", `${fresh.models.length} models — koi add/remove nahi.`);
  }
  return fresh;
}

export interface ResolvedModel {
  id: string;
  upstream: string;
  free?: boolean;
  /** True when this id came from a real /models response rather than the seed list. */
  live: boolean;
}

export interface ResolvedCatalog {
  models: ResolvedModel[];
  /** True when at least some entries came from a live provider sync. */
  live: boolean;
  syncedAt: number;
  /** Seed ids no live catalog confirmed — kept, but flagged so the UI can say so. */
  unverifiedCount: number;
}

/**
 * The model list is catalog-driven, with the bundled seed only as a bootstrap.
 *
 * A hardcoded model list goes stale the moment a provider renames or retires
 * something, and there is no way to know from the source which ids are still
 * real. So: prefer ids confirmed by an actual /models response, keep the seed as
 * a fallback so the app works before the first sync, and report provenance so the
 * UI can distinguish "live" from "bundled, unverified" instead of asserting
 * availability it has not checked.
 */
export function resolveModelCatalog(seed: string[], seedUpstream: (id: string) => string | null): ResolvedCatalog {
  const cat = loadLiveCatalog();
  const byId = new Map<string, ResolvedModel>();

  // Seed first, so live entries win on collision.
  for (const id of seed) {
    byId.set(id, { id, upstream: seedUpstream(id) || "unknown", live: false });
  }
  if (cat && Array.isArray(cat.models)) {
    for (const m of cat.models) {
      if (!m?.id) continue;
      byId.set(m.id, { id: m.id, upstream: m.upstream || seedUpstream(m.id) || "unknown", free: m.free, live: true });
    }
  }

  const models = Array.from(byId.values());
  const liveCount = models.filter((m) => m.live).length;
  return {
    models,
    live: liveCount > 0,
    syncedAt: cat?.syncedAt || 0,
    unverifiedCount: models.length - liveCount,
  };
}
