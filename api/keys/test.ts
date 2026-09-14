import dns from "dns";

// --- SSRF hardening: resolve DNS before calling a user-supplied base URL -------
// A string check on the hostname is not enough: a public domain with an A record
// pointing at 127.0.0.1 or 169.254.169.254 passes every regex. Known-good
// upstreams are constants and skip this entirely; only custom endpoints pay for a
// lookup, and results are cached for 60s.
const DNS_CACHE_TTL_MS = 60_000;
const dnsVerdicts = new Map<string, { ok: boolean; at: number }>();

function isPrivateOrReservedIp(ip: string): boolean {
  const v = ip.toLowerCase();
  // IPv4-mapped IPv6 (::ffff:10.0.0.1) — compare the embedded v4 part.
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const addr = mapped ? mapped[1] : v;
  if (addr.includes(".")) {
    const [a, b] = addr.split(".").map((n) => parseInt(n, 10));
    if (Number.isNaN(a) || Number.isNaN(b)) return true;
    if (a === 0) return true;                       // 0.0.0.0/8
    if (a === 10) return true;                      // private
    if (a === 127) return true;                     // loopback
    if (a === 169 && b === 254) return true;        // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true;        // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 192 && b === 0) return true;          // IETF protocol assignments
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true;                      // multicast + reserved
    return false;
  }
  // IPv6
  if (v === "::" || v === "::1") return true;
  if (v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb")) return true; // link-local
  if (v.startsWith("fc") || v.startsWith("fd")) return true; // unique-local
  if (v.startsWith("ff")) return true; // multicast
  return false;
}

function hostnameOf(raw: string): string {
  try { return new URL(raw).hostname.toLowerCase().replace(/^\[|\]$/g, ""); } catch { return ""; }
}

async function isSafeHostDns(rawUrl: string): Promise<boolean> {
  const host = hostnameOf(rawUrl);
  if (!host) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":")) {
    return !isPrivateOrReservedIp(host); // literal IP — no lookup needed
  }
  const cached = dnsVerdicts.get(host);
  if (cached && Date.now() - cached.at < DNS_CACHE_TTL_MS) return cached.ok;
  let ok = false;
  try {
    const addrs = await dns.promises.lookup(host, { all: true });
    ok = Array.isArray(addrs) && addrs.length > 0 && addrs.every((a) => !isPrivateOrReservedIp(a.address));
  } catch {
    ok = false;
  }
  dnsVerdicts.set(host, { ok, at: Date.now() });
  return ok;
}

// Vercel: give this function enough wall-clock time for its own internal
// timeouts to fire first, so callers get a real error instead of a platform kill.
export const maxDuration = 30;

