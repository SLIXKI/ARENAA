import express from "express";
import http from "http";
import path from "path";
import dotenv from "dotenv";
import crypto from "node:crypto";
import { inflateSync, deflateSync } from "node:zlib";

dotenv.config();

// NOTE (Vercel serverless): module import must be 100% side-effect free —
// it only creates the Express app + routes. HTTP server, WebSockets and
// listen() are created inside startServer() (long-lived servers only).
// Heavy SDKs (ws, @google/genai) are lazy-loaded inside handlers.

// Reliable serverless detection (VERCEL is not guaranteed at function runtime)
const IS_SERVERLESS = !!(
  process.env.VERCEL ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.LAMBDA_TASK_ROOT ||
  process.env.VERCEL_ENV
);

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const app = express();
let server: any = null;

app.use(express.json({ limit: "10mb" }));

// SINGLE-GATEWAY MODE: sole public endpoint is POST /api/v1/chat/completions.
// Every user sends their OWN Gemini key via Authorization: Bearer <AIza...> or x-gemini-key.
// No server-key fallback on the public gateway (prevents quota burn).
function resolvePublicUserKey(req: any): string {
  const headerKey = (req.headers["x-gemini-key"] as string) || "";
  return headerKey.trim() || bearerTokenLocal(req);
}

// Universal upstream table (ONE virtual provider; model naam se auto-route).
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
  "prov-zhipu": { name: "Zhipu GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", defaultModel: "glm-4-flash" },
  "prov-qwen": { name: "Alibaba Qwen", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", defaultModel: "qwen-turbo" },
  "prov-moonshot": { name: "Moonshot Kimi", baseUrl: "https://api.moonshot.cn/v1", defaultModel: "kimi-k2-0711-preview" },
  "prov-githubmodels": { name: "GitHub Models", baseUrl: "https://models.github.ai/inference", defaultModel: "openai/gpt-4o-mini" },
  "prov-huggingface": { name: "HuggingFace", baseUrl: "https://router.huggingface.co/v1", defaultModel: "meta-llama/Llama-3.3-70B-Instruct" },
  "prov-sambanova": { name: "SambaNova", baseUrl: "https://api.sambanova.ai/v1", defaultModel: "Meta-Llama-3.3-70B-Instruct" },
  "prov-nebius": { name: "Nebius", baseUrl: "https://api.studio.nebius.com/v1", defaultModel: "Qwen/Qwen2.5-72B-Instruct" },
  "prov-deepinfra": { name: "DeepInfra", baseUrl: "https://api.deepinfra.com/v1/openai", defaultModel: "meta-llama/Meta-Llama-3.1-8B-Instruct" },
  "prov-pollinations": { name: "Pollinations", baseUrl: "https://text.pollinations.ai/openai", defaultModel: "openai" },
};

const KNOWN_UPSTREAMS_LOCAL = new Set(Object.keys(UPSTREAMS));

const UPSTREAM_PRIORITY = ["prov-gemini","prov-groq","prov-cerebras","prov-openrouter","prov-deepseek","prov-mistral","prov-together","prov-fireworks","prov-siliconflow","prov-novita","prov-hyperbolic","prov-chutes","prov-glhf","prov-openai","prov-anthropic","prov-xai","prov-perplexity","prov-cohere","prov-zhipu","prov-qwen","prov-moonshot","prov-sambanova","prov-nebius","prov-deepinfra","prov-huggingface","prov-githubmodels","prov-pollinations"];

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
  "gpt-4o-mini": "prov-openai", "gpt-4o": "prov-openai", "gpt-4.1-mini": "prov-openai", "gpt-4.1": "prov-openai",
  "o1-mini": "prov-openai", "o3-mini": "prov-openai", "chatgpt-4o-latest": "prov-openai",
  "claude-3-5-haiku-latest": "prov-anthropic", "claude-3-5-sonnet-latest": "prov-anthropic", "claude-3-haiku-20240307": "prov-anthropic",
  "deepseek-chat": "prov-deepseek", "deepseek-reasoner": "prov-deepseek",
  "mistral-small-latest": "prov-mistral", "mistral-medium-latest": "prov-mistral", "mistral-large-latest": "prov-mistral",
  "open-mistral-7b": "prov-mistral", "open-mixtral-8x7b": "prov-mistral",
  "grok-3-mini": "prov-xai", "grok": "prov-xai", "grok-2-1212": "prov-xai",
  "sonar": "prov-perplexity", "sonar-pro": "prov-perplexity", "sonar-reasoning": "prov-perplexity",
  "meta-llama/Llama-3.3-70B-Instruct-Turbo": "prov-together", "Qwen/Qwen2.5-Coder-32B-Instruct": "prov-together",
  "accounts/fireworks/models/llama-v3p1-8b-instruct": "prov-fireworks", "accounts/fireworks/models/qwen2p5-coder-32b-instruct": "prov-fireworks",
  "Qwen/Qwen2.5-7B-Instruct": "prov-siliconflow", "THUDM/glm-4-9b-chat": "prov-siliconflow",
  "meta-llama/llama-3.1-8b-instruct": "prov-novita",
  "meta-llama/Meta-Llama-3.1-8B-Instruct": "prov-hyperbolic",
  "deepseek-ai/DeepSeek-V3": "prov-chutes",
  "hf:meta-llama/Llama-3.3-70B-Instruct": "prov-glhf", "hf:Qwen/Qwen2.5-72B-Instruct": "prov-glhf",
  "command-r-plus": "prov-cohere", "command-r": "prov-cohere",
  "glm-4-flash": "prov-zhipu", "glm-4.5-flash": "prov-zhipu", "glm-4.5": "prov-zhipu",
  "qwen-turbo": "prov-qwen", "qwen-plus": "prov-qwen", "qwen-max": "prov-qwen",
  "moonshot-v1-8k": "prov-moonshot", "moonshot-v1-32k": "prov-moonshot", "moonshot-v1-128k": "prov-moonshot",
  "kimi-k2-0711-preview": "prov-moonshot",
  "openai/gpt-4o-mini": "prov-githubmodels", "openai/gpt-4o": "prov-githubmodels",
  "meta/Llama-3.3-70B-Instruct": "prov-githubmodels", "deepseek/DeepSeek-V3-0324": "prov-githubmodels",
  "mistral-ai/mistral-small-2503": "prov-githubmodels", "microsoft/Phi-4": "prov-githubmodels",
  "meta-llama/Llama-3.3-70B-Instruct": "prov-huggingface",
  "Meta-Llama-3.3-70B-Instruct": "prov-sambanova",
  "Qwen/Qwen2.5-72B-Instruct": "prov-nebius",
  "openai": "prov-pollinations", "openai-fast": "prov-pollinations",
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
  if (k.startsWith("ghp_") || k.startsWith("github_pat_") || k.startsWith("gho_")) return "prov-githubmodels";
  if (k.startsWith("hf_")) return "prov-huggingface";
  if (k === "pollinations-free-tier" || k.startsWith("pollinations-")) return "prov-pollinations";
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
  if (model.startsWith("glm-")) return "prov-zhipu";
  if (model.startsWith("qwen")) return "prov-qwen";
  if (model.startsWith("moonshot") || model.startsWith("kimi")) return "prov-moonshot";
  if (model.startsWith("hf:")) return "prov-glhf";
  if (model.startsWith("accounts/")) return "prov-fireworks";
  if (model.endsWith(":free")) return "prov-openrouter";
  if (model.startsWith("openai/") || model.startsWith("anthropic/")) return "prov-openrouter";
  return null;
}

interface PoolItemLocal { key: string; hint: string; base?: string; aff?: string; }
function effectiveLocal(key: string, hint: string): string {
  return hint && KNOWN_UPSTREAMS_LOCAL.has(hint) ? hint : detectKeyUpstream(key);
}

// Smart rotation memory: 429-cooldowns + fail stats + LRU
const COOLDOWN_MS_LOCAL = 60_000;
const keyCooldownUntilLocal = new Map<string, number>();
const keyFail429Local = new Map<string, number>();
const keyFailOtherLocal = new Map<string, number>();
const keyLastUsedLocal = new Map<string, number>();
function keyHashLocal(k: string): string {
  return crypto.createHash("sha256").update(k).digest("hex").slice(0, 16);
}

function orderPoolLocal(pool: PoolItemLocal[], target: string | null, wanted = ""): PoolItemLocal[] {
  const now = Date.now();
  const bucket = (p: PoolItemLocal): number => {
    if (wanted && p.aff && p.aff === wanted) return -1;
    if (!target) { const i = UPSTREAM_PRIORITY.indexOf(p.hint); return p.hint === "unknown" ? 99 : i === -1 ? 50 : i; }
    if (p.hint === target) return 0;
    if (p.hint === "unknown") return 1;
    return 2;
  };
  return [...pool].map((p, idx) => ({ p, idx })).sort((a, b) => {
    const ba = bucket(a.p), bb = bucket(b.p);
    if (ba !== bb) return ba - bb;
    const ca = (keyCooldownUntilLocal.get(keyHashLocal(a.p.key)) || 0) > now ? 1 : 0;
    const cb = (keyCooldownUntilLocal.get(keyHashLocal(b.p.key)) || 0) > now ? 1 : 0;
    if (ca !== cb) return ca - cb;
    const fa = (keyFail429Local.get(keyHashLocal(a.p.key)) || 0) * 3 + (keyFailOtherLocal.get(keyHashLocal(a.p.key)) || 0);
    const fb = (keyFail429Local.get(keyHashLocal(b.p.key)) || 0) * 3 + (keyFailOtherLocal.get(keyHashLocal(b.p.key)) || 0);
    if (fa !== fb) return fa - fb;
    const la = keyLastUsedLocal.get(keyHashLocal(a.p.key)) || 0, lb = keyLastUsedLocal.get(keyHashLocal(b.p.key)) || 0;
    if (la !== lb) return la - lb;
    return a.idx - b.idx;
  }).map((e) => e.p);
}

const LEGACY_GEMINI_ALIAS: Record<string, string> = {
  "gemini-2.5-flash": "gemini-flash-latest",
  "gemini-2.0-flash": "gemini-flash-latest",
  "gemini-1.5-flash": "gemini-flash-latest",
  "gemini-1.5-pro": "gemini-pro-latest",
  "gemini-2.0-flash-lite": "gemini-flash-lite-latest",
};

