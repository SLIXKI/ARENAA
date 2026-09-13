// OpenAI-compatible model list — FULLY SELF-CONTAINED (no cross-file imports).
// GET /api/v1/models -> { object: "list", data: [{ id, object: "model", ... }] }.
// External clients (Nexus / OpenCode / Cursor / LibreChat) isi se switch-model list bharte hai.
// Master key (er1.) di to validate hoti hai (invalid/expired -> 401) aur uske
// pools ke upstreams available:true milte hai — Nexus key-check isi pe chalta hai.
import crypto from "node:crypto";
import { inflateSync } from "node:zlib";

const MASTER_PREFIX = "er1.";

function masterSecret(): Buffer {
  return crypto
    .createHash("sha256")
    .update(process.env.MASTER_KEY_SECRET || "er-dev-fallback-secret-v1-do-not-use-in-prod")
    .digest();
}

function tryMasterDecrypt(token: string): { ok: boolean; code?: string; payload?: any } {
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
  } catch {
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

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: { message: "Method not allowed", type: "invalid_request_error" } });
  }
  const now = Math.floor(Date.now() / 1000);
  const ups = callerUpstreams(req);
  // Master key di hai to validate karo (Nexus key-check): galat/expire -> 401.
  // Sahi hai to uske pools ke upstreams bhi available:true.
  const masterTok = extractMaster(req);
  if (masterTok) {
    const chk = tryMasterDecrypt(masterTok);
    if (!chk.ok) {
      return res.status(401).json({
        error: {
          message: chk.code === "EXPIRED" ? "Master key expire ho gayi — Regenerate karo." : "Master key invalid hai.",
          type: "authentication_error",
        },
      });
    }
    const set = ups || new Set<string>();
    Object.keys(chk.payload.keys || {}).forEach((pid) => {
      const arr = chk.payload.keys[pid];
      if (Array.isArray(arr) && arr.length > 0) set.add(pid);
    });
    // Legacy pool ids (prov-gemini etc.) bhi chalenge — upstream mapping neeche.
    return res.json({
      object: "list",
      data: UNIVERSAL_MODELS.map((m) => ({
        id: m.id,
        object: "model",
        created: now,
        owned_by: "edge-router",
        upstream: m.upstream,
        gateway: "Edge Router",
        available: set.has(m.upstream) || set.has("Edge Router") || set.has("prov-universal"),
      })),
    });
  }
  return res.json({
    object: "list",
    data: UNIVERSAL_MODELS.map((m) => ({
      id: m.id,
      object: "model",
      created: now,
      owned_by: "edge-router",
      upstream: m.upstream,
      gateway: "Edge Router",
      ...(ups ? { available: ups.has(m.upstream) } : {}),
    })),
  });
}
