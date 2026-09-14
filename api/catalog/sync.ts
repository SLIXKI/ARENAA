
// Vercel: give this function enough wall-clock time for its own internal
// timeouts to fire first, so callers get a real error instead of a platform kill.
export const maxDuration = 30;
// Live provider catalog sync — FULLY SELF-CONTAINED (no cross-file imports).
// POST { keys?: { gemini?: string[], groq?: string[], ..., openai?: string[], deepseek?: string[], ... } }
// Fans out to each provider's /models (8s timeout each). One provider failing
// never fails the whole sync. Keys are NEVER logged or returned.
const FETCH_TIMEOUT_MS = 8000;
const MAX_MODELS_PER_UPSTREAM = 150;

// Generic OpenAI-compatible /models endpoints (key required except openrouter).
const OPENAI_COMPAT_SYNC: Record<string, string> = {
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
};

function firstKey(v: any): string {
  if (Array.isArray(v)) {
    const f = v.find((k) => typeof k === "string" && k.trim());
    return f ? f.trim() : "";
  }
  return typeof v === "string" && v.trim() ? v.trim() : "";
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
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

export interface SyncedModel {
  id: string;
  name: string;
  upstream: string;
  free?: boolean;
}

async function syncGemini(key: string): Promise<{ ok: boolean; models: SyncedModel[]; error?: string }> {
  if (!key) return { ok: false, models: [], error: "no-key" };
  try {
    const j: any = await fetchJson(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=100`,
      {}
    );
    const arr = Array.isArray(j?.models) ? j.models : [];
    const models: SyncedModel[] = [];
    for (const m of arr) {
      const name = typeof m?.name === "string" ? m.name.replace(/^models\//, "") : "";
      const methods: string[] = Array.isArray(m?.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
      if (!name || !methods.includes("generateContent")) continue;
      if (/embedding|aqa|transcribe|tts|image|video|audio|live|bidi|robotics|lyria|veo|computer-use|deep-research|antigravity/i.test(name)) continue;
      models.push({ id: name, name, upstream: "prov-gemini" });
      if (models.length >= MAX_MODELS_PER_UPSTREAM) break;
    }
    return { ok: true, models };
  } catch (e: any) {
    return { ok: false, models: [], error: e?.name === "AbortError" ? "timeout" : e?.message || "fetch-failed" };
  }
}

async function syncGroq(key: string): Promise<{ ok: boolean; models: SyncedModel[]; error?: string }> {
  if (!key) return { ok: false, models: [], error: "no-key" };
  try {
    const j: any = await fetchJson("https://api.groq.com/openai/v1/models", { Authorization: `Bearer ${key}` });
    const arr = Array.isArray(j?.data) ? j.data : [];
    const models: SyncedModel[] = [];
    for (const m of arr) {
      const id = typeof m?.id === "string" ? m.id : typeof m === "string" ? m : "";
      if (!id || /whisper|embedding|tts|guard/i.test(id)) continue;
      models.push({ id, name: id, upstream: "prov-groq" });
      if (models.length >= MAX_MODELS_PER_UPSTREAM) break;
    }
    return { ok: true, models };
  } catch (e: any) {
    return { ok: false, models: [], error: e?.name === "AbortError" ? "timeout" : e?.message || "fetch-failed" };
  }
}

async function syncOpenRouter(): Promise<{ ok: boolean; models: SyncedModel[]; error?: string }> {
  try {
    const j: any = await fetchJson("https://openrouter.ai/api/v1/models", {});
    const arr = Array.isArray(j?.data) ? j.data : [];
    const models: SyncedModel[] = [];
    for (const m of arr) {
      const id = typeof m?.id === "string" ? m.id : "";
      if (!id) continue;
      const outMods: string[] = Array.isArray(m?.architecture?.output_modalities) ? m.architecture.output_modalities : [];
      // Sirf text-out chat models (embedding/image/audio bahar)
      if (outMods.length > 0 && !outMods.includes("text")) continue;
      if (/embedding|audio|video|image|tts|whisper|lyria/i.test(id)) continue;
      // FREE-ONLY: pricing present hai to prompt+completion dono 0 hone chahiye (paid bahar)
      const pr = m?.pricing;
      if (pr && typeof pr === "object") {
        const pp = Number((pr as any).prompt);
        const pc = Number((pr as any).completion);
        if (!Number.isFinite(pp) || !Number.isFinite(pc) || pp !== 0 || pc !== 0) continue;
      }
      models.push({ id, name: typeof m?.name === "string" && m.name ? m.name : id, upstream: "prov-openrouter", free: true });
      if (models.length >= MAX_MODELS_PER_UPSTREAM) break;
    }
    return { ok: true, models };
  } catch (e: any) {
    return { ok: false, models: [], error: e?.name === "AbortError" ? "timeout" : e?.message || "fetch-failed" };
  }
}

async function syncCerebras(key: string): Promise<{ ok: boolean; models: SyncedModel[]; error?: string }> {
  if (!key) return { ok: false, models: [], error: "no-key" };
  try {
    const j: any = await fetchJson("https://api.cerebras.ai/v1/models", { Authorization: `Bearer ${key}` });
    const arr = Array.isArray(j?.data) ? j.data : Array.isArray(j?.models) ? j.models : [];
    if (!Array.isArray(arr) || arr.length === 0) {
      return { ok: false, models: [], error: "unknown-shape" };
    }
    const models: SyncedModel[] = [];
    for (const m of arr) {
      const id = typeof m?.id === "string" ? m.id : typeof m?.name === "string" ? m.name : typeof m === "string" ? m : "";
      if (!id) continue;
      models.push({ id, name: id, upstream: "prov-cerebras" });
      if (models.length >= MAX_MODELS_PER_UPSTREAM) break;
    }
    return { ok: true, models };
  } catch (e: any) {
    return { ok: false, models: [], error: e?.name === "AbortError" ? "timeout" : e?.message || "fetch-failed" };
  }
}

async function syncOpenAICompat(upstream: string, url: string, key: string): Promise<{ ok: boolean; models: SyncedModel[]; error?: string }> {
  if (!key) return { ok: false, models: [], error: "no-key" };
  try {
    const j: any = await fetchJson(url, { Authorization: `Bearer ${key}` });
    const arr = Array.isArray(j?.data) ? j.data : [];
    const models: SyncedModel[] = [];
    for (const m of arr) {
      const id = typeof m?.id === "string" ? m.id : typeof m === "string" ? m : "";
      if (!id || /whisper|embedding|tts|guard|moderation|dall-e|audit/i.test(id)) continue;
      models.push({ id, name: id, upstream });
      if (models.length >= MAX_MODELS_PER_UPSTREAM) break;
    }
    return { ok: true, models };
  } catch (e: any) {
    return { ok: false, models: [], error: e?.name === "AbortError" ? "timeout" : e?.message || "fetch-failed" };
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const body = req.body || {};
    const ink = body.keys && typeof body.keys === "object" ? body.keys : {};
    const core = await Promise.all([
      syncGemini(firstKey(ink.gemini)),
      syncGroq(firstKey(ink.groq)),
      syncOpenRouter(),
      syncCerebras(firstKey(ink.cerebras)),
    ]);
    const [gemini, groq, openrouter, cerebras] = core;
    // Generic OpenAI-compat providers: input key = short id (e.g. ink.openai, ink.deepseek)
    const shortOf = (up: string) => up.replace(/^prov-/, "");
    const extras = await Promise.all(
      Object.entries(OPENAI_COMPAT_SYNC).map(([up, url]) => syncOpenAICompat(up, url, firstKey((ink as any)[shortOf(up)])))
    );
    const models: SyncedModel[] = [...gemini.models, ...groq.models, ...openrouter.models, ...cerebras.models];
    extras.forEach((r) => models.push(...r.models));
    const status = (r: { ok: boolean; models: SyncedModel[]; error?: string }) =>
      r.ok ? { ok: true as const, count: r.models.length } : { ok: false as const, count: 0, error: r.error || "failed" };
    const perUpstream: Record<string, { ok: boolean; count: number; error?: string }> = {
      "prov-gemini": status(gemini),
      "prov-groq": status(groq),
      "prov-openrouter": status(openrouter),
      "prov-cerebras": status(cerebras),
    };
    Object.keys(OPENAI_COMPAT_SYNC).forEach((up, i) => {
      perUpstream[up] = status(extras[i]);
    });
    // Anthropic + Perplexity have no public /models — static known models so switcher still works.
    const statics: SyncedModel[] = [];
    if (firstKey((ink as any).anthropic)) {
      ["claude-3-5-haiku-latest", "claude-3-5-sonnet-latest", "claude-3-haiku-20240307"].forEach((id) =>
        statics.push({ id, name: id, upstream: "prov-anthropic" })
      );
      perUpstream["prov-anthropic"] = { ok: true, count: 3 };
    } else {
      perUpstream["prov-anthropic"] = { ok: false, count: 0, error: "no-key" };
    }
    if (firstKey((ink as any).perplexity)) {
      ["sonar", "sonar-pro", "sonar-reasoning"].forEach((id) =>
        statics.push({ id, name: id, upstream: "prov-perplexity" })
      );
      perUpstream["prov-perplexity"] = { ok: true, count: 3 };
    } else {
      perUpstream["prov-perplexity"] = { ok: false, count: 0, error: "no-key" };
    }
    models.push(...statics);
    return res.json({ syncedAt: Date.now(), models, perUpstream });
  } catch (err: any) {
    console.error("catalog/sync error:", err?.message || err);
    return res.status(500).json({ error: "Sync fail ho gaya" });
  }
}
