// OpenAI-compatible model list — FULLY SELF-CONTAINED (no cross-file imports).
// GET /api/v1/models -> { object: "list", data: [{ id, object: "model", ... }] }.
// External clients (Nexus / OpenCode / Cursor / LibreChat) isi se switch-model list bharte hai.
// Master key (er1.) di to validate hoti hai (invalid/expired -> 401) aur uske
// pools ke upstreams available:true milte hai — Nexus key-check isi pe chalta hai.
import crypto from "node:crypto";
import { inflateSync } from "node:zlib";
import fs from "fs";
import path from "path";

// Vercel: give this function enough wall-clock time for its own internal
// timeouts to fire first, so callers get a real error instead of a platform kill.
export const maxDuration = 20;
export const runtime = "nodejs";

const MASTER_PREFIX = "er1.";

// Master-key secret: never a published constant. Production REQUIRES the env var;
// local dev auto-generates a stable, gitignored, machine-local secret file instead.
const DEV_SECRET_FILE = ".master-key-dev.secret";
function masterSecret(): Buffer {
  const configured = (process.env.MASTER_KEY_SECRET || "").trim();
  if (configured.length >= 16) {
    return crypto.createHash("sha256").update(configured).digest();
  }
  const isProd = process.env.NODE_ENV === "production" || !!process.env.VERCEL;
  if (isProd) {
    const err: any = new Error(
      "MASTER_KEY_SECRET is not configured. Refusing to mint or decrypt master keys with a published fallback secret. Set a random MASTER_KEY_SECRET (16+ chars) in the host environment — generate one with: openssl rand -hex 32",
    );
    err.code = "MASTER_KEY_SECRET_MISSING";
    err.status = 503;
    throw err;
  }
  try {
    const file = path.join(process.cwd(), DEV_SECRET_FILE);
    if (fs.existsSync(file)) {
      const existing = fs.readFileSync(file, "utf8").trim();
      if (existing.length >= 32) return crypto.createHash("sha256").update(existing).digest();
    }
    const generated = crypto.randomBytes(32).toString("hex");
    try { fs.writeFileSync(file, generated + "\n", { mode: 0o600 }); } catch { /* read-only fs */ }
    return crypto.createHash("sha256").update(generated).digest();
  } catch {
    return crypto.createHash("sha256").update(crypto.randomBytes(32)).digest();
  }
}

function tryMasterDecrypt(token: string): { ok: boolean; code?: string; payload?: any; message?: string } {
  try {
    const raw = Buffer.from(token.slice(MASTER_PREFIX.length), "base64url");
    if (raw.length < 29) return { ok: false, code: "BAD_MASTER" };
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(raw.length - 16);
    const ct = raw.subarray(12, raw.length - 16);
    const d = crypto.createDecipheriv("aes-256-gcm", masterSecret(), iv);
    d.setAuthTag(tag);
    const payload = JSON.parse(inflateSync(Buffer.concat([d.update(ct), d.final()])).toString("utf8"));
    if (!payload || payload.v !== 1 || typeof payload.exp !== "number" || typeof payload.keys !== "object") {
      return { ok: false, code: "BAD_MASTER" };
    }
    if (payload.exp <= Date.now()) return { ok: false, code: "EXPIRED" };
    return { ok: true, payload };
  } catch (err: any) {
    // Distinguish a misconfigured server from a genuinely bad token: reporting
    // both as BAD_MASTER sends the operator hunting for a problem in their key.
    if (err?.code === "MASTER_KEY_SECRET_MISSING") {
      return { ok: false, code: "MASTER_KEY_SECRET_MISSING", message: err.message };
    }
    return { ok: false, code: "BAD_MASTER" };
  }
}

