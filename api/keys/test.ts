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
    if (/(^|\.)(generativelanguage\.googleapis\.com|api\.groq\.com|openrouter\.ai|api\.cerebras\.ai|api\.openai\.com|api\.anthropic\.com|api\.deepseek\.com|api\.mistral\.ai|api\.x\.ai|api\.perplexity\.ai|api\.together\.xyz|api\.fireworks\.ai|api\.siliconflow\.cn|api\.novita\.ai|api\.hyperbolic\.xyz|llm\.chutes\.ai|chutes\.ai|glhf\.chat|api\.cohere\.ai)$/.test(host)) return true;
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
      const model = customModel || "default";
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 25000);
      try {
        const resp = await fetch(`${customBase}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "HTTP-Referer": "https://edge-ai-router.vercel.app", "X-Title": "Edge Router" },
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
            "HTTP-Referer": "https://edge-ai-router.vercel.app",
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
