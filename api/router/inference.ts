// In-app Tester inference — FULLY SELF-CONTAINED (no cross-file imports).
// Body: { prompt, model?, apiKeys?/clientApiKey?, keyUpstreams?, keyBases?, keyModels? } (+ legacy providerId/baseUrl tolerated).
// Model naam se upstream auto-route; smart rotation (429-cooldown + fail-stats + LRU);
// 401 when none configured (no fake success).
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

const KNOWN = new Set(Object.keys(UPSTREAMS));
const UPSTREAM_PRIORITY = ["prov-gemini","prov-groq","prov-cerebras","prov-openrouter","prov-deepseek","prov-mistral","prov-together","prov-fireworks","prov-siliconflow","prov-novita","prov-hyperbolic","prov-chutes","prov-glhf","prov-openai","prov-anthropic","prov-xai","prov-perplexity","prov-cohere"];

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
  "gpt-4o-mini": "prov-openai", "gpt-4o": "prov-openai", "o1-mini": "prov-openai", "o3-mini": "prov-openai",
  "claude-3-5-haiku-latest": "prov-anthropic", "claude-3-5-sonnet-latest": "prov-anthropic",
  "deepseek-chat": "prov-deepseek", "deepseek-reasoner": "prov-deepseek",
  "mistral-small-latest": "prov-mistral", "mistral-large-latest": "prov-mistral",
  "grok-3-mini": "prov-xai", "sonar": "prov-perplexity", "sonar-pro": "prov-perplexity",
  "meta-llama/Llama-3.3-70B-Instruct-Turbo": "prov-together",
  "accounts/fireworks/models/llama-v3p1-8b-instruct": "prov-fireworks",
  "Qwen/Qwen2.5-7B-Instruct": "prov-siliconflow",
  "meta-llama/llama-3.1-8b-instruct": "prov-novita",
  "meta-llama/Meta-Llama-3.1-8B-Instruct": "prov-hyperbolic",
  "deepseek-ai/DeepSeek-V3": "prov-chutes",
  "hf:meta-llama/Llama-3.3-70B-Instruct": "prov-glhf",
  "command-r-plus": "prov-cohere", "command-r": "prov-cohere",
};

const LEGACY_GEMINI_ALIAS: Record<string, string> = {
  "gemini-2.5-flash": "gemini-flash-latest",
  "gemini-2.0-flash": "gemini-flash-latest",
  "gemini-1.5-flash": "gemini-flash-latest",
  "gemini-1.5-pro": "gemini-pro-latest",
  "gemini-2.0-flash-lite": "gemini-flash-lite-latest",
};