// Attribution for upstreams that ask for it (OpenRouter). Derived from the real
// deployment instead of a hardcoded domain, so self-hosters report their own site.
function siteReferer(): string {
  const raw =
    process.env.APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
    "";
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "https://edge-ai-router.local";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
// Test ONE provider key with a tiny live call — SELF-CONTAINED.
// POST { key, upstream?, baseUrl?, model? } -> { ok, upstream, model, latencyMs, error?, status? }
// Used by the MONITOR tab to show working/exhausted/dead per key.
// baseUrl+model = test a custom OpenAI-compat endpoint (own proxy/config).
// Burns ~1 tiny request (max_tokens 5) — cheap liveness probe.
function allowedBase(raw: string): boolean {
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
  } catch { return false; }
}
const TEST_MODELS: Record<string, { baseUrl: string; model: string; native?: string }> = {
  "prov-gemini": { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-flash-lite-latest" },
  "prov-groq": { baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.1-8b-instant" },
  "prov-openrouter": { baseUrl: "https://openrouter.ai/api/v1", model: "google/gemma-4-31b-it:free" },
  "prov-cerebras": { baseUrl: "https://api.cerebras.ai/v1", model: "llama3.1-8b" },
  "prov-openai": { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  "prov-anthropic": { baseUrl: "https://api.anthropic.com/v1", model: "claude-3-5-haiku-latest", native: "anthropic" },
  "prov-deepseek": { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  "prov-mistral": { baseUrl: "https://api.mistral.ai/v1", model: "mistral-small-latest" },
  "prov-xai": { baseUrl: "https://api.x.ai/v1", model: "grok-3-mini" },
  "prov-perplexity": { baseUrl: "https://api.perplexity.ai", model: "sonar" },
  "prov-together": { baseUrl: "https://api.together.xyz/v1", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
  "prov-fireworks": { baseUrl: "https://api.fireworks.ai/inference/v1", model: "accounts/fireworks/models/llama-v3p1-8b-instruct" },
  "prov-siliconflow": { baseUrl: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen2.5-7B-Instruct" },
  "prov-novita": { baseUrl: "https://api.novita.ai/v3/openai", model: "meta-llama/llama-3.1-8b-instruct" },
  "prov-hyperbolic": { baseUrl: "https://api.hyperbolic.xyz/v1", model: "meta-llama/Meta-Llama-3.1-8B-Instruct" },
  "prov-chutes": { baseUrl: "https://llm.chutes.ai/v1", model: "deepseek-ai/DeepSeek-V3" },
  "prov-glhf": { baseUrl: "https://glhf.chat/api/openai/v1", model: "hf:meta-llama/Llama-3.3-70B-Instruct" },
  "prov-cohere": { baseUrl: "https://api.cohere.ai/compatibility/v1", model: "command-r" },
  "prov-zhipu": { baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
  "prov-qwen": { baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-turbo" },
  "prov-moonshot": { baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  "prov-githubmodels": { baseUrl: "https://models.github.ai/inference", model: "openai/gpt-4o-mini" },
  "prov-huggingface": { baseUrl: "https://router.huggingface.co/v1", model: "meta-llama/Llama-3.3-70B-Instruct" },
  "prov-sambanova": { baseUrl: "https://api.sambanova.ai/v1", model: "Meta-Llama-3.3-70B-Instruct" },
  "prov-nebius": { baseUrl: "https://api.studio.nebius.com/v1", model: "Qwen/Qwen2.5-72B-Instruct" },
  "prov-deepinfra": { baseUrl: "https://api.deepinfra.com/v1/openai", model: "meta-llama/Meta-Llama-3.1-8B-Instruct" },
  "prov-pollinations": { baseUrl: "https://text.pollinations.ai/openai", model: "openai" },
};

function detect(key: string): string {
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

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const t0 = Date.now();
  try {
    const body = req.body || {};
    const key = typeof body.key === "string" ? body.key.trim() : "";
    if (!key || key.length < 10) {
      return res.status(400).json({ ok: false, error: "key dalo (full key)" });
    }
    const hint = typeof body.upstream === "string" ? body.upstream.trim() : "";
    const customBase = typeof body.baseUrl === "string" ? body.baseUrl.trim().replace(/\/+$/, "") : "";
    const customModel = typeof body.model === "string" ? body.model.trim().slice(0, 120) : "";
    // Custom endpoint probe: OpenAI-compat POST {baseUrl}/chat/completions.
    if (customBase) {
      if (customBase.length > 200 || !allowedBase(customBase)) {
        return res.json({ ok: false, upstream: "custom", latencyMs: Date.now() - t0, error: "baseUrl public https hona chahiye." });
      }
      // SSRF: the hostname string check alone is bypassable by a public domain
      // that resolves to a private address. Resolve it before we dial out.
      if (!(await isSafeHostDns(customBase))) {
        return res.json({
          ok: false, upstream: "custom", latencyMs: Date.now() - t0,
          error: "Blocked: baseUrl resolves to a private or reserved address.",
        });
      }
      const model = customModel || "default";
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 25000);
      try {
        const resp = await fetch(`${customBase}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "HTTP-Referer": siteReferer(), "X-Title": "Edge Router" },
          body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 5, temperature: 0 }),
          signal: ctl.signal,
        });
        clearTimeout(timer);
        const data: any = await resp.json().catch(() => null);
        const latencyMs = Date.now() - t0;
        if (resp.ok) return res.json({ ok: true, upstream: "custom", model, latencyMs, prefix: key.slice(0, 8) });
        const msg = data?.error?.message || data?.message || `HTTP ${resp.status}`;
        return res.json({ ok: false, upstream: "custom", model, latencyMs, status: resp.status, prefix: key.slice(0, 8), error: String(msg).slice(0, 200) });
      } catch (e: any) {
        clearTimeout(timer);
        return res.json({ ok: false, upstream: "custom", model, latencyMs: Date.now() - t0, status: e?.name === "AbortError" ? "timeout" : "network", error: e?.name === "AbortError" ? "Timeout (25s) — endpoint slow ya unreachable" : `Network: ${e?.message || e}` });
      }
    }
    const upstream = hint && TEST_MODELS[hint] ? hint : detect(key);
    if (upstream === "unknown" || !TEST_MODELS[upstream]) {
      return res.json({
        ok: false,
        upstream: "unknown",
        latencyMs: Date.now() - t0,
        error: "Upstream pehchana nahi gaya — KEYS me is key pe provider tag select karo, fir test karo.",
      });
    }
    const t = TEST_MODELS[upstream];
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 25000);
    let resp: Response;
    try {
      if (t.native === "anthropic") {
        resp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: t.model, max_tokens: 5, messages: [{ role: "user", content: "ping" }] }),
          signal: ctl.signal,
        });
      } else {
        resp = await fetch(`${t.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
            "HTTP-Referer": siteReferer(),
            "X-Title": "Edge Router",
          },
          body: JSON.stringify({ model: t.model, messages: [{ role: "user", content: "ping" }], max_tokens: 5, temperature: 0 }),
          signal: ctl.signal,
        });
      }
    } catch (e: any) {
      clearTimeout(timer);
      return res.json({
        ok: false,
        upstream,
        model: t.model,
        latencyMs: Date.now() - t0,
        status: e?.name === "AbortError" ? "timeout" : "network",
        error: e?.name === "AbortError" ? "Timeout (25s) — upstream slow ya unreachable" : `Network: ${e?.message || e}`,
      });
    }
    clearTimeout(timer);
    const data: any = await resp.json().catch(() => null);
    const latencyMs = Date.now() - t0;
    if (resp.ok) {
      return res.json({ ok: true, upstream, model: t.model, latencyMs, prefix: key.slice(0, 8) });
    }
    const msg = data?.error?.message || data?.message || `HTTP ${resp.status}`;
    return res.json({ ok: false, upstream, model: t.model, latencyMs, status: resp.status, prefix: key.slice(0, 8), error: msg.slice(0, 200) });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Test fail", latencyMs: Date.now() - t0 });
  }
}
