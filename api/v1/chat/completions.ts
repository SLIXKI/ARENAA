// Universal gateway — ONE provider, model naam se auto-route. FULLY SELF-CONTAINED.
// Body: { model, messages, max_tokens?, temperature?, apiKeys?/clientApiKey?, keyUpstreams?, keyBases?, keyModels? } (+ legacy providerId/baseUrl tolerated).
// Keys: master key (er1...) OR x-api-key header OR Authorization Bearer OR body key(s).
// Har key ka upstream prefix se auto-detect (+ explicit hint); model ke hisaab se smart order;
// 429-cooldown + fail-stats + LRU rotation — rate limit kabhi na lage. Dead-report only on sure 401/403.
// SSRF guard: catalog hosts + public-https-only custom hosts.
import crypto from "node:crypto";
import { inflateSync } from "node:zlib";

const MASTER_PREFIX = "er1.";
const UNIVERSAL_ID = "Edge Router";

function masterSecret(): Buffer {
  return crypto
    .createHash("sha256")
    .update(process.env.MASTER_KEY_SECRET || "er-dev-fallback-secret-v1-do-not-use-in-prod")
    .digest();
}

function masterDecrypt(token: string): any {
  if (typeof token !== "string" || !token.startsWith(MASTER_PREFIX)) {
    const e: any = new Error("not-a-master-key");
    e.code = "NOT_MASTER";
    throw e;
  }
  let payload: any;
  try {
    const raw = Buffer.from(token.slice(MASTER_PREFIX.length), "base64url");
    if (raw.length < 29) throw new Error("bad");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(raw.length - 16);
    const ct = raw.subarray(12, raw.length - 16);
    const d = crypto.createDecipheriv("aes-256-gcm", masterSecret(), iv);
    d.setAuthTag(tag);
    payload = JSON.parse(inflateSync(Buffer.concat([d.update(ct), d.final()])).toString("utf8"));
  } catch (err: any) {
    if (err?.code === "NOT_MASTER") throw err;
    const e: any = new Error("bad-master-key");
    e.code = "BAD_MASTER";
    throw e;
  }
  if (!payload || payload.v !== 1 || typeof payload.exp !== "number" || typeof payload.keys !== "object") {
    const e: any = new Error("bad-master-key");
    e.code = "BAD_MASTER";
    throw e;
  }
  if (payload.exp <= Date.now()) {
    const e: any = new Error("master-key-expired");
    e.code = "EXPIRED";
    throw e;
  }
  return payload;
}

// Revoked-master check (KV). Missing KV / errors => fail-open (allow), logged.
async function isMasterRevoked(mid: string): Promise<boolean> {
  const url = process.env.KV_REST_API_URL;
  const tok = process.env.KV_REST_API_TOKEN;
  if (!url || !tok || !mid) return false;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify(["GET", `er:revoked:${mid}`]),
      signal: ctl.signal,
    });
    clearTimeout(t);
    const j: any = await r.json().catch(() => null);
    return j?.result === "1";
  } catch (e) {
    console.warn("KV GET fail-open:", (e as any)?.message || e);
    return false;
  }
}