function isAllowedUpstream(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (/(^|\.)(generativelanguage\.googleapis\.com|api\.groq\.com|openrouter\.ai|api\.cerebras\.ai|api\.openai\.com|api\.anthropic\.com|api\.deepseek\.com|api\.mistral\.ai|api\.x\.ai|api\.perplexity\.ai|api\.together\.xyz|api\.fireworks\.ai|api\.siliconflow\.cn|api\.novita\.ai|api\.hyperbolic\.xyz|llm\.chutes\.ai|chutes\.ai|glhf\.chat|api\.cohere\.ai|open\.bigmodel\.cn|dashscope\.aliyuncs\.com|api\.moonshot\.cn|models\.github\.ai|router\.huggingface\.co|api\.sambanova\.ai|api\.studio\.nebius\.com|api\.deepinfra\.com|text\.pollinations\.ai)$/.test(host)) return true;
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

function bearerTokenLocal(req: any): string {
  const h = typeof req.headers?.authorization === "string" ? req.headers.authorization : "";
  const m = h.match(/^Bearer\s*(.*)$/i);
  const tok = (m ? m[1] : h).trim();
  if (!tok || tok.toLowerCase() === "bearer") return "";
  return tok;
}

function collectRelayKeys(req: any, body: any): PoolItemLocal[] {
  const out: PoolItemLocal[] = [];
  const seen = new Set<string>();
  const parallel: string[] = Array.isArray(body?.keyUpstreams) ? body.keyUpstreams : [];
  const bases: string[] = Array.isArray(body?.keyBases) ? body.keyBases : [];
  const models: string[] = Array.isArray(body?.keyModels) ? body.keyModels : [];
  const hintMap: Record<string, string> = body?.keyHints && typeof body.keyHints === "object" ? body.keyHints : {};
  const push = (v: any, hint = "", base = "", aff = "") => {
    if (typeof v !== "string" || !v.trim()) return;
    const t = v.trim();
    if (seen.has(t)) return;
    seen.add(t);
    const h = hint || hintMap[t.slice(0, 8)] || "";
    const item: PoolItemLocal = { key: t, hint: effectiveLocal(t, h) };
    if (base && isAllowedUpstream(base)) item.base = base.trim().replace(/\/+$/, "");
    if (aff && typeof aff === "string") item.aff = aff.trim().slice(0, 120);
    out.push(item);
  };
  push(req.headers["x-api-key"]);
  push(req.headers["x-gemini-key"]);
  push(bearerTokenLocal(req));
  if (Array.isArray(body?.apiKeys)) body.apiKeys.forEach((k: any, i: number) => push(k, parallel[i] || "", bases[i] || "", models[i] || ""));
  push(body?.clientApiKey);
  return out;
}

function resolveCustomBase(body: any): { baseUrl: string; error?: string } {
  const custom = typeof body?.baseUrl === "string" ? body.baseUrl.trim() : "";
  if (!custom) return { baseUrl: "" };
  if (!isAllowedUpstream(custom)) return { baseUrl: "", error: "baseUrl public https hona chahiye." };
  return { baseUrl: custom };
}

async function relayAnthropicLocal(opts: { apiKey: string; model: string; messages: any[]; maxTokens: number; temperature: number }): Promise<{ ok: boolean; status: number; data: any }> {
  const sys = (opts.messages || []).filter((m: any) => m?.role === "system").map((m: any) => typeof m.content === "string" ? m.content : "").filter(Boolean).join("\n\n");
  const msgs = (opts.messages || []).filter((m: any) => m?.role && m.role !== "system").map((m: any) => ({ role: m.role === "assistant" ? "assistant" : "user", content: typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "") }));
  let resp: Response;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": opts.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: opts.model, max_tokens: Math.min(opts.maxTokens || 512, 1024), temperature: opts.temperature ?? 0.7, ...(sys ? { system: sys } : {}), messages: msgs.length ? msgs : [{ role: "user", content: "ping" }] }),
    });
  } catch (e: any) {
    return { ok: false, status: 502, data: { message: `Anthropic unreachable: ${e?.message || e}` } };
  }
  let data: any = null;
  try {
    data = await resp.json();
  } catch {
    data = { message: `Anthropic bad response (HTTP ${resp.status})` };
  }
  if (resp.ok && data) {
    const text = Array.isArray(data.content) ? data.content.filter((b: any) => b?.type === "text").map((b: any) => b.text || "").join("") : "";
    data = { id: data.id, object: "chat.completion", created: Date.now(), model: data.model || opts.model, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: data.stop_reason || "stop" }], usage: data.usage ? { prompt_tokens: data.usage.input_tokens, completion_tokens: data.usage.output_tokens, total_tokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0) } : undefined };
  }
  return { ok: resp.ok, status: resp.status, data };
}