function detectKeyUpstream(key: string): string {
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

const COOLDOWN_MS = 60_000;
const cdUntil = new Map<string, number>();
const fail429 = new Map<string, number>();
const failOther = new Map<string, number>();
const lastUsed = new Map<string, number>();
function kh(k: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < k.length; i++) { h ^= k.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `h${h.toString(36)}:${k.length}`;
}
interface PI { key: string; hint: string; base?: string; aff?: string; }
function effOf(key: string, hint: string): string {
  return hint && KNOWN.has(hint) ? hint : detectKeyUpstream(key);
}
function allowedBase(raw: string): boolean {
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
  } catch { return false; }
}
function orderPool(pool: PI[], target: string | null, wanted = ""): PI[] {
  const now = Date.now();
  const bucket = (p: PI): number => {
    if (wanted && p.aff && p.aff === wanted) return -1;
    if (!target) { const i = UPSTREAM_PRIORITY.indexOf(p.hint); return p.hint === "unknown" ? 99 : i === -1 ? 50 : i; }
    if (p.hint === target) return 0;
    if (p.hint === "unknown") return 1;
    return 2;
  };
  return [...pool].map((p, idx) => ({ p, idx })).sort((a, b) => {
    const ba = bucket(a.p), bb = bucket(b.p);
    if (ba !== bb) return ba - bb;
    const ca = (cdUntil.get(kh(a.p.key)) || 0) > now ? 1 : 0;
    const cb = (cdUntil.get(kh(b.p.key)) || 0) > now ? 1 : 0;
    if (ca !== cb) return ca - cb;
    const fa = (fail429.get(kh(a.p.key)) || 0) * 3 + (failOther.get(kh(a.p.key)) || 0);
    const fb = (fail429.get(kh(b.p.key)) || 0) * 3 + (failOther.get(kh(b.p.key)) || 0);
    if (fa !== fb) return fa - fb;
    const la = lastUsed.get(kh(a.p.key)) || 0, lb = lastUsed.get(kh(b.p.key)) || 0;
    if (la !== lb) return la - lb;
    return a.idx - b.idx;
  }).map((e) => e.p);
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const startTime = Date.now();
  try {
    const body = req.body || {};
    const { prompt, model, clientApiKey } = body;

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Missing prompt parameter" });
    }

    const pool: PI[] = [];
    const seen = new Set<string>();
    const parallel: string[] = Array.isArray(body?.keyUpstreams) ? body.keyUpstreams : [];
    const bases: string[] = Array.isArray(body?.keyBases) ? body.keyBases : [];
    const models: string[] = Array.isArray(body?.keyModels) ? body.keyModels : [];
    const push = (v: any, hint = "", base = "", aff = "") => {
      if (typeof v === "string" && v.trim()) {
        const t = v.trim();
        if (seen.has(t)) return;
        seen.add(t);
        const item: PI = { key: t, hint: effOf(t, hint) };
        if (base && allowedBase(base)) item.base = base.trim().replace(/\/+$/, "");
        if (aff && typeof aff === "string") item.aff = aff.trim().slice(0, 120);
        pool.push(item);
      }
    };
    const authH = typeof req.headers?.authorization === "string" ? req.headers.authorization : "";
    const bm = authH.match(/^Bearer\s*(.*)$/i);
    const bearer = (bm ? bm[1] : authH).trim();
    push(req.headers["x-api-key"]);
    push(req.headers["x-gemini-key"]);
    if (bearer && bearer.toLowerCase() !== "bearer") push(bearer);
    if (Array.isArray(body.apiKeys)) body.apiKeys.forEach((k: any, i: number) => push(k, parallel[i] || "", bases[i] || "", models[i] || ""));
    push(clientApiKey);
    if (pool.length === 0) {
      return res.status(401).json({ error: "Login required: KEYS me key dalo." });
    }

    let wanted = (typeof model === "string" && model) || "gemini-flash-latest";
    if (LEGACY_GEMINI_ALIAS[wanted]) wanted = LEGACY_GEMINI_ALIAS[wanted];

    const target = upstreamForModel(wanted);
    const ordered = orderPool(pool, target, wanted);
    const retryable = (st: number) =>
      [401, 403, 429, 500, 502, 503, 504].includes(st) || (!target && [400, 404].includes(st));

    let lastErr = "unknown error";
    const deadKeyPrefixes: string[] = [];
    const rateLimitedPrefixes: string[] = [];
    for (let i = 0; i < ordered.length; i++) {
      const item = ordered[i];
      const itemBase = item.base || null;
      const served = itemBase ? "custom" : item.hint === "unknown" ? (target || "prov-gemini") : item.hint;
      const up: { name: string; baseUrl: string; native?: string } = itemBase ? { name: "Custom", baseUrl: itemBase } : UPSTREAMS[served] || UPSTREAMS[target || "prov-gemini"];
      lastUsed.set(kh(item.key), Date.now());
      try {
        let resp: Response;
        if (!itemBase && up.native === "anthropic") {
          resp = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": item.key, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({ model: wanted, max_tokens: 600, messages: [{ role: "user", content: prompt }] }),
          });
        } else {
          resp = await fetch(`${up.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${item.key}`,
              "HTTP-Referer": "https://edge-ai-router.vercel.app",
              "X-Title": "Edge Router",
            },
            body: JSON.stringify({
              model: wanted,
              messages: [{ role: "user", content: prompt }],
              max_tokens: 600,
              temperature: 0.7,
            }),
          });
        }
        const data: any = await resp.json().catch(() => null);
        const okText = up.native === "anthropic"
          ? (resp.ok && Array.isArray(data?.content) ? data.content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("") : "")
          : (resp.ok && data?.choices?.[0] ? (data.choices[0].message?.content || "OK") : "");
        if (resp.ok && (up.native === "anthropic" ? true : data?.choices?.[0])) {
          const latencyMs = Date.now() - startTime;
          const text = okText || "OK";
          const tokens = data.usage?.total_tokens || data.usage?.input_tokens + data.usage?.output_tokens || Math.max(15, Math.ceil(text.length / 4) + Math.ceil(prompt.length / 4));
          res.setHeader("X-Edge-Upstream", served);
          res.setHeader("X-Edge-Key-Index", String(i));
          return res.json({
            status: "ok",
            isLive: true,
            response: text,
            modelUsed: data.model || wanted,
            providerId: "Edge Router",
            providerName: up.name,
            upstreamId: served,
            keyIndex: i,
            key_prefix: typeof item.key === "string" ? item.key.slice(0, 8) : "",
            dead_key_prefixes: deadKeyPrefixes,
            rate_limited_prefixes: rateLimitedPrefixes,
            latencyMs,
            tokens,
          });
        }
        lastErr = data?.error?.message || data?.message || `Upstream HTTP ${resp.status}`;
        const h = kh(item.key);
        if (resp.status === 429) {
          cdUntil.set(h, Date.now() + COOLDOWN_MS);
          fail429.set(h, (fail429.get(h) || 0) + 1);
          rateLimitedPrefixes.push(item.key.slice(0, 8));
        } else if (resp.status === 401 || resp.status === 403) {
          if (!!itemBase || (item.hint !== "unknown" && item.hint === served)) deadKeyPrefixes.push(item.key.slice(0, 8));
          else failOther.set(h, (failOther.get(h) || 0) + 1);
        } else {
          failOther.set(h, (failOther.get(h) || 0) + 1);
        }
        if (!retryable(resp.status)) break;
      } catch (e: any) {
        lastErr = `Upstream unreachable: ${e?.message || e}`;
      }
    }
    return res.status(502).json({ error: `${lastErr} (${ordered.length} keys tried)`, dead_key_prefixes: deadKeyPrefixes, rate_limited_prefixes: rateLimitedPrefixes });
  } catch (err: any) {
    console.error("Inference route error:", err);
    const latencyMs = Date.now() - startTime;
    return res.status(500).json({
      error: err.message || "Inference failed",
      latencyMs,
    });
  }
}