function extractMaster(req: any): string {
  const cands = [
    req.headers?.["x-master-key"],
    (() => {
      const h = typeof req.headers?.authorization === "string" ? req.headers.authorization : "";
      const m = h.match(/^Bearer\s*(.*)$/i);
      return m ? m[1] : h;
    })(),
    Array.isArray(req.query?.key) ? req.query.key[0] : req.query?.key,
  ];
  for (const c of cands) {
    if (typeof c === "string" && c.trim().startsWith(MASTER_PREFIX)) return c.trim();
  }
  return "";
}
const UNIVERSAL_MODELS: { id: string; upstream: string }[] = [
  { id: "gemini-flash-latest", upstream: "prov-gemini" },
  { id: "gemini-3.6-flash", upstream: "prov-gemini" },
  { id: "gemini-pro-latest", upstream: "prov-gemini" },
  { id: "gemini-flash-lite-latest", upstream: "prov-gemini" },
  { id: "llama-3.3-70b-versatile", upstream: "prov-groq" },
  { id: "mixtral-8x7b-32768", upstream: "prov-groq" },
  { id: "gemma2-9b-it", upstream: "prov-groq" },
  { id: "llama-3.1-8b-instant", upstream: "prov-groq" },
  { id: "google/gemma-4-31b-it:free", upstream: "prov-openrouter" },
  { id: "nex-agi/nex-n2.5-mini:free", upstream: "prov-openrouter" },
  { id: "liquid/lfm-2.5-2.6b:free", upstream: "prov-openrouter" },
  { id: "llama-3.3-70b", upstream: "prov-cerebras" },
  { id: "llama3.1-8b", upstream: "prov-cerebras" },
  { id: "gpt-4o-mini", upstream: "prov-openai" },
  { id: "gpt-4o", upstream: "prov-openai" },
  { id: "o1-mini", upstream: "prov-openai" },
  { id: "claude-3-5-haiku-latest", upstream: "prov-anthropic" },
  { id: "claude-3-5-sonnet-latest", upstream: "prov-anthropic" },
  { id: "deepseek-chat", upstream: "prov-deepseek" },
  { id: "deepseek-reasoner", upstream: "prov-deepseek" },
  { id: "mistral-small-latest", upstream: "prov-mistral" },
  { id: "open-mistral-7b", upstream: "prov-mistral" },
  { id: "grok-3-mini", upstream: "prov-xai" },
  { id: "sonar", upstream: "prov-perplexity" },
  { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", upstream: "prov-together" },
  { id: "accounts/fireworks/models/llama-v3p1-8b-instruct", upstream: "prov-fireworks" },
  { id: "Qwen/Qwen2.5-7B-Instruct", upstream: "prov-siliconflow" },
  { id: "meta-llama/llama-3.1-8b-instruct", upstream: "prov-novita" },
  { id: "meta-llama/Meta-Llama-3.1-8B-Instruct", upstream: "prov-hyperbolic" },
  { id: "deepseek-ai/DeepSeek-V3", upstream: "prov-chutes" },
  { id: "hf:meta-llama/Llama-3.3-70B-Instruct", upstream: "prov-glhf" },
  { id: "command-r-plus", upstream: "prov-cohere" },
  { id: "glm-4-flash", upstream: "prov-zhipu" },
  { id: "qwen-turbo", upstream: "prov-qwen" },
  { id: "kimi-k2-0711-preview", upstream: "prov-moonshot" },
  { id: "openai/gpt-4o-mini", upstream: "prov-githubmodels" },
  { id: "meta-llama/Llama-3.3-70B-Instruct", upstream: "prov-huggingface" },
  { id: "Meta-Llama-3.3-70B-Instruct", upstream: "prov-sambanova" },
  { id: "Qwen/Qwen2.5-72B-Instruct", upstream: "prov-nebius" },
  { id: "openai", upstream: "prov-pollinations" },
];

// ---------------------------------------------------------------------------
// WHAT COUNTS AS "FREE"
// ---------------------------------------------------------------------------
// Evidence tiers, strongest first:
//
//   live    The provider publishes per-model pricing in its own /models payload
//           (OpenRouter). We trust the provider rather than asserting anything.
//   keyless The service needs no key at all and is free by design (Pollinations).
//   all     The provider's free tier covers every model a key unlocks (Google AI
//           Studio, Groq, GitHub Models, Cerebras, SambaNova, HuggingFace router).
//   ids     Only specific models are free on that provider (Zhipu's glm-4-flash).
//
// Deliberate bias: when unsure we say PAID. Claiming a model is free when it is
// not costs the user real money; hiding a genuinely free model only costs them
// the chance to pick it. The `all`/`ids` tiers are provider documentation as of
// 2026-09 and can drift as providers change their tiers - which is why the
// `live` tier always wins wherever a provider supplies pricing.
//
// A model id ending in ":free" (the OpenRouter convention) is free regardless of
// which upstream serves it.
type FreePolicy = { kind: "keyless" | "all" | "live" | "ids"; patterns?: RegExp[] };

const FREE_POLICY: Record<string, FreePolicy> = {
  "prov-pollinations": { kind: "keyless" },
  "prov-openrouter": { kind: "live" },
  "prov-gemini": { kind: "all" },
  "prov-groq": { kind: "all" },
  "prov-githubmodels": { kind: "all" },
  "prov-cerebras": { kind: "all" },
  "prov-sambanova": { kind: "all" },
  "prov-huggingface": { kind: "all" },
  "prov-zhipu": { kind: "ids", patterns: [/^glm-4-flash/i, /^glm-4-air/i, /^glm-4\.5-air/i] },
  "prov-siliconflow": { kind: "ids", patterns: [/^Qwen\/Qwen2\.5-7B-Instruct$/i] },
};

const KEYLESS_UPSTREAMS = Object.keys(FREE_POLICY).filter((u) => FREE_POLICY[u].kind === "keyless");

/** Classify one model. `liveFree` comes from the provider's own pricing payload. */
function isFreeModel(upstream: string, id: string, liveFree?: boolean): boolean {
  if (/:free$/i.test(id)) return true;            // OpenRouter convention, any upstream
  if (liveFree === true) return true;             // provider said so - strongest evidence
  if (liveFree === false) return false;           // provider said it costs money
  const pol = FREE_POLICY[upstream];
  if (!pol) return false;                         // no policy -> assume paid
  if (pol.kind === "keyless" || pol.kind === "all") return true;
  if (pol.kind === "ids") return (pol.patterns || []).some((re) => re.test(id));
  return false;                                   // "live" with no pricing data -> unknown -> paid
}

// ---------------------------------------------------------------------------
// LIVE SYNC - the point of the whole exercise
// ---------------------------------------------------------------------------
// A static list goes stale the day a provider renames a model. When the caller
// presents a master key we can see which upstreams they hold keys for, so we ask
// each of those upstreams for its real model list and classify from that.
//
// Kept in sync with api/catalog/sync.ts by hand: this project's api/ functions
// are deliberately self-contained (no cross-file imports), so the endpoint table
// is duplicated rather than shared. Change one, change the other.
const LIVE_MODELS_URLS: Record<string, string> = {
  "prov-openai": "https://api.openai.com/v1/models",
  "prov-deepseek": "https://api.deepseek.com/v1/models",
  "prov-mistral": "https://api.mistral.ai/v1/models",
  "prov-xai": "https://api.x.ai/v1/models",
  "prov-together": "https://api.together.xyz/v1/models",
  "prov-fireworks": "https://api.fireworks.ai/inference/v1/models",
  "prov-siliconflow": "https://api.siliconflow.cn/v1/models",
  "prov-novita": "https://api.novita.ai/v3/openai/models",
  "prov-hyperbolic": "https://api.hyperbolic.xyz/v1/models",
  "prov-chutes": "https://llm.chutes.ai/v1/models",
  "prov-glhf": "https://glhf.chat/api/openai/v1/models",
  "prov-cohere": "https://api.cohere.ai/compatibility/v1/models",
  "prov-zhipu": "https://open.bigmodel.cn/api/paas/v4/models",
  "prov-qwen": "https://dashscope.aliyuncs.com/compatible-mode/v1/models",
  "prov-moonshot": "https://api.moonshot.cn/v1/models",
  "prov-githubmodels": "https://models.github.ai/inference/models",
  "prov-huggingface": "https://router.huggingface.co/v1/models",
  "prov-sambanova": "https://api.sambanova.ai/v1/models",
  "prov-nebius": "https://api.studio.nebius.com/v1/models",
  "prov-deepinfra": "https://api.deepinfra.com/v1/openai/models",
  "prov-pollinations": "https://text.pollinations.ai/openai/models",
  "prov-groq": "https://api.groq.com/openai/v1/models",
  "prov-cerebras": "https://api.cerebras.ai/v1/models",
  "prov-openrouter": "https://openrouter.ai/api/v1/models",
};

const LIVE_TIMEOUT_MS = 6000;
const LIVE_MAX_PER_UPSTREAM = 150;
// Non-chat models are noise in a coding agent's picker, and OpenCode drops
// embedding/rerank entries itself. Filtering here keeps the list honest.
const NON_CHAT_RE = /embedding|rerank|whisper|\btts\b|transcribe|guard|moderation|dall-e|image|video|audio|veo|lyria|bidi|live-|deep-research/i;

type LiveRow = { id: string; name: string; upstream: string; free: boolean; source: "live" | "policy" };
type SyncOutcome = { ok: string[]; failed: string[] };

async function liveFetch(url: string, headers: Record<string, string>): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), LIVE_TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