const UPSTREAMS: Record<string, { name: string; baseUrl: string; defaultModel: string; native?: string }> = {
  "prov-gemini": { name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", defaultModel: "gemini-flash-latest" },
  "prov-groq": { name: "Groq", baseUrl: "https://api.groq.com/openai/v1", defaultModel: "llama-3.3-70b-versatile" },
  "prov-openrouter": { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", defaultModel: "google/gemma-4-31b-it:free" },
  "prov-cerebras": { name: "Cerebras", baseUrl: "https://api.cerebras.ai/v1", defaultModel: "llama-3.3-70b" },
  "prov-openai": { name: "OpenAI", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini" },
  "prov-anthropic": { name: "Anthropic", baseUrl: "https://api.anthropic.com/v1", defaultModel: "claude-3-5-haiku-latest", native: "anthropic" },
  "prov-deepseek": { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat" },
  "prov-mistral": { name: "Mistral", baseUrl: "https://api.mistral.ai/v1", defaultModel: "mistral-small-latest" },
  "prov-xai": { name: "xAI", baseUrl: "https://api.x.ai/v1", defaultModel: "grok-3-mini" },
  "prov-perplexity": { name: "Perplexity", baseUrl: "https://api.perplexity.ai", defaultModel: "sonar" },
  "prov-together": { name: "Together", baseUrl: "https://api.together.xyz/v1", defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
  "prov-fireworks": { name: "Fireworks", baseUrl: "https://api.fireworks.ai/inference/v1", defaultModel: "accounts/fireworks/models/llama-v3p1-8b-instruct" },
  "prov-siliconflow": { name: "SiliconFlow", baseUrl: "https://api.siliconflow.cn/v1", defaultModel: "Qwen/Qwen2.5-7B-Instruct" },
  "prov-novita": { name: "Novita", baseUrl: "https://api.novita.ai/v3/openai", defaultModel: "meta-llama/llama-3.1-8b-instruct" },
  "prov-hyperbolic": { name: "Hyperbolic", baseUrl: "https://api.hyperbolic.xyz/v1", defaultModel: "meta-llama/Meta-Llama-3.1-8B-Instruct" },
  "prov-chutes": { name: "Chutes", baseUrl: "https://llm.chutes.ai/v1", defaultModel: "deepseek-ai/DeepSeek-V3" },
  "prov-glhf": { name: "GLHF", baseUrl: "https://glhf.chat/api/openai/v1", defaultModel: "hf:meta-llama/Llama-3.3-70B-Instruct" },
  "prov-cohere": { name: "Cohere", baseUrl: "https://api.cohere.ai/compatibility/v1", defaultModel: "command-r-plus" },
};

const KNOWN_UPSTREAMS = new Set(Object.keys(UPSTREAMS));

const UPSTREAM_PRIORITY = [
  "prov-gemini", "prov-groq", "prov-cerebras", "prov-openrouter",
  "prov-deepseek", "prov-mistral", "prov-together", "prov-fireworks",
  "prov-siliconflow", "prov-novita", "prov-hyperbolic", "prov-chutes",
  "prov-glhf", "prov-openai", "prov-anthropic", "prov-xai",
  "prov-perplexity", "prov-cohere",
];

const MODEL_UPSTREAM: Record<string, string> = {
  "gemini-flash-latest": "prov-gemini",
  "gemini-3.6-flash": "prov-gemini",
  "gemini-pro-latest": "prov-gemini",
  "gemini-flash-lite-latest": "prov-gemini",
  "llama-3.3-70b-versatile": "prov-groq",
  "mixtral-8x7b-32768": "prov-groq",
  "gemma2-9b-it": "prov-groq",
  "llama-3.1-8b-instant": "prov-groq",
  "google/gemma-4-31b-it:free": "prov-openrouter",
  "nex-agi/nex-n2.5-mini:free": "prov-openrouter",
  "liquid/lfm-2.5-2.6b:free": "prov-openrouter",
  "llama-3.3-70b": "prov-cerebras",
  "llama3.1-8b": "prov-cerebras",
  "gpt-4o-mini": "prov-openai",
  "gpt-4o": "prov-openai",
  "gpt-4.1-mini": "prov-openai",
  "gpt-4.1": "prov-openai",
  "o1-mini": "prov-openai",
  "o3-mini": "prov-openai",
  "chatgpt-4o-latest": "prov-openai",
  "claude-3-5-haiku-latest": "prov-anthropic",
  "claude-3-5-sonnet-latest": "prov-anthropic",
  "claude-3-haiku-20240307": "prov-anthropic",
  "deepseek-chat": "prov-deepseek",
  "deepseek-reasoner": "prov-deepseek",
  "mistral-small-latest": "prov-mistral",
  "mistral-medium-latest": "prov-mistral",
  "mistral-large-latest": "prov-mistral",
  "open-mistral-7b": "prov-mistral",
  "open-mixtral-8x7b": "prov-mistral",
  "grok-3-mini": "prov-xai",
  grok: "prov-xai",
  "grok-2-1212": "prov-xai",
  sonar: "prov-perplexity",
  "sonar-pro": "prov-perplexity",
  "sonar-reasoning": "prov-perplexity",
  "meta-llama/Llama-3.3-70B-Instruct-Turbo": "prov-together",
  "Qwen/Qwen2.5-Coder-32B-Instruct": "prov-together",
  "accounts/fireworks/models/llama-v3p1-8b-instruct": "prov-fireworks",
  "accounts/fireworks/models/qwen2p5-coder-32b-instruct": "prov-fireworks",
  "Qwen/Qwen2.5-7B-Instruct": "prov-siliconflow",
  "THUDM/glm-4-9b-chat": "prov-siliconflow",
  "meta-llama/llama-3.1-8b-instruct": "prov-novita",
  "meta-llama/Meta-Llama-3.1-8B-Instruct": "prov-hyperbolic",
  "deepseek-ai/DeepSeek-V3": "prov-chutes",
  "hf:meta-llama/Llama-3.3-70B-Instruct": "prov-glhf",
  "hf:Qwen/Qwen2.5-72B-Instruct": "prov-glhf",
  "command-r-plus": "prov-cohere",
  "command-r": "prov-cohere",
};

const LEGACY_GEMINI_ALIAS: Record<string, string> = {
  "gemini-2.5-flash": "gemini-flash-latest",
  "gemini-2.0-flash": "gemini-flash-latest",
  "gemini-1.5-flash": "gemini-flash-latest",
  "gemini-1.5-pro": "gemini-pro-latest",
  "gemini-2.0-flash-lite": "gemini-flash-lite-latest",
};

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

function upstreamForModel(model: string): string | null {
  if (!model) return null;
  if (MODEL_UPSTREAM[model]) return MODEL_UPSTREAM[model];
  if (model.startsWith("gemini-")) return "prov-gemini";
  if (/^(gpt-|o1-|o3-|chatgpt-)/.test(model)) return "prov-openai";
  if (model.startsWith("claude-")) return "prov-anthropic";
  if (model.startsWith("deepseek-")) return "prov-deepseek";
  if (/^(mistral-|open-mistral|open-mixtral)/.test(model)) return "prov-mistral";
  if (model.startsWith("grok")) return "prov-xai";
  if (model.startsWith("sonar")) return "prov-perplexity";
  if (model.startsWith("command-")) return "prov-cohere";
  if (model.startsWith("hf:")) return "prov-glhf";
  if (model.startsWith("accounts/")) return "prov-fireworks";
  if (model.endsWith(":free")) return "prov-openrouter";
  if (model.startsWith("openai/") || model.startsWith("anthropic/")) return "prov-openrouter";
  return null;
}

// ---- Smart rotation memory (per warm instance): 429-cooldowns + fail stats + LRU ----
const COOLDOWN_MS = 60_000;
const keyCooldownUntil = new Map<string, number>();
const keyFail429 = new Map<string, number>();
const keyFailOther = new Map<string, number>();
const keyLastUsed = new Map<string, number>();

function keyHash(k: string): string {
  return crypto.createHash("sha256").update(k).digest("hex").slice(0, 16);
}

interface PoolItem {
  key: string;
  hint: string; // effective upstream (explicit tag or prefix detect)
  base?: string; // custom OpenAI-compat base URL override (own endpoint/proxy)
  aff?: string; // model affinity — prefer this key when `wanted` equals it
}

function effectiveOf(key: string, hint: string): string {
  if (hint && KNOWN_UPSTREAMS.has(hint)) return hint;
  return detectKeyUpstream(key);
}

// Model-affinity first, then affinity-match, then unknown, then rest — inside
// each bucket: non-cooled first, fewer 429s first, least-recently-used first.
function orderPool(pool: PoolItem[], target: string | null, wanted = ""): PoolItem[] {
  const now = Date.now();
  const cooled = (p: PoolItem) => ((keyCooldownUntil.get(keyHash(p.key)) || 0) > now ? 1 : 0);
  const fails = (p: PoolItem) => {
    const h = keyHash(p.key);
    return (keyFail429.get(h) || 0) * 3 + (keyFailOther.get(h) || 0);
  };
  const lastUsed = (p: PoolItem) => keyLastUsed.get(keyHash(p.key)) || 0;
  const prioRank = (u: string) => {
    const i = UPSTREAM_PRIORITY.indexOf(u);
    return i === -1 ? 50 : i;
  };
  const bucket = (p: PoolItem): number => {
    if (wanted && p.aff && p.aff === wanted) return -1; // custom endpoint's own model — always first
    if (!target) return prioRank(p.hint === "unknown" ? "zzz" : p.hint);
    if (p.hint === target) return 0;
    if (p.hint === "unknown") return 1;
    return 2;
  };
  return [...pool]
    .map((p, idx) => ({ p, idx }))
    .sort((a, b) => {
      const ba = bucket(a.p);
      const bb = bucket(b.p);
      if (ba !== bb) return ba - bb;
      const ca = cooled(a.p);
      const cb = cooled(b.p);
      if (ca !== cb) return ca - cb;
      const fa = fails(a.p);
      const fb = fails(b.p);
      if (fa !== fb) return fa - fb;
      const la = lastUsed(a.p);
      const lb = lastUsed(b.p);
      if (la !== lb) return la - lb;
      return a.idx - b.idx;
    })
    .map((e) => e.p);
}

function isAllowedUpstream(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (/(^|\.)(generativelanguage\.googleapis\.com|api\.groq\.com|openrouter\.ai|api\.cerebras\.ai|api\.openai\.com|api\.anthropic\.com|api\.deepseek\.com|api\.mistral\.ai|api\.x\.ai|api\.perplexity\.ai|api\.together\.xyz|api\.fireworks\.ai|api\.siliconflow\.cn|api\.novita\.ai|api\.hyperbolic\.xyz|llm\.chutes\.ai|chutes\.ai|glhf\.chat|api\.cohere\.ai)$/.test(host)) return true;
    if (!host.includes(".")) return false;
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
    if (/^(10\.|127\.|192\.168\.|169\.254\.|0\.0\.0\.0)/.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    if (/^[0-9a-f:]*:[0-9a-f:]+$/i.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

function bearerToken(req: any): string {
  const h = typeof req.headers?.authorization === "string" ? req.headers.authorization : "";
  const m = h.match(/^Bearer\s*(.*)$/i);
  const tok = (m ? m[1] : h).trim();
  // Bare "Bearer" (no token) is not a key
  if (!tok || tok.toLowerCase() === "bearer") return "";
  return tok;
}

function collectKeys(req: any, body: any): PoolItem[] {
  const out: PoolItem[] = [];
  const seen = new Set<string>();
  // Optional parallel arrays: keyUpstreams[i], keyBases[i], keyModels[i] align with apiKeys[i]
  const parallel: string[] = Array.isArray(body?.keyUpstreams) ? body.keyUpstreams : [];
  const bases: string[] = Array.isArray(body?.keyBases) ? body.keyBases : [];
  const models: string[] = Array.isArray(body?.keyModels) ? body.keyModels : [];
  const hintMap: Record<string, string> =
    body?.keyHints && typeof body.keyHints === "object" ? body.keyHints : {};
  const push = (v: any, hint = "", base = "", aff = "") => {
    if (typeof v !== "string" || !v.trim()) return;
    const t = v.trim();
    if (seen.has(t)) return;
    seen.add(t);
    const h = hint || hintMap[t.slice(0, 8)] || "";
    const item: PoolItem = { key: t, hint: effectiveOf(t, h) };
    if (base && isAllowedUpstream(base)) item.base = base.trim().replace(/\/+$/, "");
    if (aff && typeof aff === "string") item.aff = aff.trim().slice(0, 120);
    out.push(item);
  };
  push(req.headers["x-api-key"]);
  push(req.headers["x-gemini-key"]);
  push(bearerToken(req));
  if (Array.isArray(body?.apiKeys)) body.apiKeys.forEach((k: any, i: number) => push(k, parallel[i] || "", bases[i] || "", models[i] || ""));
  push(body?.clientApiKey);
  return out;
}

// Master pools flatten: universal first, then legacy ids (purane masters ke liye).
// Preserves per-key upstream tag `u` as routing hint.
function flattenMasterPools(payload: any): PoolItem[] {
  const out: PoolItem[] = [];
  const seen = new Set<string>();
  const take = (arr: any) => {
    if (!Array.isArray(arr)) return;
    arr.forEach((e: any) => {
      const k = typeof e === "string" ? e : e?.k;
      if (typeof k === "string" && k.trim() && !seen.has(k.trim())) {
        seen.add(k.trim());
        const u = typeof e?.u === "string" ? e.u : "";
        const item: PoolItem = { key: k.trim(), hint: effectiveOf(k.trim(), u) };
        const b = typeof e?.b === "string" ? e.b.trim().replace(/\/+$/, "") : "";
        if (b && isAllowedUpstream(b)) item.base = b;
        const m = typeof e?.m === "string" ? e.m.trim().slice(0, 120) : "";
        if (m) item.aff = m;
        out.push(item);
      }
    });
  };
  const pools = payload?.keys || {};
  take(pools[UNIVERSAL_ID]);
  ["prov-gemini", "prov-groq", "prov-openrouter", "prov-cerebras"].forEach((pid) => take(pools[pid]));
  Object.keys(pools).forEach((pid) => {
    if (pid !== UNIVERSAL_ID) take(pools[pid]);
  });
  return out;
}

async function relayOpenAI(opts: { baseUrl: string; apiKey: string; model: string; messages: any[]; maxTokens: number; temperature: number }): Promise<{ ok: boolean; status: number; data: any }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${opts.apiKey}`,
    "HTTP-Referer": "https://edge-ai-router.vercel.app",
    "X-Title": "Edge Router",
  };
  let resp: Response;
  try {
    resp = await fetch(`${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: opts.model, messages: opts.messages, max_tokens: opts.maxTokens, temperature: opts.temperature }),
    });
  } catch (e: any) {
    return { ok: false, status: 502, data: { message: `Upstream unreachable: ${e?.message || e}` } };
  }
  let data: any = null;
  try {
    data = await resp.json();
  } catch {
    data = { message: `Upstream bad response (HTTP ${resp.status})` };
  }
  return { ok: resp.ok, status: resp.status, data };
}

// Anthropic native translation: OpenAI messages -> /v1/messages -> OpenAI-shape response.
async function relayAnthropic(opts: { apiKey: string; model: string; messages: any[]; maxTokens: number; temperature: number }): Promise<{ ok: boolean; status: number; data: any }> {
  const sys = opts.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const msgs = opts.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
  if (msgs.length === 0) msgs.push({ role: "user", content: "hi" });
  let resp: Response;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": opts.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: Math.max(1, Math.min(opts.maxTokens || 800, 4096)),
        temperature: opts.temperature,
        ...(sys ? { system: sys } : {}),
        messages: msgs,
      }),
    });
  } catch (e: any) {
    return { ok: false, status: 502, data: { message: `Upstream unreachable: ${e?.message || e}` } };
  }
  let data: any = null;
  try {
    data = await resp.json();
  } catch {
    data = { message: `Upstream bad response (HTTP ${resp.status})` };
  }
  if (!resp.ok) {
    const msg = data?.error?.message || data?.message || `Upstream HTTP ${resp.status}`;
    return { ok: false, status: resp.status, data: { message: msg } };
  }
  const text = Array.isArray(data?.content) ? data.content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("") : "";
  return {
    ok: true,
    status: 200,
    data: {
      id: data?.id,
      model: data?.model || opts.model,
      choices: [{ message: { role: "assistant", content: text }, finish_reason: data?.stop_reason === "max_tokens" ? "length" : "stop" }],
      usage: data?.usage ? { prompt_tokens: data.usage.input_tokens, completion_tokens: data.usage.output_tokens, total_tokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0) } : {},
    },
  };
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: { message: "Method not allowed", type: "invalid_request_error" } });
  }
  const startTime = Date.now();
  try {
    const body = req.body || {};
    const { messages = [], model, max_tokens = 800, temperature = 0.7 } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: { message: "Invalid messages array", type: "invalid_request_error" } });
    }

    // Custom baseUrl (legacy/custom providers) — providerId ab zaroori nahi.
    let customBase: string | null = null;
    const customRaw = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
    if (customRaw) {
      if (!isAllowedUpstream(customRaw)) {
        return res.status(400).json({ error: { message: "baseUrl public https hona chahiye.", type: "invalid_request_error" } });
      }
      customBase = customRaw;
    }

    let pool = collectKeys(req, body);
    const maybeMaster = pool.find((p) => p.key.startsWith(MASTER_PREFIX))?.key || (typeof body.masterKey === "string" && body.masterKey.trim().startsWith(MASTER_PREFIX) ? body.masterKey.trim() : "");
    if (maybeMaster) {
      let payload: any;
      try {
        payload = masterDecrypt(maybeMaster);
      } catch (e: any) {
        const msg =
          e?.code === "EXPIRED"
            ? "Master key expire ho gayi — site se Regenerate karo."
            : "Master key invalid hai — site se dobara copy karo.";
        return res.status(401).json({ error: { message: msg, type: "authentication_error" } });
      }
      if (await isMasterRevoked(payload.mid)) {
        return res.status(401).json({ error: { message: "Ye master key revoke (delete) ho chuki hai — nayi generate karo.", type: "authentication_error" } });
      }
      pool = flattenMasterPools(payload);
      if (pool.length === 0) {
        return res.status(401).json({ error: { message: "Is master key me koi key nahi hai — site pe KEYS me add karke Regenerate karo.", type: "authentication_error" } });
      }
    }
    if (pool.length === 0) {
      return res.status(401).json({
        error: {
          message: "API key dalo: site pe KEYS me add karo, fir link + master key (ya direct key) bhejo.",
          type: "authentication_error",
        },
      });
    }

    let wanted = (typeof model === "string" && model) || "gemini-flash-latest";
    if (LEGACY_GEMINI_ALIAS[wanted]) wanted = LEGACY_GEMINI_ALIAS[wanted];

    const openaiMessages = messages.map((m: any) => ({
      role: m.role === "system" || m.role === "assistant" || m.role === "user" ? m.role : "user",
      content: typeof m.content === "string" ? m.content : "",
    }));

    // Model -> upstream; unknown model -> smart order me try (404/400 pe next).
    const target = customBase ? null : upstreamForModel(wanted);
    const ordered = customBase ? pool : orderPool(pool, target, wanted);
    const retryable = (st: number) =>
      [401, 403, 429, 500, 502, 503, 504].includes(st) || (!target && !customBase && [400, 404].includes(st));

    let lastErr = "unknown error";
    const deadKeyIndexes: number[] = [];
    const deadKeyPrefixes: string[] = [];
    const rateLimitedPrefixes: string[] = [];
    for (let i = 0; i < ordered.length; i++) {
      const item = ordered[i];
      const itemBase = !customBase && item.base ? item.base : null; // per-key custom endpoint wins (unless whole-request baseUrl)
      const effHint = customBase || itemBase ? "custom" : item.hint;
      const servedId = customBase || itemBase ? "custom" : effHint === "unknown" ? (target || "prov-gemini") : effHint;
      const up: { name: string; baseUrl: string; native?: string } = customBase
        ? { name: "Custom", baseUrl: customBase }
        : itemBase
          ? { name: "Custom", baseUrl: itemBase }
          : UPSTREAMS[servedId] || UPSTREAMS[target || "prov-gemini"];
      keyLastUsed.set(keyHash(item.key), Date.now());
      const r = !itemBase && up.native === "anthropic"
        ? await relayAnthropic({ apiKey: item.key, model: wanted, messages: openaiMessages, maxTokens: max_tokens, temperature })
        : await relayOpenAI({ baseUrl: up.baseUrl, apiKey: item.key, model: wanted, messages: openaiMessages, maxTokens: max_tokens, temperature });
      if (r.ok) {
        const latencyMs = Date.now() - startTime;
        const d = r.data || {};
        const choice = d.choices?.[0];
        const responseText = choice?.message?.content || "";
        const usage = d.usage || {};
        const promptTokens = usage.prompt_tokens ?? openaiMessages.reduce((acc: number, m: any) => acc + Math.ceil((m.content || "").length / 4), 0);
        const completionTokens = usage.completion_tokens ?? Math.ceil(responseText.length / 4);
        res.setHeader("X-Edge-Provider", UNIVERSAL_ID);
        res.setHeader("X-Edge-Upstream", servedId);
        res.setHeader("X-Edge-Key-Index", String(i));
        res.setHeader("X-Edge-Keys-Tried", String(i + 1));
        res.setHeader("X-Edge-Latency-Ms", latencyMs.toString());
        res.setHeader("X-Edge-Router-Region", "global-anycast");
        return res.json({
          id: d.id || "chatcmpl-" + Math.random().toString(36).substring(2, 11),
          object: "chat.completion",
          created: d.created || Math.floor(Date.now() / 1000),
          model: d.model || wanted,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: responseText },
              finish_reason: choice?.finish_reason || "stop",
            },
          ],
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens,
          },
          edge_routing: {
            provider: customBase || itemBase ? "Custom" : UPSTREAMS[servedId]?.name || servedId,
            // Canonical site provider ID — jaha ID dalni ho, yahi dalo:
            provider_id: UNIVERSAL_ID,
            upstream_id: servedId,
            key_index: i,
            key_prefix: typeof item.key === "string" ? item.key.slice(0, 8) : "",
            keys_tried: i + 1,
            dead_key_indexes: deadKeyIndexes,
            dead_key_prefixes: deadKeyPrefixes,
            rate_limited_prefixes: rateLimitedPrefixes,
            latency_ms: latencyMs,
            status: "200 OK",
          },
        });
      }
      lastErr = r.data?.error?.message || r.data?.message || `Upstream HTTP ${r.status}`;
      const h = keyHash(item.key);
      if (r.status === 429) {
        keyCooldownUntil.set(h, Date.now() + COOLDOWN_MS);
        keyFail429.set(h, (keyFail429.get(h) || 0) + 1);
        rateLimitedPrefixes.push(item.key.slice(0, 8));
      } else if (r.status === 401 || r.status === 403) {
        // Sure-dead only: key's own upstream == tried upstream. Unknown-hint keys
        // tried on a guessed upstream are NOT quarantined (could be a mismatch).
        // A key failing 401 on its OWN custom endpoint IS sure-dead.
        if ((!customBase && effHint !== "unknown" && effHint === servedId) || (!customBase && !!itemBase)) {
          deadKeyIndexes.push(i);
          deadKeyPrefixes.push(item.key.slice(0, 8));
        } else {
          keyFailOther.set(h, (keyFailOther.get(h) || 0) + 1);
        }
      } else {
        keyFailOther.set(h, (keyFailOther.get(h) || 0) + 1);
      }
      if (!retryable(r.status)) break;
    }

    return res.status(502).json({
      error: {
        message: `${lastErr} (${ordered.length} keys tried)`,
        type: "upstream_error",
        dead_key_indexes: deadKeyIndexes,
        dead_key_prefixes: deadKeyPrefixes,
        rate_limited_prefixes: rateLimitedPrefixes,
      },
    });
  } catch (err: any) {
    console.error("Proxy completions error:", err);
    return res.status(500).json({
      error: {
        message: err.message || "Proxy completion failed",
        type: "internal_server_error",
      },
    });
  }
}