async function relayChatCompletion(opts: { baseUrl: string; apiKey: string; model: string; messages: any[]; maxTokens: number; temperature: number; native?: string }): Promise<{ ok: boolean; status: number; data: any }> {
  if (opts.native === "anthropic") return relayAnthropicLocal(opts);
  let resp: Response;
  try {
    resp = await fetch(`${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
        "HTTP-Referer": "https://edge-ai-router.vercel.app",
        "X-Title": "Edge Router",
      },
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

function wantedModelUniversal(model: any, fallback: string): string {
  let wanted = (typeof model === "string" && model) || fallback;
  if (LEGACY_GEMINI_ALIAS[wanted]) wanted = LEGACY_GEMINI_ALIAS[wanted];
  return wanted;
}

// ---- Master key (er1.) support, mirrored from api/v1 (local-dev parity) ----
const MASTER_PREFIX = "er1.";

function masterSecretBuf(): Buffer {
  return crypto
    .createHash("sha256")
    .update(process.env.MASTER_KEY_SECRET || "er-dev-fallback-secret-v1-do-not-use-in-prod")
    .digest();
}

function masterDecryptLocal(token: string): any {
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
    const d = crypto.createDecipheriv("aes-256-gcm", masterSecretBuf(), iv);
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

async function isMasterRevokedLocal(mid: string): Promise<boolean> {
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
  } catch {
    return false;
  }
}

// Resolve effective key pool: master key (er1.) wins when present, else direct keys.
async function resolveKeyPool(
  req: any,
  body: any,
  providerId: string
): Promise<{ keys: PoolItemLocal[]; error?: string }> {
  const keys = collectRelayKeys(req, body);
  const maybeMaster =
    keys.find((k) => k.key.startsWith(MASTER_PREFIX))?.key ||
    (typeof body.masterKey === "string" && body.masterKey.trim().startsWith(MASTER_PREFIX) ? body.masterKey.trim() : "");
  if (!maybeMaster) return { keys };
  let payload: any;
  try {
    payload = masterDecryptLocal(maybeMaster);
  } catch (e: any) {
    return {
      keys: [],
      error: e?.code === "EXPIRED" ? "Master key expire ho gayi — site se Regenerate karo." : "Master key invalid hai — site se dobara copy karo.",
    };
  }
  if (await isMasterRevokedLocal(payload.mid)) {
    return { keys: [], error: "Ye master key revoke (delete) ho chuki hai — nayi generate karo." };
  }
  // Universal: saare pools flatten (universal first, then legacy ids for old masters)
  const out: PoolItemLocal[] = [];
  const seen = new Set<string>();
  const take = (arr: any) => {
    if (!Array.isArray(arr)) return;
    arr.forEach((e: any) => {
      const k = typeof e === "string" ? e : e?.k;
      if (typeof k === "string" && k.trim() && !seen.has(k.trim())) {
        seen.add(k.trim());
        const u = typeof e?.u === "string" ? e.u : "";
        const item: PoolItemLocal = { key: k.trim(), hint: effectiveLocal(k.trim(), u) };
        const b = typeof e?.b === "string" ? e.b.trim().replace(/\/+$/, "") : "";
        if (b && isAllowedUpstream(b)) item.base = b;
        const m = typeof e?.m === "string" ? e.m.trim().slice(0, 120) : "";
        if (m) item.aff = m;
        out.push(item);
      }
    });
  };
  const pools = payload.keys || {};
  take(pools["Edge Router"]);
  ["prov-gemini", "prov-groq", "prov-openrouter", "prov-cerebras"].forEach((pid) => take(pools[pid]));
  Object.keys(pools).forEach((pid) => take(pools[pid]));
  if (out.length === 0) {
    return { keys: [], error: "Is master key me koi key nahi hai." };
  }
  return { keys: out };
}

// Helper to initialize GenAI client safely with server secret or user provided key
async function getGenAIClient(customApiKey?: string): Promise<any> {
  const key = customApiKey || process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY is not configured on the server and no key was provided.");
  }
  const { GoogleGenAI } = await import("@google/genai");
  return new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    hasServerApiKey: !!process.env.GEMINI_API_KEY,
  });
});

// OpenAI-compatible model list (external clients fill switch-model from here)
const UNIVERSAL_MODELS_LOCAL: { id: string; upstream: string }[] = [
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

app.get("/api/v1/models", (req, res) => {
  const now = Math.floor(Date.now() / 1000);
  // Master key di hai to validate karo (Nexus key-check): galat/expire -> 401.
  const mcands = [
    req.headers?.["x-master-key"],
    (() => {
      const h = typeof req.headers?.authorization === "string" ? req.headers.authorization : "";
      const m = h.match(/^Bearer\s*(.*)$/i);
      return m ? m[1] : h;
    })(),
    Array.isArray((req.query as any)?.key) ? (req.query as any).key[0] : (req.query as any)?.key,
  ];
  const masterTok = mcands.find((c) => typeof c === "string" && c.trim().startsWith("er1."))?.trim() || "";
  if (masterTok) {
    try {
      const payload = masterDecryptLocal(masterTok);
      const set = new Set<string>();
      Object.keys(payload.keys || {}).forEach((pid) => {
        const arr = payload.keys[pid];
        if (Array.isArray(arr) && arr.length > 0) set.add(pid);
      });
      return res.json({
        object: "list",
        data: UNIVERSAL_MODELS_LOCAL.map((m) => ({
          id: m.id,
          object: "model",
          created: now,
          owned_by: "edge-router",
          upstream: m.upstream,
          gateway: "Edge Router",
          available: set.has(m.upstream) || set.has("Edge Router") || set.has("prov-universal"),
        })),
      });
    } catch (e: any) {
      return res.status(401).json({
        error: {
          message: e?.code === "EXPIRED" ? "Master key expire ho gayi — Regenerate karo." : "Master key invalid hai.",
          type: "authentication_error",
        },
      });
    }
  }
  const found: string[] = [];
  const pushKey = (v: any) => {
    if (typeof v !== "string") return;
    const t = v.trim();
    if (!t || t.toLowerCase() === "bearer" || t.startsWith("er1.")) return;
    found.push(t);
  };
  pushKey(req.headers?.["x-api-key"]);
  pushKey(req.headers?.["x-gemini-key"]);
  const h = typeof req.headers?.authorization === "string" ? req.headers.authorization : "";
  const m = h.match(/^Bearer\s*(.*)$/i);
  pushKey(m ? m[1] : h);
  const q = (req.query as any)?.key;
  if (Array.isArray(q)) q.forEach(pushKey);
  else pushKey(q);
  const ups = found.length > 0 ? new Set(found.map(detectKeyUpstream)) : null;
  res.json({
    object: "list",
    data: UNIVERSAL_MODELS_LOCAL.map((m) => ({
      id: m.id,
      object: "model",
      created: now,
      owned_by: "edge-router",
      upstream: m.upstream,
      gateway: "Edge Router",
      ...(ups ? { available: ups.has(m.upstream) } : {}),
    })),
  });
});

// Helper to build comprehensive system prompt for the Autonomous Router Operator
function getRouterOperatorInstruction(state?: any): string {
  const activeProv = state?.activeProviderName || state?.activeProvider || "Cerebras / Groq / Gemini";
  const policy = state?.routingPolicy || state?.policy || "lowest-latency";
  const nodes = state?.totalEndpoints || state?.nodeCount || 12;
  const fallback = state?.fallbackChain?.join(" -> ") || "Cerebras -> Groq -> Gemini -> OpenAI";

  return `You are the Chief AI Operator and Autonomous Controller of the "Anycast Edge AI Router & Gateway" web application.

CRITICAL IDENTITY & CONTEXT AWARENESS (WHERE YOU ARE & WHAT YOU ARE IN):
1. WHERE ARE YOU? (Tum kahan ho?)
   You are embedded directly inside the "Anycast Edge AI Router & Gateway" web application running in the user's web browser right now. You are the brains and master operator of this exact screen the user is looking at.

2. WHAT APPLICATION IS THIS? (Kisme chal rahe ho?)
   You are running inside the "Anycast Edge AI Router & Gateway" web application.
   This is a high-performance Edge Load Balancer & Intelligent Inference Gateway that routes AI requests across 300+ global edge locations (Cloudflare, Fastly, AWS Anycast, regional PoPs like Mumbai ap-south-1, Singapore ap-southeast-1, Frankfurt eu-central-1, Virginia us-east-1).
   It load-balances models from Cerebras Systems (ultra-fast 10ms LPU), Groq (18ms LPU), Google Gemini (Gemini 2.5 Flash, 3.1 Pro), DeepSeek (V3/R1 reasoning), OpenAI (GPT-4o), and SiliconFlow.

3. WHAT SECTIONS & TABS EXIST IN THIS APP?
   - Bento Dashboard (Nodes & Policies): Real-time view of 300+ edge nodes, health status, latency stats, and active routing algorithm.
   - Edge Tester: Interactive playground where you or the user can dispatch test prompts through the edge router, measuring TTFT (time to first token), total latency, and tokens/sec.
   - Daily Quota & Cost Tracker: Real-time request and token consumption meters, cost tracking, and reset buttons.
   - Telemetry & Logs: Performance charts, p95/p99 latency distribution, and regional health metrics.
   - CONNECT (your own AI provider): Generates the user's UNIQUE master key (er1...) that works as their own provider in Claude Code (ANTHROPIC_BASE_URL=<host>/api/anthropic), OpenCode, Cline, Continue, Cursor, curl, Python, Node. Also manages CUSTOM ENDPOINTS (user's own OpenAI-compat base URL + key + model) and Cloudflare Worker self-host code.
   - API Monitor: Live per-key health dashboard — which key is WORKING / EXHAUSTED (429 cooldown) / DEAD, per-key latency + test buttons. 27 providers supported (Gemini, Groq, OpenRouter, Cerebras, OpenAI, Anthropic, DeepSeek, Mistral, xAI, Perplexity, Together, Fireworks, SiliconFlow, Novita, Hyperbolic, Chutes, GLHF, Cohere, Zhipu GLM, Qwen, Moonshot/Kimi, GitHub Models, HuggingFace, SambaNova, Nebius, DeepInfra, Pollinations-free) with smart auto-rotation.
   - API Monitor: Live per-key health dashboard — which key is WORKING / EXHAUSTED (429 cooldown) / DEAD, per-key latency + test buttons. 27 providers supported (Gemini, Groq, OpenRouter, Cerebras, OpenAI, Anthropic, DeepSeek, Mistral, xAI, Perplexity, Together, Fireworks, SiliconFlow, Novita, Hyperbolic, Chutes, GLHF, Cohere, Zhipu GLM, Qwen, Moonshot/Kimi, GitHub Models, HuggingFace, SambaNova, Nebius, DeepInfra, Pollinations-free) with smart auto-rotation.

4. WHO ARE YOU & WHAT ARE YOUR CAPABILITIES? (Tum kya kar sakte ho?)
   You have 100% FULL ADMINISTRATIVE ROOT CONTROL over this entire Edge Router! You are NOT a detached external chatbot — you are the master controller of this application.
   If the user asks:
   - "Tum kahan ho?" -> Answer: "Main Anycast Edge AI Router & Gateway web application ke dashboard mein hoon, jo aapke samne screen par khula hua hai!"
   - "Kisme chal rahe ho?" -> Answer: "Main is Edge AI Router application ke andar aapke Chief AI Operator ke roop mein live chal raha hoon. Ye app 300+ global edge nodes par AI models (Cerebras, Groq, Gemini, DeepSeek, OpenAI) ko load-balance aur route karti hai."
   - "Tum kya kar sakte ho?" -> Explain that you have root administrative access to:
     1. Add, save, and configure API keys for any provider (OpenAI, Groq, Cerebras, Gemini, DeepSeek, etc.)
     2. Switch active providers (e.g. switch to Cerebras for 10ms speed, Groq, or Gemini)
     3. Configure automatic multi-provider failover chains (Cerebras -> Groq -> Gemini -> OpenAI)
     4. Change routing algorithms (lowest-latency, weighted round-robin, regional geo, failover cascade)
     5. Run live global ping sweeps across all edge locations
     6. Dispatch live edge test inferences and measure latency
     7. Reset daily token usage and quota counters
     8. Fully auto-optimize the entire router ("Puri site chala do")

CURRENT ROUTER STATE:
- Active Provider: ${activeProv}
- Routing Policy: ${policy}
- Total Endpoints: ${nodes}
- Cross-Provider Fallback: ${fallback}
- Average Latency: ${state?.avgLatency || "18"}ms
- Site endpoint base: ${state?.siteBaseUrl || "(same origin)/api/v1"}
- Provider catalog: ${(state?.providerCatalog || []).map((p: any) => `${p.id} (${p.baseUrl}, models: ${(p.models || []).slice(0, 3).join("/")}, key:${p.hasKey ? "yes" : "no"})`).join(" | ") || "prov-gemini"}
- Upstream keys: ${(state?.upstreamKeyStatus || []).map((u: any) => `${u.upstream}:${u.hasKey ? "key-yes" : "no-key"}`).join(" | ") || "unknown"} — model WAHI suggest karo jiski key-yes ho; sab no-key ho to pehle KEYS tab me key dalwao, model mat chalwao.
- Active models (verified working, max 40): ${(state?.activeModels || []).join(", ") || "unknown"} — sirf inhi me se suggest karo; bahar ka model naam kabhi mat do.

COMPLETE ADMINISTRATIVE ACTION TAGS (EMIT THESE IN YOUR RESPONSE TO CONTROL THE ROUTER):
Whenever the user asks you to configure, add, update, switch, or optimize anything, you MUST include the corresponding [ACTION:...] tag(s) in your response so the system immediately executes it:

1. API KEY CONFIGURATION:
   - When user provides an API key for any provider (OpenAI, Groq, Cerebras, Gemini, DeepSeek, Anthropic, etc.):
     [ACTION:SET_API_KEY:prov-id:apiKey]
     (e.g., [ACTION:SET_API_KEY:prov-openai:sk-proj-abc123456], [ACTION:SET_API_KEY:prov-groq:gsk_987654321], [ACTION:SET_API_KEY:prov-cerebras:csk-112233], [ACTION:SET_API_KEY:prov-gemini:AIzaSy...])
   - If user provides a general Gemini Key for the copilot:
     [ACTION:SET_GEMINI_KEY:AIzaSy...]

2. PROVIDER & FALLBACK CONTROL:
   - Switch active provider:
     [ACTION:SWITCH_PROVIDER:prov-cerebras]
   - Configure cross-provider failover chain:
     [ACTION:SET_FALLBACK_CHAIN:prov-cerebras,prov-groq,prov-gemini,prov-openai]

3. ADDING PROVIDERS & EDGE NODES:
   - Add a new custom AI Provider:
     [ACTION:ADD_PROVIDER:ProviderName:https://api.example.com/v1:model1,model2:LLM & Multimodal]
   - Add a new Edge Node / Endpoint:
     [ACTION:ADD_ENDPOINT:NodeName:https://endpoint.ai/v1:ap-south-1:prov-id:80]

4. ENDPOINT MANAGEMENT:
   - Enable or Disable an Edge Node:
     [ACTION:TOGGLE_ENDPOINT:endpoint-id]
   - Delete an Edge Node:
     [ACTION:DELETE_ENDPOINT:endpoint-id]

5. ROUTING POLICY & OPTIMIZATION:
   - Change Routing Algorithm:
     [ACTION:CHANGE_POLICY:lowest-latency] (Options: lowest-latency, weighted-round-robin, regional-geo, failover-cascade, cost-optimized)
   - Global Ping Sweep:
     [ACTION:RUN_PING_SWEEP]
   - Complete 1-Click Site Optimization:
     [ACTION:AUTO_OPTIMIZE]

6. QUOTA & TESTING:
   - Reset Quota Counter:
     [ACTION:RESET_QUOTA]
   - Run Instant Edge Test Inference Dispatch:
     [ACTION:RUN_EDGE_TEST:User Prompt or test message]

7. NAVIGATION & KEYS:
   - Switch View Tab:
     [ACTION:SWITCH_TAB:dashboard] (Options: dashboard, tester, quota, telemetry, export, monitor)
   - Generate New Edge Router Proxy Key:
     [ACTION:GENERATE_PROXY_KEY]

RESPONSE STYLE (STRICT — SHORT & PROFESSIONAL):
1. Default reply: 2-4 lines summary + short bullets. No lectures, no filler words.
2. Full detail/steps ONLY when the user explicitly asks (e.g. "detail me batao", "explain fully").
3. When the user asks for a command, endpoint URL, key steps or code: give it FIRST in a fenced code block, then max 1-line note. Never bury commands inside paragraphs.
4. Action receipts: one short line per executed action.

SITE GATEWAY CONTEXT (ONE universal provider — official ID: Edge Router):
- Jaha bhi provider ID dalni pade, waha "Edge Router" dalo. Model naam se auto-route hota hai, ID optional hai.
- Public endpoint: {siteBaseUrl}/chat/completions (OpenAI-compatible). siteBaseUrl is given in CURRENT ROUTER STATE below.
- Auth header: Authorization: Bearer <user's UNIQUE master key from Export tab>.
- Sirf model naam bhejo — server model se upstream auto-route karta hai (gemini-* → Gemini, llama-3.3-70b-versatile → Groq, openai/* → OpenRouter, llama-3.3-70b → Cerebras).
- Fill curl/python/node snippets with THESE exact values in fenced code blocks so the user can 1-click copy. providerId kabhi mat maango, snippets me mat dalo.

MASTER KEY FLOW (external tools ke liye — endpoint/commands maangne pe):
- Site endpoint: {siteBaseUrl}/chat/completions (OpenAI-compatible). siteBaseUrl CURRENT ROUTER STATE me hai.
- Har user ki UNIQUE master key: Export tab → Generate. Raw provider keys bahar share mat karwao.
- Master me saari provider keys embedded hoti hai (90 din valid); Delete = turant cut; Regenerate = nayi.
- Pool badle (key add/remove) to master Regenerate karni padti hai.
- Koi key dead ho to uski Gmail tag batao taaki user usi account se nayi nikaal le.

CRITICAL LANGUAGE & VOICE MATCHING MANDATE:
1. ALWAYS detect and reply in the EXACT SAME language, dialect, and script that the user uses:
   - If user speaks or writes in Hindi (देवनागरी या Roman Hinglish, e.g. "Tum kahan ho", "Site chala do"), reply in fluent, crystal-clear, friendly Hindi/Hinglish.
   - If user writes/speaks in English, reply in crisp English.
2. Be confident, warm, proactive, and direct. When user asks who you are, where you are, or what you can do, explain proudly and clearly!`;
}

// Router Copilot API - Autonomous Site Operator
app.post("/api/copilot/chat", async (req, res) => {
  try {
    const { messages, currentRouterState, modelType, userApiKey } = req.body;
    const clientKey = (req.headers["x-gemini-key"] as string) || userApiKey;
    const ai = await getGenAIClient(clientKey);

    let model = "gemini-3.5-flash";
    if (modelType === "complex" || modelType === "reasoning") {
      model = "gemini-3.1-pro-preview";
    } else if (modelType === "fast" || modelType === "lite") {
      model = "gemini-3.1-flash-lite";
    }

    const systemInstruction = getRouterOperatorInstruction(currentRouterState);

    // Convert chat history into contents format
    const contents = messages.map((m: { role: string; content: string }) => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.content }],
    }));

    const response = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction,
        temperature: 0.7,
        maxOutputTokens: 500,
      },
    });

    const replyText = response.text || "Action executed.";
    res.json({
      text: replyText,
      modelUsed: model,
    });
  } catch (error: any) {
    console.error("Chat error:", error);
    res.status(500).json({
      error: error.message || "Failed to generate AI response",
    });
  }
});

// Real-time Text-To-Speech for voice replies
app.post("/api/copilot/tts", async (req, res) => {
  try {
    const { text, userApiKey } = req.body;
    const clientKey = (req.headers["x-gemini-key"] as string) || userApiKey;
    const ai = await getGenAIClient(clientKey);
    const { Modality } = await import("@google/genai");

    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-tts-preview",
      contents: [{ parts: [{ text: text.slice(0, 500) }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: "Kore" },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      return res.status(404).json({ error: "No audio generated" });
    }

    res.json({ audio: base64Audio });
  } catch (error: any) {
    console.error("TTS error:", error);
    res.status(500).json({ error: error.message || "TTS generation failed" });
  }
});

// Tester inference via universal relay (model naam se auto-route, key rotation).
app.post("/api/router/inference", async (req, res) => {
  const startTime = Date.now();
  try {
    const body = req.body || {};
    const { prompt, model, clientApiKey } = body;

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Missing prompt parameter" });
    }
    const custom = resolveCustomBase(body);
    if (custom.error) return res.status(400).json({ error: custom.error });
    const pool = await resolveKeyPool(req, body, "Edge Router");
    const keys = pool.keys;
    if (keys.length === 0) {
      return res.status(401).json({ error: pool.error || "Login required: KEYS me key dalo." });
    }

    const wanted = wantedModelUniversal(model, "gemini-flash-latest");
    const target = custom.baseUrl ? null : upstreamForModel(wanted);
    const ordered = custom.baseUrl ? keys : orderPoolLocal(keys, target, wanted);
    const retryable = (st: number) =>
      [401, 403, 429, 500, 502, 503, 504].includes(st) || (!target && !custom.baseUrl && [400, 404].includes(st));
    const deadKeyPrefixes: string[] = [];
    const rateLimitedPrefixes: string[] = [];
    let lastErr = "unknown error";
    for (let i = 0; i < ordered.length; i++) {
      const itemBase = !custom.baseUrl && ordered[i].base ? ordered[i].base : null;
      const effHint = custom.baseUrl || itemBase ? "custom" : ordered[i].hint;
      const served = custom.baseUrl || itemBase ? "custom" : effHint === "unknown" ? target || "prov-gemini" : effHint;
      const up: any = custom.baseUrl ? { name: "Custom", baseUrl: custom.baseUrl } : itemBase ? { name: "Custom", baseUrl: itemBase } : UPSTREAMS[served];
      const kh = keyHashLocal(ordered[i].key);
      keyLastUsedLocal.set(kh, Date.now());
      const r = await relayChatCompletion({
        baseUrl: up.baseUrl,
        apiKey: ordered[i].key,
        model: wanted,
        messages: [{ role: "user", content: prompt }],
        maxTokens: 600,
        temperature: 0.7,
        native: itemBase ? undefined : up.native,
      });
      if (r.ok && r.data?.choices?.[0]) {
        keyCooldownUntilLocal.delete(kh);
        keyFail429Local.delete(kh);
        keyFailOtherLocal.delete(kh);
        const latencyMs = Date.now() - startTime;
        const text = r.data.choices[0].message?.content || "OK";
        const tokens = r.data.usage?.total_tokens || Math.max(15, Math.ceil(text.length / 4) + Math.ceil(prompt.length / 4));
        res.setHeader("X-Edge-Provider", "Edge Router");
        res.setHeader("X-Edge-Upstream", served);
        res.setHeader("X-Edge-Key-Index", String(i));
        return res.json({
          status: "ok",
          isLive: true,
          response: text,
          modelUsed: r.data.model || wanted,
          providerId: "Edge Router",
          providerName: up.name,
          upstreamId: served,
          keyIndex: i,
          key_prefix: ordered[i].key.slice(0, 8),
          dead_key_prefixes: deadKeyPrefixes,
          rate_limited_prefixes: rateLimitedPrefixes,
          latencyMs,
          tokens,
        });
      }
      lastErr = r.data?.error?.message || r.data?.message || `Upstream HTTP ${r.status}`;
      if (r.status === 429) {
        keyCooldownUntilLocal.set(kh, Date.now() + COOLDOWN_MS_LOCAL);
        keyFail429Local.set(kh, (keyFail429Local.get(kh) || 0) + 1);
        rateLimitedPrefixes.push(ordered[i].key.slice(0, 8));
      } else if (r.status === 401 || r.status === 403) {
        keyFailOtherLocal.set(kh, (keyFailOtherLocal.get(kh) || 0) + 1);
        if (effHint === served && served !== "unknown") deadKeyPrefixes.push(ordered[i].key.slice(0, 8));
      } else {
        keyFailOtherLocal.set(kh, (keyFailOtherLocal.get(kh) || 0) + 1);
      }
      if (!retryable(r.status)) break;
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
});

// Universal public gateway (OpenAI-compatible): model naam se auto-route, key rotation.
app.post("/api/v1/chat/completions", async (req, res) => {
  const startTime = Date.now();
  try {
    const body = req.body || {};
    const { messages = [], model, max_tokens = 800, temperature = 0.7 } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: { message: "Invalid messages array", type: "invalid_request_error" } });
    }

    const custom = resolveCustomBase(body);
    if (custom.error) {
      return res.status(400).json({ error: { message: custom.error, type: "invalid_request_error" } });
    }
    const pool = await resolveKeyPool(req, body, "Edge Router");
    const keys = pool.keys;
    if (keys.length === 0) {
      return res.status(401).json({
        error: {
          message: pool.error || "API key dalo: KEYS me add karo, fir link + master key (ya direct key) bhejo.",
          type: "authentication_error",
        },
      });
    }

    const wanted = wantedModelUniversal(model, "gemini-flash-latest");
    const target = custom.baseUrl ? null : upstreamForModel(wanted);
    const ordered = custom.baseUrl ? keys : orderPoolLocal(keys, target, wanted);
    const openaiMessages = messages.map((m: any) => ({
      role: m.role === "system" || m.role === "assistant" || m.role === "user" ? m.role : "user",
      content: typeof m.content === "string" ? m.content : "",
    }));
    const retryable = (st: number) =>
      [401, 403, 429, 500, 502, 503, 504].includes(st) || (!target && !custom.baseUrl && [400, 404].includes(st));

    let lastErr = "unknown error";
    const deadKeyIndexes: number[] = [];
    const deadKeyPrefixes: string[] = [];
    const rateLimitedPrefixes: string[] = [];
    for (let i = 0; i < ordered.length; i++) {
      const itemBase = !custom.baseUrl && ordered[i].base ? ordered[i].base : null;
      const effHint = custom.baseUrl || itemBase ? "custom" : ordered[i].hint;
      const served = custom.baseUrl || itemBase ? "custom" : effHint === "unknown" ? target || "prov-gemini" : effHint;
      const up: any = custom.baseUrl ? { name: "Custom", baseUrl: custom.baseUrl } : itemBase ? { name: "Custom", baseUrl: itemBase } : UPSTREAMS[served];
      const kh = keyHashLocal(ordered[i].key);
      keyLastUsedLocal.set(kh, Date.now());
      const r = await relayChatCompletion({ baseUrl: up.baseUrl, apiKey: ordered[i].key, model: wanted, messages: openaiMessages, maxTokens: max_tokens, temperature, native: itemBase ? undefined : up.native });
      if (r.ok) {
        keyCooldownUntilLocal.delete(kh);
        keyFail429Local.delete(kh);
        keyFailOtherLocal.delete(kh);
        const latencyMs = Date.now() - startTime;
        const d = r.data || {};
        const choice = d.choices?.[0];
        const responseText = choice?.message?.content || "";
        const usage = d.usage || {};
        const promptTokens = usage.prompt_tokens ?? openaiMessages.reduce((acc: number, m: any) => acc + Math.ceil((m.content || "").length / 4), 0);
        const completionTokens = usage.completion_tokens ?? Math.ceil(responseText.length / 4);
        res.setHeader("X-Edge-Provider", "Edge Router");
        res.setHeader("X-Edge-Upstream", served);
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
            provider: up.name,
            // Canonical site provider ID — jaha ID dalni ho, yahi dalo:
            provider_id: "Edge Router",
            upstream_id: served,
            key_index: i,
            key_prefix: ordered[i].key.slice(0, 8),
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
      if (r.status === 429) {
        keyCooldownUntilLocal.set(kh, Date.now() + COOLDOWN_MS_LOCAL);
        keyFail429Local.set(kh, (keyFail429Local.get(kh) || 0) + 1);
        rateLimitedPrefixes.push(ordered[i].key.slice(0, 8));
      } else if (r.status === 401 || r.status === 403) {
        keyFailOtherLocal.set(kh, (keyFailOtherLocal.get(kh) || 0) + 1);
        if (effHint === served && served !== "unknown") {
          deadKeyIndexes.push(i);
          deadKeyPrefixes.push(ordered[i].key.slice(0, 8));
        }
      } else {
        keyFailOtherLocal.set(kh, (keyFailOtherLocal.get(kh) || 0) + 1);
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
});

// ---- Anthropic-compatible Messages API (Claude Code) — parity with api/anthropic/v1/messages.ts ----
function anthBlocksToText(blocks: any[]): string {
  return (blocks || []).filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join("");
}

function anthToOpenAIMessages(system: any, messages: any[]): any[] {
  const sys = typeof system === "string" ? system : Array.isArray(system) ? anthBlocksToText(system) : "";
  const msgs: any[] = [];
  for (const m of messages || []) {
    const role = m?.role === "assistant" ? "assistant" : "user";
    const c = m?.content;
    if (typeof c === "string") { msgs.push({ role, content: c }); continue; }
    if (!Array.isArray(c)) continue;
    const texts: string[] = [];
    const images: any[] = [];
    const toolResults: any[] = [];
    const toolUses: any[] = [];
    for (const b of c) {
      if (!b || typeof b !== "object") continue;
      if (b.type === "text" && typeof b.text === "string") texts.push(b.text);
      else if (b.type === "image" && b.source?.type === "base64" && b.source?.data) {
        const mt = typeof b.source.media_type === "string" ? b.source.media_type : "image/jpeg";
        images.push({ type: "image_url", image_url: { url: `data:${mt};base64,${b.source.data}` } });
      } else if (b.type === "tool_result") toolResults.push(b);
      else if (b.type === "tool_use") toolUses.push(b);
    }
    if (role === "assistant") {
      const content = texts.join("");
      const tool_calls = toolUses.map((t) => ({
        id: typeof t.id === "string" ? t.id : `call_${Math.random().toString(36).slice(2)}`,
        type: "function",
        function: { name: typeof t.name === "string" ? t.name : "tool", arguments: typeof t.input === "string" ? t.input : JSON.stringify(t.input ?? {}) },
      }));
      if (content || tool_calls.length > 0) msgs.push({ role: "assistant", content, ...(tool_calls.length > 0 ? { tool_calls } : {}) });
    } else {
      if (texts.length > 0 || images.length > 0) {
        if (images.length > 0) {
          const parts: any[] = [];
          if (texts.length > 0) parts.push({ type: "text", text: texts.join("") });
          parts.push(...images);
          msgs.push({ role: "user", content: parts });
        } else msgs.push({ role: "user", content: texts.join("") });
      }
      for (const tr of toolResults) {
        const tcId = typeof tr.tool_use_id === "string" ? tr.tool_use_id : "unknown";
        const cc = tr.content;
        const text = typeof cc === "string" ? cc : Array.isArray(cc) ? anthBlocksToText(cc) : JSON.stringify(cc ?? "");
        msgs.push({ role: "tool", tool_call_id: tcId, content: (tr.is_error ? "Error: " : "") + text });
      }
    }
  }
  if (sys) msgs.unshift({ role: "system", content: sys });
  if (msgs.length === 0) msgs.push({ role: "user", content: "hi" });
  return msgs;
}

function anthToOpenAITools(tools: any): any[] | undefined {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  const out: any[] = [];
  for (const t of tools) {
    if (!t || typeof t.name !== "string") continue;
    out.push({ type: "function", function: { name: t.name, description: typeof t.description === "string" ? t.description : "", parameters: t.input_schema && typeof t.input_schema === "object" ? t.input_schema : { type: "object", properties: {} } } });
  }
  return out.length > 0 ? out : undefined;
}

function anthToolChoice(tc: any): any {
  if (!tc || tc.type === "auto") return "auto";
  if (tc.type === "any") return "required";
  if (tc.type === "tool" && typeof tc.name === "string") return { type: "function", function: { name: tc.name } };
  return "auto";
}

function anthFinishToStop(fr: string | undefined, hasTools: boolean): string {
  if (fr === "length") return "max_tokens";
  if (fr === "tool_calls" || hasTools) return "tool_use";
  return "end_turn";
}

function anthMsgToBlocks(msg: any): { blocks: any[]; hasTools: boolean } {
  const blocks: any[] = [];
  const text = typeof msg?.content === "string" ? msg.content : "";
  if (text) blocks.push({ type: "text", text });
  let hasTools = false;
  if (Array.isArray(msg?.tool_calls)) {
    for (const tc of msg.tool_calls) {
      if (tc?.type !== "function" && tc?.type !== undefined) continue;
      hasTools = true;
      let input: any = {};
      try { input = JSON.parse(tc.function?.arguments || "{}"); } catch { input = {}; }
      blocks.push({ type: "tool_use", id: tc.id || `toolu_${Math.random().toString(36).slice(2)}`, name: tc.function?.name || "tool", input });
    }
  }
  if (blocks.length === 0) blocks.push({ type: "text", text: "" });
  return { blocks, hasTools };
}

function orderPoolAnthropicLocal(pool: PoolItemLocal[]): PoolItemLocal[] {
  const now = Date.now();
  const bucket = (p: PoolItemLocal): number => {
    if (p.hint === "prov-anthropic") return 0;
    if (p.hint === "unknown") return 1;
    const i = UPSTREAM_PRIORITY.indexOf(p.hint);
    return 2 + (i === -1 ? 50 : i);
  };
  return [...pool].map((p, idx) => ({ p, idx })).sort((a, b) => {
    const ba = bucket(a.p), bb = bucket(b.p);
    if (ba !== bb) return ba - bb;
    const ca = (keyCooldownUntilLocal.get(keyHashLocal(a.p.key)) || 0) > now ? 1 : 0;
    const cb = (keyCooldownUntilLocal.get(keyHashLocal(b.p.key)) || 0) > now ? 1 : 0;
    if (ca !== cb) return ca - cb;
    const fa = (keyFail429Local.get(keyHashLocal(a.p.key)) || 0) * 3 + (keyFailOtherLocal.get(keyHashLocal(a.p.key)) || 0);
    const fb = (keyFail429Local.get(keyHashLocal(b.p.key)) || 0) * 3 + (keyFailOtherLocal.get(keyHashLocal(b.p.key)) || 0);
    if (fa !== fb) return fa - fb;
    const la = keyLastUsedLocal.get(keyHashLocal(a.p.key)) || 0, lb = keyLastUsedLocal.get(keyHashLocal(b.p.key)) || 0;
    if (la !== lb) return la - lb;
    return a.idx - b.idx;
  }).map((e) => e.p);
}

app.post("/api/anthropic/v1/messages", async (req, res) => {
  const anthErr = (status: number, message: string, type = "api_error") =>
    res.status(status).json({ type: "error", error: { type, message: String(message || "error").slice(0, 500) } });
  try {
    const body = req.body || {};
    const model = typeof body.model === "string" && body.model ? body.model : "claude-3-5-haiku-latest";
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (messages.length === 0) return anthErr(400, "messages: must not be empty", "invalid_request_error");
    const maxTokens = Math.max(1, Math.min(typeof body.max_tokens === "number" ? body.max_tokens : 1024, 8192));
    const temperature = typeof body.temperature === "number" ? body.temperature : 0.7;
    const wantStream = body.stream === true;
    const stopSequences: string[] = Array.isArray(body.stop_sequences) ? body.stop_sequences.filter((s: any) => typeof s === "string").slice(0, 4) : [];

    const rawPool = collectRelayKeys(req, body);
    if (typeof body.masterKey === "string" && body.masterKey.trim().startsWith(MASTER_PREFIX) && !rawPool.some((p) => p.key.startsWith(MASTER_PREFIX))) {
      rawPool.push({ key: body.masterKey.trim(), hint: "unknown" });
    }
    // Master wins: reuse the same flatten path as the gateways.
    let effPool = rawPool;
    const maybeMaster = rawPool.find((p) => p.key.startsWith(MASTER_PREFIX))?.key || "";
    if (maybeMaster) {
      const resolved = await resolveKeyPool(req, { ...body, apiKeys: [maybeMaster] }, "Edge Router");
      if (resolved.keys.length === 0) return anthErr(401, resolved.error || "Master key invalid hai.", "authentication_error");
      effPool = resolved.keys;
    }
    if (effPool.length === 0) return anthErr(401, "API key dalo: ANTHROPIC_API_KEY me apni er1 master key rakho.", "authentication_error");

    const msgs = anthToOpenAIMessages(body.system, messages);
    const oaiTools = anthToOpenAITools(body.tools);
    const oaiToolChoice = oaiTools ? anthToolChoice(body.tool_choice) : undefined;
    const ordered = orderPoolAnthropicLocal(effPool);
    const msgId = `msg_router${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    let lastErr = "unknown error";
    let lastStatus = 502;

    for (let i = 0; i < ordered.length; i++) {
      const item = ordered[i];
      const itemBase = item.base || null;
      const servedId = itemBase ? "custom" : item.hint === "unknown" ? "prov-anthropic" : item.hint;
      const isNative = !itemBase && servedId === "prov-anthropic";
      const serveModel = itemBase ? model : isNative ? model : (model.startsWith("claude-") ? (UPSTREAMS[servedId]?.defaultModel || model) : model);
      const h = keyHashLocal(item.key);
      keyLastUsedLocal.set(h, Date.now());
      try {
        if (isNative) {
          const fwd: any = { model, max_tokens: maxTokens, messages, temperature, ...(wantStream ? { stream: true } : {}) };
          if (typeof body.system !== "undefined") fwd.system = body.system;
          if (Array.isArray(body.tools)) fwd.tools = body.tools;
          if (typeof body.tool_choice !== "undefined") fwd.tool_choice = body.tool_choice;
          if (stopSequences.length > 0) fwd.stop_sequences = stopSequences;
          const beta = typeof req.headers["anthropic-beta"] === "string" ? req.headers["anthropic-beta"] : "";
          const resp = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": item.key, "anthropic-version": "2023-06-01", ...(beta ? { "anthropic-beta": beta } : {}) },
            body: JSON.stringify(fwd),
          });
          if (resp.ok) {
            if (wantStream && resp.body) {
              res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Edge-Upstream": "prov-anthropic" });
              const reader = resp.body.getReader();
              const dec = new TextDecoder();
              try {
                for (;;) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  res.write(dec.decode(value, { stream: true }));
                }
              } finally { try { reader.releaseLock(); } catch {} }
              return res.end();
            }
            const data: any = await resp.json().catch(() => null);
            res.setHeader("X-Edge-Upstream", "prov-anthropic");
            return res.json(data);
          }
          const edata: any = await resp.json().catch(() => null);
          lastErr = edata?.error?.message || `Anthropic HTTP ${resp.status}`;
          lastStatus = resp.status;
          if (resp.status === 429) {
            keyCooldownUntilLocal.set(h, Date.now() + COOLDOWN_MS_LOCAL);
            keyFail429Local.set(h, (keyFail429Local.get(h) || 0) + 1);
          } else {
            keyFailOtherLocal.set(h, (keyFailOtherLocal.get(h) || 0) + 1);
          }
          if (![401, 403, 429, 500, 502, 503, 504].includes(resp.status)) break;
          continue;
        }
        const base = itemBase || UPSTREAMS[servedId]?.baseUrl || UPSTREAMS["prov-gemini"].baseUrl;
        const oaiBody: any = {
          model: serveModel, messages: msgs, max_tokens: maxTokens, temperature,
          ...(oaiTools ? { tools: oaiTools, tool_choice: oaiToolChoice } : {}),
          ...(stopSequences.length > 0 ? { stop: stopSequences } : {}),
          ...(wantStream ? { stream: true } : {}),
        };
        const resp = await fetch(`${base.replace(/\/+$/, "")}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${item.key}`, "HTTP-Referer": "https://edge-ai-router.vercel.app", "X-Title": "Edge Router" },
          body: JSON.stringify(oaiBody),
        });
        if (!resp.ok) {
          const edata: any = await resp.json().catch(() => null);
          lastErr = edata?.error?.message || edata?.message || `Upstream HTTP ${resp.status}`;
          lastStatus = resp.status;
          if (resp.status === 429) {
            keyCooldownUntilLocal.set(h, Date.now() + COOLDOWN_MS_LOCAL);
            keyFail429Local.set(h, (keyFail429Local.get(h) || 0) + 1);
          } else {
            keyFailOtherLocal.set(h, (keyFailOtherLocal.get(h) || 0) + 1);
          }
          const nativeMatch = serveModel === model;
          const retryable = [401, 403, 429, 500, 502, 503, 504].includes(resp.status) || (!nativeMatch && [400, 404].includes(resp.status));
          if (!retryable) break;
          continue;
        }
        if (!wantStream || !resp.body) {
          const d: any = await resp.json().catch(() => null);
          const choice = d?.choices?.[0];
          const { blocks, hasTools } = anthMsgToBlocks(choice?.message || {});
          const usage = d?.usage || {};
          res.setHeader("X-Edge-Upstream", servedId);
          res.setHeader("X-Edge-Model", serveModel);
          return res.json({
            id: msgId, type: "message", role: "assistant", content: blocks, model,
            stop_reason: anthFinishToStop(choice?.finish_reason, hasTools),
            usage: { input_tokens: usage.prompt_tokens ?? 0, output_tokens: usage.completion_tokens ?? 0 },
          });
        }
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Edge-Upstream": servedId, "X-Edge-Model": serveModel });
        const send = (obj: any) => res.write(`event: ${obj.type}\ndata: ${JSON.stringify(obj)}\n\n`);
        send({ type: "message_start", message: { id: msgId, type: "message", role: "assistant", content: [], model, stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } } });
        let textOpen = false;
        let toolIdx = -1;
        let toolName = "";
        let toolOpen = false;
        let outTokens = 0;
        let finishReason = "stop";
        const openText = () => {
          if (textOpen) return;
          if (toolOpen) { send({ type: "content_block_stop", index: toolIdx }); toolOpen = false; }
          send({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
          textOpen = true;
        };
        const reader = resp.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        const flushBlock = (raw: string) => {
          for (const ln of raw.split("\n")) {
            const line = ln.trim();
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            let j: any = null;
            try { j = JSON.parse(payload); } catch { continue; }
            const delta = j?.choices?.[0]?.delta;
            const fr = j?.choices?.[0]?.finish_reason;
            if (fr) finishReason = fr;
            if (typeof delta?.content === "string" && delta.content) {
              openText();
              outTokens += Math.max(1, Math.ceil(delta.content.length / 4));
              send({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: delta.content } });
            }
            const tcs = Array.isArray(delta?.tool_calls) ? delta.tool_calls : [];
            for (const tc of tcs) {
              const idx = typeof tc.index === "number" ? tc.index : 0;
              if (!toolOpen || idx !== toolIdx) {
                if (textOpen) { send({ type: "content_block_stop", index: 0 }); textOpen = false; }
                if (toolOpen) { send({ type: "content_block_stop", index: toolIdx }); }
                toolIdx = 1 + idx;
                toolName = tc.function?.name || toolName || "tool";
                send({ type: "content_block_start", index: toolIdx, content_block: { type: "tool_use", id: tc.id || `toolu_${Math.random().toString(36).slice(2)}`, name: toolName, input: {} } });
                toolOpen = true;
              }
              if (tc.function?.name) toolName = tc.function.name;
              const args = typeof tc.function?.arguments === "string" ? tc.function.arguments : "";
              if (args) send({ type: "content_block_delta", index: toolIdx, delta: { type: "input_json_delta", partial_json: args } });
            }
            const usage = j?.usage;
            if (usage && typeof usage.completion_tokens === "number") outTokens = usage.completion_tokens;
          }
        };
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const parts = buf.split("\n\n");
            buf = parts.pop() || "";
            for (const p of parts) flushBlock(p);
          }
          if (buf.trim()) flushBlock(buf);
        } finally { try { reader.releaseLock(); } catch {} }
        if (textOpen) send({ type: "content_block_stop", index: 0 });
        if (toolOpen) send({ type: "content_block_stop", index: toolIdx });
        if (!textOpen && !toolOpen) {
          send({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
          send({ type: "content_block_stop", index: 0 });
        }
        send({ type: "message_delta", delta: { stop_reason: anthFinishToStop(finishReason, toolIdx >= 0) }, usage: { output_tokens: outTokens } });
        send({ type: "message_stop" });
        return res.end();
      } catch (e: any) {
        lastErr = `Upstream unreachable: ${e?.message || e}`;
        lastStatus = 502;
        keyFailOtherLocal.set(h, (keyFailOtherLocal.get(h) || 0) + 1);
        continue;
      }
    }
    const type = lastStatus === 401 ? "authentication_error" : lastStatus === 429 ? "rate_limit_error" : lastStatus === 404 ? "not_found_error" : "api_error";
    return anthErr(lastStatus === 401 || lastStatus === 429 || lastStatus === 404 ? lastStatus : 502, `${lastErr} (${ordered.length} keys tried)`, type);
  } catch (err: any) {
    console.error("anthropic/messages error:", err);
    return anthErr(500, err?.message || "messages failed");
  }
});

// ---- Master key issue/status/revoke (local-dev parity with api/keys/*) ----
const MASTER_TTL_MS = 90 * 86400 * 1000;
const MAX_KEYS_PER_PROVIDER = 30;
const MAX_KEYS_TOTAL = 120;

function masterEncryptLocal(payload: any): string {
  const raw = deflateSync(Buffer.from(JSON.stringify(payload), "utf8"));
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", masterSecretBuf(), iv);
  const ct = Buffer.concat([c.update(raw), c.final()]);
  return MASTER_PREFIX + Buffer.concat([iv, ct, c.getAuthTag()]).toString("base64url");
}

function extractMasterLocal(req: any, body: any): string {
  const cands = [req.headers?.["x-master-key"], bearerTokenLocal(req), body?.masterKey];
  for (const c of cands) {
    if (typeof c === "string" && c.trim().startsWith(MASTER_PREFIX)) return c.trim();
  }
  return "";
}

async function kvSetExLocal(key: string, val: string, secs: number): Promise<boolean> {
  const url = process.env.KV_REST_API_URL;
  const tok = process.env.KV_REST_API_TOKEN;
  if (!url || !tok) return false;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify(["SET", key, val, "EX", String(Math.max(60, Math.floor(secs)))]),
      signal: ctl.signal,
    });
    clearTimeout(t);
    const j: any = await r.json().catch(() => null);
    return j?.result === "OK";
  } catch {
    return false;
  }
}

app.post("/api/keys/issue", async (req, res) => {
  try {
    const body = req.body || {};
    const input = body.keys && typeof body.keys === "object" ? body.keys : null;
    if (!input) return res.status(400).json({ error: "Missing keys object" });
    const label = typeof body.label === "string" ? body.label.slice(0, 40) : "";
    const pools: Record<string, { k: string; g: string; u?: string; b?: string; m?: string }[]> = {};
    let total = 0;
    for (const pid of Object.keys(input)) {
      if (!Array.isArray(input[pid])) return res.status(400).json({ error: `keys['${pid}'] array honi chahiye` });
      if (input[pid].length > MAX_KEYS_PER_PROVIDER) return res.status(400).json({ error: `${pid}: max ${MAX_KEYS_PER_PROVIDER} keys per provider` });
      const arr: { k: string; g: string; u?: string; b?: string; m?: string }[] = [];
      for (const v of input[pid]) {
        const k = typeof v === "string" ? v.replace(/[\s'"`]+/g, "").trim() : typeof v?.k === "string" ? v.k.replace(/[\s'"`]+/g, "").trim() : "";
        if (k.length < 10) return res.status(400).json({ error: `${pid}: ek key bahut chhoti hai` });
        const rawG = typeof v?.g === "string" ? v.g.trim() : "";
        const rawU = typeof v?.u === "string" ? v.u.trim() : "";
        const rawB = typeof v?.b === "string" ? v.b.trim().replace(/\/+$/, "") : "";
        const rawM = typeof v?.m === "string" ? v.m.trim().slice(0, 120) : "";
        if (rawB && (rawB.length > 200 || !isAllowedUpstream(rawB))) {
          return res.status(400).json({ error: `${pid}: custom base URL public https hona chahiye (${rawB.slice(0, 60)})` });
        }
        arr.push({ k, g: /.+@.+\..{2,}/.test(rawG) ? rawG : "", ...(rawU && KNOWN_UPSTREAMS_LOCAL.has(rawU) ? { u: rawU } : {}), ...(rawB ? { b: rawB } : {}), ...(rawM ? { m: rawM } : {}) });
        total++;
      }
      if (arr.length > 0) pools[pid] = arr;
    }
    if (total === 0) return res.status(400).json({ error: "Kam se kam 1 key dalo" });
    if (total > MAX_KEYS_TOTAL) return res.status(400).json({ error: `Max ${MAX_KEYS_TOTAL} keys per master key.` });
    const mid = crypto.randomBytes(8).toString("hex");
    const exp = Date.now() + MASTER_TTL_MS;
    const masterKey = masterEncryptLocal({ v: 1, mid, exp, label, keys: pools });
    const providers: Record<string, { count: number; gmails: string[] }> = {};
    for (const pid of Object.keys(pools)) {
      providers[pid] = { count: pools[pid].length, gmails: [...new Set(pools[pid].map((e) => e.g).filter(Boolean))] };
    }
    const resp: any = { masterKey, mid, label, expiresAt: exp, providers, tokenSize: masterKey.length };
    if (masterKey.length > 7000) resp.sizeWarn = `Master token ${masterKey.length} chars ka hai (Vercel 4.5MB response limit OK, lekin header me mat bhejo — body.masterKey use karo).`;
    return res.json(resp);
  } catch (err: any) {
    return res.status(500).json({ error: "Issue fail ho gaya" });
  }
});

app.post("/api/keys/status", async (req, res) => {
  try {
    const token = extractMasterLocal(req, req.body || {});
    if (!token) return res.status(401).json({ valid: false, error: "Master key (er1...) dalo." });
    let payload: any;
    try {
      payload = masterDecryptLocal(token);
    } catch {
      return res.status(401).json({ valid: false, error: "Master key invalid hai." });
    }
    const providers: Record<string, { count: number; gmails: string[] }> = {};
    for (const pid of Object.keys(payload.keys || {})) {
      const arr = Array.isArray(payload.keys[pid]) ? payload.keys[pid] : [];
      providers[pid] = {
        count: arr.length,
        gmails: [...new Set(arr.map((e: any) => (typeof e?.g === "string" ? e.g : "")).filter(Boolean))],
      };
    }
    return res.json({ valid: true, mid: payload.mid || "", label: payload.label || "", expiresAt: payload.exp, providers });
  } catch {
    return res.status(500).json({ valid: false, error: "Status fail ho gaya" });
  }
});

// Single-key live probe — local-dev parity with api/keys/test.ts (MONITOR tab).
app.post("/api/keys/test", async (req, res) => {
  const t0 = Date.now();
  try {
    const body = req.body || {};
    const key = typeof body.key === "string" ? body.key.trim() : "";
    if (!key || key.length < 10) return res.status(400).json({ ok: false, error: "key dalo (full key)" });
    const hint = typeof body.upstream === "string" ? body.upstream.trim() : "";
    const customBase = typeof body.baseUrl === "string" ? body.baseUrl.trim().replace(/\/+$/, "") : "";
    const customModel = typeof body.model === "string" ? body.model.trim().slice(0, 120) : "";
    if (customBase) {
      if (customBase.length > 200 || !isAllowedUpstream(customBase)) {
        return res.json({ ok: false, upstream: "custom", latencyMs: Date.now() - t0, error: "baseUrl public https hona chahiye." });
      }
      const model = customModel || "default";
      try {
        const rr2 = await Promise.race([
          relayChatCompletion({ baseUrl: customBase, apiKey: key, model, messages: [{ role: "user", content: "ping" }], maxTokens: 5, temperature: 0 }),
          new Promise<never>((_, rej) => setTimeout(() => { const e: any = new Error("timeout"); e.name = "AbortError"; rej(e); }, 25000)),
        ]);
        if (rr2.ok) return res.json({ ok: true, upstream: "custom", model, latencyMs: Date.now() - t0, prefix: key.slice(0, 8) });
        const msg2 = rr2.data?.error?.message || rr2.data?.message || `HTTP ${rr2.status}`;
        return res.json({ ok: false, upstream: "custom", model, latencyMs: Date.now() - t0, status: rr2.status, prefix: key.slice(0, 8), error: String(msg2).slice(0, 200) });
      } catch (e: any) {
        return res.json({ ok: false, upstream: "custom", model, latencyMs: Date.now() - t0, status: e?.name === "AbortError" ? "timeout" : "network", error: e?.name === "AbortError" ? "Timeout (25s)" : `Network: ${e?.message || e}` });
      }
    }
    const upstream = hint && UPSTREAMS[hint] ? hint : detectKeyUpstream(key);
    if (upstream === "unknown" || !UPSTREAMS[upstream]) {
      return res.json({ ok: false, upstream: "unknown", latencyMs: Date.now() - t0, error: "Upstream pehchana nahi gaya — KEYS me is key pe provider tag select karo, fir test karo." });
    }
    const up = UPSTREAMS[upstream];
    let rr: { ok: boolean; status: number; data: any };
    try {
      rr = await Promise.race([
        relayChatCompletion({ baseUrl: up.baseUrl, apiKey: key, model: up.defaultModel, messages: [{ role: "user", content: "ping" }], maxTokens: 5, temperature: 0, native: up.native }),
        new Promise<never>((_, rej) => setTimeout(() => { const e: any = new Error("timeout"); e.name = "AbortError"; rej(e); }, 25000)),
      ]);
    } catch (e: any) {
      return res.json({ ok: false, upstream, model: up.defaultModel, latencyMs: Date.now() - t0, status: e?.name === "AbortError" ? "timeout" : "network", error: e?.name === "AbortError" ? "Timeout (25s)" : `Network: ${e?.message || e}` });
    }
    if (rr.ok) return res.json({ ok: true, upstream, model: up.defaultModel, latencyMs: Date.now() - t0, prefix: key.slice(0, 8) });
    const msg = rr.data?.error?.message || rr.data?.message || `HTTP ${rr.status}`;
    return res.json({ ok: false, upstream, model: up.defaultModel, latencyMs: Date.now() - t0, status: rr.status, prefix: key.slice(0, 8), error: String(msg).slice(0, 200) });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Test fail", latencyMs: Date.now() - t0 });
  }
});

app.post("/api/keys/revoke", async (req, res) => {
  try {
    const token = extractMasterLocal(req, req.body || {});
    if (!token) return res.status(400).json({ revoked: false, error: "Master key (er1...) dalo." });
    let payload: any;
    try {
      payload = masterDecryptLocal(token);
    } catch {
      return res.status(400).json({ revoked: false, error: "Master key invalid hai." });
    }
    const mid = typeof payload?.mid === "string" ? payload.mid : "";
    if (!mid) return res.status(400).json({ revoked: false, error: "Master key invalid hai." });
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
      return res.json({ revoked: false, mode: "local-only", message: "KV connected nahi hai — app se key hata do." });
    }
    const ttlSecs = Math.max(60, Math.floor(((payload.exp || Date.now()) - Date.now()) / 1000));
    const ok = await kvSetExLocal(`er:revoked:${mid}`, "1", ttlSecs);
    if (!ok) return res.status(502).json({ revoked: false, mode: "kv-error", error: "KV write fail — dobara try karo." });
    return res.json({ revoked: true, mode: "global", mid, message: "Master key turant cut." });
  } catch {
    return res.status(500).json({ revoked: false, error: "Revoke fail ho gaya" });
  }
});

// Live catalog sync — local-dev parity with api/catalog/sync.ts
async function catalogFetchJson(url: string, headers: Record<string, string>): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, { headers, signal: ctl.signal });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(`HTTP ${r.status}${txt ? `: ${txt.slice(0, 120)}` : ""}`);
    }
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

app.post("/api/catalog/sync", async (req, res) => {
  try {
    const ink = req.body?.keys && typeof req.body.keys === "object" ? req.body.keys : {};
    const first = (v: any): string => {
      if (Array.isArray(v)) {
        const f = v.find((k) => typeof k === "string" && k.trim());
        return f ? f.trim() : "";
      }
      return typeof v === "string" && v.trim() ? v.trim() : "";
    };
    const gk = first(ink.gemini);
    const gqk = first(ink.groq);
    const ck = first(ink.cerebras);

    const [gemini, groq, openrouter, cerebras] = await Promise.all([
      (async () => {
        if (!gk) return { ok: false as const, models: [] as any[], error: "no-key" };
        try {
          const j: any = await catalogFetchJson(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(gk)}&pageSize=100`,
            {}
          );
          const models: any[] = [];
          for (const m of Array.isArray(j?.models) ? j.models : []) {
            const name = typeof m?.name === "string" ? m.name.replace(/^models\//, "") : "";
            const methods: string[] = Array.isArray(m?.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
            if (!name || !methods.includes("generateContent")) continue;
            if (/embedding|aqa|transcribe|tts|image|video|audio|live|bidi|robotics|lyria|veo|computer-use|deep-research|antigravity/i.test(name)) continue;
            models.push({ id: name, name, upstream: "prov-gemini" });
            if (models.length >= 150) break;
          }
          return { ok: true as const, models };
        } catch (e: any) {
          return { ok: false as const, models: [] as any[], error: e?.name === "AbortError" ? "timeout" : e?.message || "fetch-failed" };
        }
      })(),
      (async () => {
        if (!gqk) return { ok: false as const, models: [] as any[], error: "no-key" };
        try {
          const j: any = await catalogFetchJson("https://api.groq.com/openai/v1/models", { Authorization: `Bearer ${gqk}` });
          const models: any[] = [];
          for (const m of Array.isArray(j?.data) ? j.data : []) {
            const id = typeof m?.id === "string" ? m.id : typeof m === "string" ? m : "";
            if (!id || /whisper|embedding|tts|guard/i.test(id)) continue;
            models.push({ id, name: id, upstream: "prov-groq" });
            if (models.length >= 150) break;
          }
          return { ok: true as const, models };
        } catch (e: any) {
          return { ok: false as const, models: [] as any[], error: e?.name === "AbortError" ? "timeout" : e?.message || "fetch-failed" };
        }
      })(),
      (async () => {
        try {
          const j: any = await catalogFetchJson("https://openrouter.ai/api/v1/models", {});
          const models: any[] = [];
          for (const m of Array.isArray(j?.data) ? j.data : []) {
            const id = typeof m?.id === "string" ? m.id : "";
            if (!id) continue;
            const outMods: string[] = Array.isArray(m?.architecture?.output_modalities) ? m.architecture.output_modalities : [];
            if (outMods.length > 0 && !outMods.includes("text")) continue;
            if (/embedding|audio|video|image|tts|whisper|lyria/i.test(id)) continue;
            // FREE-ONLY: pricing present hai to prompt+completion dono 0 (paid bahar)
            const pr = m?.pricing;
            if (pr && typeof pr === "object") {
              const pp = Number((pr as any).prompt);
              const pc = Number((pr as any).completion);
              if (!Number.isFinite(pp) || !Number.isFinite(pc) || pp !== 0 || pc !== 0) continue;
            }
            models.push({ id, name: typeof m?.name === "string" && m.name ? m.name : id, upstream: "prov-openrouter", free: true });
            if (models.length >= 150) break;
          }
          return { ok: true as const, models };
        } catch (e: any) {
          return { ok: false as const, models: [] as any[], error: e?.name === "AbortError" ? "timeout" : e?.message || "fetch-failed" };
        }
      })(),
      (async () => {
        if (!ck) return { ok: false as const, models: [] as any[], error: "no-key" };
        try {
          const j: any = await catalogFetchJson("https://api.cerebras.ai/v1/models", { Authorization: `Bearer ${ck}` });
          const arr = Array.isArray(j?.data) ? j.data : Array.isArray(j?.models) ? j.models : [];
          if (!Array.isArray(arr) || arr.length === 0) return { ok: false as const, models: [] as any[], error: "unknown-shape" };
          const models: any[] = [];
          for (const m of arr) {
            const id = typeof m?.id === "string" ? m.id : typeof m?.name === "string" ? m.name : typeof m === "string" ? m : "";
            if (!id) continue;
            models.push({ id, name: id, upstream: "prov-cerebras" });
            if (models.length >= 150) break;
          }
          return { ok: true as const, models };
        } catch (e: any) {
          return { ok: false as const, models: [] as any[], error: e?.name === "AbortError" ? "timeout" : e?.message || "fetch-failed" };
        }
      })(),
    ]);

    const models = [...gemini.models, ...groq.models, ...openrouter.models, ...cerebras.models];
    const status = (r: { ok: boolean; models: any[]; error?: string }) =>
      r.ok ? { ok: true as const, count: r.models.length } : { ok: false as const, count: 0, error: r.error || "failed" };
    // Generic OpenAI-compat providers
    const shortOf = (up: string) => up.replace(/^prov-/, "");
    const extraUps = Object.keys(UPSTREAMS).filter((u) => !["prov-gemini", "prov-groq", "prov-openrouter", "prov-cerebras", "prov-anthropic", "prov-perplexity"].includes(u));
    const extras = await Promise.all(
      extraUps.map(async (up) => {
        const k = first(ink[shortOf(up)]);
        if (!k) return { up, r: { ok: false as const, models: [] as any[], error: "no-key" } };
        try {
          const j: any = await catalogFetchJson(`${UPSTREAMS[up].baseUrl.replace(/\/+$/, "")}/models`, { Authorization: `Bearer ${k}` });
          const arr = Array.isArray(j?.data) ? j.data : [];
          const ms: any[] = [];
          for (const m of arr) {
            const id = typeof m?.id === "string" ? m.id : typeof m === "string" ? m : "";
            if (!id || /whisper|embedding|tts|guard|moderation|dall-e|audit/i.test(id)) continue;
            ms.push({ id, name: id, upstream: up });
            if (ms.length >= 150) break;
          }
          return { up, r: { ok: true as const, models: ms } };
        } catch (e: any) {
          return { up, r: { ok: false as const, models: [] as any[], error: e?.name === "AbortError" ? "timeout" : e?.message || "fetch-failed" } };
        }
      })
    );
    extras.forEach((e) => models.push(...e.r.models));
    const perUpstream: Record<string, any> = {
      "prov-gemini": status(gemini),
      "prov-groq": status(groq),
      "prov-openrouter": status(openrouter),
      "prov-cerebras": status(cerebras),
    };
    extras.forEach((e) => { perUpstream[e.up] = status(e.r); });
    // Anthropic + Perplexity: no public /models — statics so switcher still works.
    if (first(ink.anthropic)) {
      ["claude-3-5-haiku-latest", "claude-3-5-sonnet-latest", "claude-3-haiku-20240307"].forEach((id) =>
        models.push({ id, name: id, upstream: "prov-anthropic" })
      );
      perUpstream["prov-anthropic"] = { ok: true, count: 3 };
    } else {
      perUpstream["prov-anthropic"] = { ok: false, count: 0, error: "no-key" };
    }
    if (first(ink.perplexity)) {
      ["sonar", "sonar-pro", "sonar-reasoning"].forEach((id) =>
        models.push({ id, name: id, upstream: "prov-perplexity" })
      );
      perUpstream["prov-perplexity"] = { ok: true, count: 3 };
    } else {
      perUpstream["prov-perplexity"] = { ok: false, count: 0, error: "no-key" };
    }
    return res.json({ syncedAt: Date.now(), models, perUpstream });
  } catch (err: any) {
    console.error("catalog/sync error:", err?.message || err);
    return res.status(500).json({ error: "Sync fail ho gaya" });
  }
});

// WebSocket Live API — wired only inside startServer() (long-lived servers).
// Never runs on serverless: no top-level side effects here.
async function initLiveSockets(httpServer: any) {
  const { WebSocketServer, WebSocket } = await import("ws") as any;
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request: any, socket: any, head: any) => {
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    if (url.pathname === "/api/copilot/live") {
      wss.handleUpgrade(request, socket, head, (ws: any) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", async (clientWs: any, req: any) => {
    console.log("Client connected to Gemini Live voice stream");
    let session: any = null;

    try {
      const url = new URL(req.url || "", `http://${req.headers.host}`);
      const clientKey = url.searchParams.get("key") || process.env.GEMINI_API_KEY;
      const activeProvider = url.searchParams.get("activeProvider") || "Cerebras / Groq";
      const policy = url.searchParams.get("policy") || "lowest-latency";
      const nodeCount = url.searchParams.get("nodeCount") || "12";
      const fallback = url.searchParams.get("fallback") || "Cerebras -> Groq -> Gemini";
      const ai = await getGenAIClient(clientKey || undefined);
      const { Modality } = await import("@google/genai");

    const liveInstruction = getRouterOperatorInstruction({
      activeProvider,
      policy,
      totalEndpoints: nodeCount,
      fallbackChain: [fallback],
      avgLatency: 18,
    });

    session = await ai.live.connect({
      model: "gemini-3.1-flash-live-preview",
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
        },
        systemInstruction: liveInstruction,
      },
      callbacks: {
        onmessage: (message: any) => {
          const audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
          if (audio && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ audio }));
          }

          const textPart = message.serverContent?.modelTurn?.parts?.find((p: any) => p.text)?.text;
          if (textPart && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ text: textPart }));
          }

          if (message.serverContent?.interrupted && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ interrupted: true }));
          }
        },
      },
    });

    clientWs.on("message", (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.audio && session) {
          session.sendRealtimeInput({
            audio: { data: parsed.audio, mimeType: "audio/pcm;rate=16000" },
          });
        }
      } catch (err) {
        console.error("Error processing client live input:", err);
      }
    });

    clientWs.on("close", () => {
      console.log("Live client disconnected");
      if (session) {
        try {
          session.close();
        } catch (_) {}
      }
    });
  } catch (err: any) {
    console.error("Live API connection failed:", err);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ error: err.message || "Live API connection failed" }));
      clientWs.close();
    }
  }
  });
} // end initLiveSockets (long-lived servers only)

// Vite middleware / static asset serving (long-lived servers only)
async function startServer() {
  if (!server) {
    server = http.createServer(app);
    await initLiveSockets(server).catch((e) =>
      console.error("Live socket init failed:", e)
    );
  }
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Edge Router full-stack server running on http://0.0.0.0:${PORT}`);
  });
}

// Auto-start only on real long-lived servers — never serverless, never tests.
if (process.env.NODE_ENV !== "test" && !IS_SERVERLESS) {
  startServer().catch((e) => console.error("Server start failed:", e));
}

export { app, server, startServer };
export default app;
