// Issue a UNIQUE master key embedding the user's provider pools — SELF-CONTAINED.
// POST { keys: { providerId: [{k,g,u?,b?,m?} | "keystring", ...] }, label? }
// Per-key extras: u = upstream tag, b = custom OpenAI-compat base URL (own proxy/endpoint),
// m = model affinity (this key is preferred when that exact model is requested).
// No auth needed: you only unlock keys you supply yourself (no privilege escalation).
// Caps: 30 keys/provider, 120 total (token header-size guard).
import crypto from "node:crypto";
import { deflateSync } from "node:zlib";

const MASTER_PREFIX = "er1.";
const MASTER_TTL_MS = 90 * 86400 * 1000;
const MAX_KEYS_PER_PROVIDER = 30;
const MAX_KEYS_TOTAL = 120;

const KNOWN_U = new Set([
  "prov-gemini", "prov-groq", "prov-openrouter", "prov-cerebras", "prov-openai",
  "prov-anthropic", "prov-deepseek", "prov-mistral", "prov-xai", "prov-perplexity",
  "prov-together", "prov-fireworks", "prov-siliconflow", "prov-novita",
  "prov-hyperbolic", "prov-chutes", "prov-glhf", "prov-cohere",
  "prov-zhipu", "prov-qwen", "prov-moonshot", "prov-githubmodels", "prov-huggingface",
  "prov-sambanova", "prov-nebius", "prov-deepinfra", "prov-pollinations",
]);

// SSRF guard for custom bases: public https only (catalog hosts always OK).
function isAllowedBase(raw: string): boolean {
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

function masterSecret(): Buffer {
  return crypto
    .createHash("sha256")
    .update(process.env.MASTER_KEY_SECRET || "er-dev-fallback-secret-v1-do-not-use-in-prod")
    .digest();
}

function masterEncrypt(payload: any): string {
  const raw = deflateSync(Buffer.from(JSON.stringify(payload), "utf8"));
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", masterSecret(), iv);
  const ct = Buffer.concat([c.update(raw), c.final()]);
  return MASTER_PREFIX + Buffer.concat([iv, ct, c.getAuthTag()]).toString("base64url");
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const body = req.body || {};
    const input = body.keys && typeof body.keys === "object" ? body.keys : null;
    if (!input) {
      return res.status(400).json({ error: "Missing keys object: { providerId: [{k, g}] }" });
    }
    const label = typeof body.label === "string" ? body.label.slice(0, 40) : "";
    const pools: Record<string, { k: string; g: string; u?: string; b?: string; m?: string }[]> = {};
    let total = 0;
    for (const pid of Object.keys(input)) {
      if (!Array.isArray(input[pid])) {
        return res.status(400).json({ error: `keys['${pid}'] array honi chahiye` });
      }
      if (input[pid].length > MAX_KEYS_PER_PROVIDER) {
        return res.status(400).json({ error: `${pid}: max ${MAX_KEYS_PER_PROVIDER} keys per provider` });
      }
      const arr: { k: string; g: string; u?: string; b?: string; m?: string }[] = [];
      for (const v of input[pid]) {
        const k = typeof v === "string" ? v.replace(/[\s'"`]+/g, "").trim() : typeof v?.k === "string" ? v.k.replace(/[\s'"`]+/g, "").trim() : "";
        if (k.length < 10) {
          return res.status(400).json({ error: `${pid}: ek key bahut chhoti hai — full key bhejo` });
        }
        const rawG = typeof v?.g === "string" ? v.g.trim() : "";
        const g = /.+@.+\..{2,}/.test(rawG) ? rawG : "";
        const rawU = typeof v?.u === "string" ? v.u.trim() : "";
        const rawB = typeof v?.b === "string" ? v.b.trim().replace(/\/+$/, "") : "";
        const rawM = typeof v?.m === "string" ? v.m.trim().slice(0, 120) : "";
        const entry: { k: string; g: string; u?: string; b?: string; m?: string } = { k, g };
        if (rawU && KNOWN_U.has(rawU)) entry.u = rawU;
        if (rawB) {
          if (rawB.length > 200 || !isAllowedBase(rawB)) {
            return res.status(400).json({ error: `${pid}: custom base URL public https hona chahiye (${rawB.slice(0, 60)})` });
          }
          entry.b = rawB;
        }
        if (rawM) entry.m = rawM;
        arr.push(entry);
        total++;
      }
      if (arr.length > 0) pools[pid] = arr;
    }
    if (total === 0) {
      return res.status(400).json({ error: "Kam se kam 1 key dalo" });
    }
    if (total > MAX_KEYS_TOTAL) {
      return res.status(400).json({ error: `Max ${MAX_KEYS_TOTAL} keys per master key (token size guard). Kam keys rakho ya 2nd master banao.` });
    }
    const mid = crypto.randomBytes(8).toString("hex");
    const exp = Date.now() + MASTER_TTL_MS;
    const masterKey = masterEncrypt({ v: 1, mid, exp, label, keys: pools });
    const providers: Record<string, { count: number; gmails: string[] }> = {};
    for (const pid of Object.keys(pools)) {
      providers[pid] = { count: pools[pid].length, gmails: [...new Set(pools[pid].map((e) => e.g).filter(Boolean))] };
    }
    const sizeWarn = masterKey.length > 7000
      ? `Master token ${masterKey.length} chars — kuch tools 8KB header cap pe fail karte hai. Keys kam rakho ya 2nd master banao.`
      : "";
    return res.json({ masterKey, mid, label, expiresAt: exp, providers, tokenSize: masterKey.length, ...(sizeWarn ? { sizeWarn } : {}) });
  } catch (err: any) {
    console.error("keys/issue error:", err?.message || err);
    return res.status(500).json({ error: "Issue fail ho gaya" });
  }
}