/** Ask one upstream for its real model list. Never throws - failure is data. */
async function syncUpstream(upstream: string, key: string): Promise<LiveRow[] | null> {
  try {
    // Gemini has its own shape and needs the key in the query string.
    if (upstream === "prov-gemini") {
      if (!key) return null;
      const j: any = await liveFetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=100`,
        {},
      );
      const out: LiveRow[] = [];
      for (const m of Array.isArray(j?.models) ? j.models : []) {
        const id = typeof m?.name === "string" ? m.name.replace(/^models\//, "") : "";
        const methods: string[] = Array.isArray(m?.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
        if (!id || !methods.includes("generateContent") || NON_CHAT_RE.test(id)) continue;
        out.push({ id, name: id, upstream, free: isFreeModel(upstream, id), source: "live" });
        if (out.length >= LIVE_MAX_PER_UPSTREAM) break;
      }
      return out;
    }

    // OpenRouter is keyless and returns real pricing - the strongest free signal
    // available anywhere in this system.
    if (upstream === "prov-openrouter") {
      const j: any = await liveFetch(LIVE_MODELS_URLS[upstream], {});
      const out: LiveRow[] = [];
      for (const m of Array.isArray(j?.data) ? j.data : []) {
        const id = typeof m?.id === "string" ? m.id : "";
        if (!id || NON_CHAT_RE.test(id)) continue;
        const mods: string[] = Array.isArray(m?.architecture?.output_modalities) ? m.architecture.output_modalities : [];
        if (mods.length > 0 && !mods.includes("text")) continue;
        const pr = m?.pricing;
        let liveFree: boolean | undefined;
        if (pr && typeof pr === "object") {
          const pp = Number((pr as any).prompt);
          const pc = Number((pr as any).completion);
          liveFree = Number.isFinite(pp) && Number.isFinite(pc) && pp === 0 && pc === 0;
        }
        if (!isFreeModel(upstream, id, liveFree)) continue;   // free-only: skip paid here
        out.push({
          id,
          name: typeof m?.name === "string" && m.name ? m.name : id,
          upstream,
          free: true,
          source: "live",
        });
        if (out.length >= LIVE_MAX_PER_UPSTREAM) break;
      }
      return out;
    }

    const url = LIVE_MODELS_URLS[upstream];
    if (!url) return null;
    const needsKey = !KEYLESS_UPSTREAMS.includes(upstream);
    if (needsKey && !key) return null;
    const j: any = await liveFetch(url, key ? { Authorization: `Bearer ${key}` } : {});
    const arr = Array.isArray(j?.data) ? j.data : Array.isArray(j?.models) ? j.models : [];
    const out: LiveRow[] = [];
    for (const m of arr) {
      const id = typeof m?.id === "string" ? m.id : typeof m?.name === "string" ? m.name : typeof m === "string" ? m : "";
      if (!id || NON_CHAT_RE.test(id)) continue;
      out.push({ id, name: id, upstream, free: isFreeModel(upstream, id), source: "live" });
      if (out.length >= LIVE_MAX_PER_UPSTREAM) break;
    }
    return out;
  } catch {
    return null;   // one provider being down must not empty the whole list
  }
}

// In-memory TTL cache. On serverless this is per warm instance, so it blunts
// repeated discovery (OpenCode fetches on startup and re-syncs daily) rather
// than eliminating upstream calls. Keyed by a hash - the master key itself is
// never stored.
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;
const liveCache = new Map<string, { at: number; rows: LiveRow[]; outcome: SyncOutcome }>();

function cacheKeyFor(masterTok: string): string {
  return crypto.createHash("sha256").update(masterTok).digest("hex").slice(0, 32);
}

/** First usable key per provider in a decrypted master payload. */
function firstKeyPerPool(payload: any): Record<string, string> {
  const out: Record<string, string> = {};
  const pools = payload?.keys && typeof payload.keys === "object" ? payload.keys : {};
  for (const pid of Object.keys(pools)) {
    const arr = pools[pid];
    if (!Array.isArray(arr)) continue;
    const hit = arr.find((e: any) => typeof e?.k === "string" && e.k.trim().length >= 10)
      || arr.find((e: any) => typeof e === "string" && e.trim().length >= 10);
    const k = typeof hit === "string" ? hit : hit?.k;
    if (typeof k === "string" && k.trim()) out[pid] = k.trim();
  }
  return out;
}

async function liveCatalog(masterTok: string, payload: any): Promise<{ rows: LiveRow[]; outcome: SyncOutcome; cached: boolean }> {
  const ck = cacheKeyFor(masterTok);
  const now = Date.now();
  const hit = liveCache.get(ck);
  if (hit && now - hit.at < CACHE_TTL_MS) return { rows: hit.rows, outcome: hit.outcome, cached: true };
  if (liveCache.size > CACHE_MAX) {
    for (const [k, v] of liveCache) if (now - v.at >= CACHE_TTL_MS) liveCache.delete(k);
  }

  const pools = firstKeyPerPool(payload);
  // Always probe the keyless providers too: they are free for everyone and cost
  // the user nothing to have available.
  const targets = new Set<string>([...Object.keys(pools), ...KEYLESS_UPSTREAMS, "prov-openrouter"]);
  const names = [...targets];
  const results = await Promise.allSettled(names.map((u) => syncUpstream(u, pools[u] || "")));

  const rows: LiveRow[] = [];
  const ok: string[] = [];
  const failed: string[] = [];
  results.forEach((r, i) => {
    const got = r.status === "fulfilled" ? r.value : null;
    if (got && got.length > 0) { ok.push(names[i]); rows.push(...got); } else { failed.push(names[i]); }
  });

  const entry = { at: now, rows, outcome: { ok, failed } };
  try { liveCache.set(ck, entry); } catch { /* read-only fs / memory pressure */ }
  return { rows, outcome: entry.outcome, cached: false };
}

function upstreamOfKey(k: string): string {
  const key = (k || "").trim();
  if (/^AIza[0-9A-Za-z\-_]{20,}/.test(key) || /^AQ\.[A-Za-z0-9\-_.]{40,}/.test(key)) return "prov-gemini";
  if (key.startsWith("gsk_")) return "prov-groq";
  if (key.startsWith("sk-or-")) return "prov-openrouter";
  if (key.startsWith("csk-")) return "prov-cerebras";
  if (key.startsWith("sk-proj-") || key.startsWith("sk-svcacct-")) return "prov-openai";
  if (key.startsWith("sk-ant-")) return "prov-anthropic";
  if (key.startsWith("xai-")) return "prov-xai";
  if (key.startsWith("pplx-")) return "prov-perplexity";
  if (key.startsWith("fw_")) return "prov-fireworks";
  if (key.startsWith("glhf_")) return "prov-glhf";
  if (key.startsWith("ghp_") || key.startsWith("github_pat_") || key.startsWith("gho_")) return "prov-githubmodels";
  if (key.startsWith("hf_")) return "prov-huggingface";
  if (key === "pollinations-free-tier" || key.startsWith("pollinations-")) return "prov-pollinations";
  return "unknown";
}

// Optional personalization: Bearer/direct/?key= key bhejoge to har model pe
// available:true/false lag jayega (tumhari keys ke hisaab se). Bina key: flag nahi.
function callerUpstreams(req: any): Set<string> | null {
  const found: string[] = [];
  const push = (v: any) => {
    if (typeof v !== "string") return;
    const t = v.trim();
    if (!t || t.toLowerCase() === "bearer" || t.startsWith("er1.")) return;
    found.push(t);
  };
  push(req.headers?.["x-api-key"]);
  push(req.headers?.["x-gemini-key"]);
  const h = typeof req.headers?.authorization === "string" ? req.headers.authorization : "";
  const m = h.match(/^Bearer\s*(.*)$/i);
  push(m ? m[1] : h);
  const q = req.query?.key;
  if (Array.isArray(q)) q.forEach(push);
  else push(q);
  if (found.length === 0) return null;
  return new Set(found.map(upstreamOfKey));
}

function truthy(v: any): boolean {
  const t = Array.isArray(v) ? v[0] : v;
  return typeof t === "string" && ["1", "true", "yes", "on"].includes(t.trim().toLowerCase());
}
function falsy(v: any): boolean {
  const t = Array.isArray(v) ? v[0] : v;
  return typeof t === "string" && ["0", "false", "no", "off"].includes(t.trim().toLowerCase());
}

// Free-only is the DEFAULT, because that is what this gateway is for: coding
// agents pointed at it should see models that cost nothing. `?all=true` (or
// `?free=false`) opts back out to the full catalogue.
function wantsEverything(q: any): boolean {
  return truthy(q?.all) || falsy(q?.free);
}

type Row = {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
  name: string;
  upstream: string;
  gateway: string;
  free: boolean;
  source: "live" | "policy" | "seed";
  available?: boolean;
};

function seedRows(availableSet: Set<string> | null, created: number): Row[] {
  return UNIVERSAL_MODELS.map((m) => ({
    id: m.id,
    object: "model" as const,
    created,
    owned_by: "edge-router",
    name: m.id,
    upstream: m.upstream,
    gateway: "Edge Router",
    free: isFreeModel(m.upstream, m.id),
    source: "policy" as const,
    ...(availableSet ? { available: availableSet.has(m.upstream) } : {}),
  }));
}

function diagnostics(res: any, opts: { freeOnly: boolean; cached: boolean; outcome?: SyncOutcome; mode: string }) {
  try {
    res.setHeader?.("X-Edge-Free-Only", opts.freeOnly ? "true" : "false");
    res.setHeader?.("X-Edge-Source", opts.mode);
    if (opts.outcome) {
      res.setHeader?.("X-Edge-Sync-Ok", opts.outcome.ok.join(",") || "none");
      res.setHeader?.("X-Edge-Sync-Failed", opts.outcome.failed.join(",") || "none");
      res.setHeader?.("X-Edge-Cache", opts.cached ? "hit" : "miss");
    }
  } catch { /* headers are best-effort diagnostics only */ }
}

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: { message: "Method not allowed", type: "invalid_request_error" } });
  }
  const created = Math.floor(Date.now() / 1000);
  const freeOnly = !wantsEverything(req.query);
  const ups = callerUpstreams(req);
  const masterTok = extractMaster(req);

  // ---- With a master key: we know the caller's pools, so ask those upstreams.
  if (masterTok) {
    const chk = tryMasterDecrypt(masterTok);
    if (!chk.ok) {
      if (chk.code === "MASTER_KEY_SECRET_MISSING") {
        return res.status(503).json({
          error: { message: chk.message, type: "server_misconfigured", code: chk.code },
        });
      }
      return res.status(401).json({
        error: {
          message: chk.code === "EXPIRED" ? "Master key expire ho gayi — Regenerate karo." : "Master key invalid hai.",
          type: "authentication_error",
        },
      });
    }

    const pools = chk.payload.keys && typeof chk.payload.keys === "object" ? chk.payload.keys : {};
    const availableSet = ups || new Set<string>();
    Object.keys(pools).forEach((pid) => {
      const arr = pools[pid];
      if (Array.isArray(arr) && arr.length > 0) availableSet.add(pid);
    });

    const { rows: live, outcome, cached } = await liveCatalog(masterTok, chk.payload);

    // Live results win. For any upstream the caller holds keys for but that did
    // not answer (down, no /models endpoint, non-OpenAI shape), fall back to the
    // bundled seed so the list never silently loses a provider.
    const liveUps = new Set(live.map((r) => r.upstream));
    const fallback = seedRows(availableSet, created).filter(
      (r) => !liveUps.has(r.upstream) && availableSet.has(r.upstream),
    );

    const rows: Row[] = [
      ...live.map((r) => ({
        id: r.id,
        object: "model" as const,
        created,
        owned_by: "edge-router",
        name: r.name || r.id,
        upstream: r.upstream,
        gateway: "Edge Router",
        free: r.free,
        source: r.source,
        available: availableSet.has(r.upstream) || KEYLESS_UPSTREAMS.includes(r.upstream),
      })),
      ...fallback,
    ];

    // Deduplicate by id+upstream; live entries were pushed first so they win.
    const seen = new Set<string>();
    const deduped = rows.filter((r) => {
      const k = `${r.upstream}:${r.id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // "free AND available" - a free model on an upstream you hold no key for is
    // not something a coding agent can actually call.
    const out = freeOnly ? deduped.filter((r) => r.free && r.available !== false) : deduped;
    diagnostics(res, { freeOnly, cached, outcome, mode: "master-key" });
    return res.json({ object: "list", data: out });
  }

  // ---- No master key: we cannot know what the caller can use, so report the
  // free catalogue from the keyless providers plus the seed, without an
  // `available` flag (matching the previous behaviour for anonymous callers).
  let live: LiveRow[] = [];
  let outcome: SyncOutcome | undefined;
  let cached = false;
  try {
    const anon = await Promise.allSettled(
      [...KEYLESS_UPSTREAMS, "prov-openrouter"].map((u) => syncUpstream(u, "")),
    );
    const ok: string[] = [];
    const failed: string[] = [];
    const names = [...new Set([...KEYLESS_UPSTREAMS, "prov-openrouter"])];
    anon.forEach((r, i) => {
      const got = r.status === "fulfilled" ? r.value : null;
      if (got && got.length > 0) { ok.push(names[i]); live.push(...got); } else { failed.push(names[i]); }
    });
    outcome = { ok, failed };
  } catch { /* anonymous live sync is best-effort */ }

  const liveUps = new Set(live.map((r) => r.upstream));
  const rows: Row[] = [
    ...live.map((r) => ({
      id: r.id,
      object: "model" as const,
      created,
      owned_by: "edge-router",
      name: r.name || r.id,
      upstream: r.upstream,
      gateway: "Edge Router",
      free: r.free,
      source: r.source,
    })),
    ...seedRows(null, created).filter((r) => !liveUps.has(r.upstream)),
  ];
  const seen = new Set<string>();
  const deduped = rows.filter((r) => {
    const k = `${r.upstream}:${r.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const out = freeOnly ? deduped.filter((r) => r.free) : deduped;
  diagnostics(res, { freeOnly, cached, outcome, mode: "anonymous" });
  return res.json({ object: "list", data: out });
}
