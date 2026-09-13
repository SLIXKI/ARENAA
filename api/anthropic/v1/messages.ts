// Anthropic-compatible Messages API — use Edge Router as YOUR provider in Claude Code.
// Point Claude Code here: ANTHROPIC_BASE_URL=https://<your-host>/api/anthropic
//                        ANTHROPIC_API_KEY=<your er1 master key>
// Accepts real Anthropic request shape (system/blocks/tools/stream), routes through
// YOUR key pools with smart rotation, translates back to Anthropic response/SSE shape.
// Real Anthropic keys (sk-ant-) are proxied natively 1:1; every other provider key is
// translated so Claude Code works even with ONLY Gemini/Groq/OpenRouter/... keys.
// FULLY SELF-CONTAINED (no cross-file imports).
import crypto from "node:crypto";
import { inflateSync } from "node:zlib";

const MASTER_PREFIX = "er1.";

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
  } catch {
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

const KNOWN = new Set(Object.keys(UPSTREAMS));
const UPSTREAM_PRIORITY = ["prov-gemini","prov-groq","prov-cerebras","prov-openrouter","prov-deepseek","prov-mistral","prov-together","prov-fireworks","prov-siliconflow","prov-novita","prov-hyperbolic","prov-chutes","prov-glhf","prov-openai","prov-anthropic","prov-xai","prov-perplexity","prov-cohere"];

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

const COOLDOWN_MS = 60_000;
const cdUntil = new Map<string, number>();
const fail429 = new Map<string, number>();
const failOther = new Map<string, number>();
const lastUsed = new Map<string, number>();
function kh(k: string): string {
  return crypto.createHash("sha256").update(k).digest("hex").slice(0, 16);
}

interface PI { key: string; hint: string; base?: string; aff?: string; }

function orderPool(pool: PI[], wanted: string): PI[] {
  const now = Date.now();
  const bucket = (p: PI): number => {
    if (wanted && p.aff && p.aff === wanted) return -1;
    if (p.hint === "prov-anthropic") return 0; // real Anthropic keys first (native 1:1)
    if (p.hint === "unknown") return 1;
    const i = UPSTREAM_PRIORITY.indexOf(p.hint);
    return 2 + (i === -1 ? 50 : i);
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

// ---- Anthropic -> OpenAI translation ----
function blocksToText(blocks: any[]): string {
  return (blocks || []).filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join("");
}

function toOpenAIMessages(system: any, messages: any[]): { sys: string; msgs: any[] } {
  const sys = typeof system === "string" ? system : Array.isArray(system) ? blocksToText(system) : "";
  const msgs: any[] = [];
  for (const m of messages || []) {
    const role = m?.role === "assistant" ? "assistant" : "user";
    const c = m?.content;
    if (typeof c === "string") {
      msgs.push({ role, content: c });
      continue;
    }
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
      } else if (b.type === "tool_result") {
        toolResults.push(b);
      } else if (b.type === "tool_use") {
        toolUses.push(b);
      }
    }
    if (role === "assistant") {
      const content = texts.join("");
      const tool_calls = toolUses.map((t) => ({
        id: typeof t.id === "string" ? t.id : `call_${Math.random().toString(36).slice(2)}`,
        type: "function",
        function: { name: typeof t.name === "string" ? t.name : "tool", arguments: typeof t.input === "string" ? t.input : JSON.stringify(t.input ?? {}) },
      }));
      if (content || tool_calls.length > 0) {
        msgs.push({ role: "assistant", content, ...(tool_calls.length > 0 ? { tool_calls } : {}) });
      }
    } else {
      if (texts.length > 0 || images.length > 0) {
        if (images.length > 0) {
          const parts: any[] = [];
          if (texts.length > 0) parts.push({ type: "text", text: texts.join("") });
          parts.push(...images);
          msgs.push({ role: "user", content: parts });
        } else {
          msgs.push({ role: "user", content: texts.join("") });
        }
      }
      for (const tr of toolResults) {
        const tcId = typeof tr.tool_use_id === "string" ? tr.tool_use_id : "unknown";
        const cc = tr.content;
        const text = typeof cc === "string" ? cc : Array.isArray(cc) ? blocksToText(cc) : JSON.stringify(cc ?? "");
        msgs.push({ role: "tool", tool_call_id: tcId, content: (tr.is_error ? "Error: " : "") + text });
      }
    }
  }
  if (sys) msgs.unshift({ role: "system", content: sys });
  if (msgs.length === 0) msgs.push({ role: "user", content: "hi" });
  return { sys, msgs };
}

function toOpenAITools(tools: any): any[] | undefined {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  const out: any[] = [];
  for (const t of tools) {
    if (!t || typeof t.name !== "string") continue;
    out.push({
      type: "function",
      function: {
        name: t.name,
        description: typeof t.description === "string" ? t.description : "",
        parameters: t.input_schema && typeof t.input_schema === "object" ? t.input_schema : { type: "object", properties: {} },
      },
    });
  }
  return out.length > 0 ? out : undefined;
}

function toOpenAIToolChoice(tc: any): any {
  if (!tc || tc.type === "auto") return "auto";
  if (tc.type === "any") return "required";
  if (tc.type === "tool" && typeof tc.name === "string") return { type: "function", function: { name: tc.name } };
  return "auto";
}

// ---- OpenAI -> Anthropic translation ----
function finishToStop(fr: string | undefined, hasTools: boolean): string {
  if (fr === "length") return "max_tokens";
  if (fr === "tool_calls" || hasTools) return "tool_use";
  if (fr === "content_filter") return "end_turn";
  return "end_turn";
}

function openAIMessageToBlocks(msg: any): { blocks: any[]; hasTools: boolean } {
  const blocks: any[] = [];
  const text = typeof msg?.content === "string" ? msg.content : "";
  if (text) blocks.push({ type: "text", text });
  let hasTools = false;
  if (Array.isArray(msg?.tool_calls)) {
    for (const tc of msg.tool_calls) {
      if (tc?.type !== "function" && tc?.type !== undefined) continue;
      hasTools = true;
      let input: any = {};
      try {
        input = JSON.parse(tc.function?.arguments || "{}");
      } catch { input = {}; }
      blocks.push({ type: "tool_use", id: tc.id || `toolu_${Math.random().toString(36).slice(2)}`, name: tc.function?.name || "tool", input });
    }
  }
  if (blocks.length === 0) blocks.push({ type: "text", text: "" });
  return { blocks, hasTools };
}

function anthropicError(res: any, status: number, message: string, type = "api_error") {
  return res.status(status).json({ type: "error", error: { type, message: String(message || "error").slice(0, 500) } });
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return anthropicError(res, 405, "Method not allowed", "invalid_request_error");
  }
  try {
    const body = req.body || {};
    const model = typeof body.model === "string" && body.model ? body.model : "claude-3-5-haiku-latest";
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (messages.length === 0) {
      return anthropicError(res, 400, "messages: must not be empty", "invalid_request_error");
    }
    const maxTokens = Math.max(1, Math.min(typeof body.max_tokens === "number" ? body.max_tokens : 1024, 8192));
    const temperature = typeof body.temperature === "number" ? body.temperature : 0.7;
    const wantStream = body.stream === true;
    const stopSequences: string[] = Array.isArray(body.stop_sequences) ? body.stop_sequences.filter((s: any) => typeof s === "string").slice(0, 4) : [];

    // ---- Auth: x-api-key (Claude Code) / Bearer / body ----
    const pool: PI[] = [];
    const seen = new Set<string>();
    const push = (v: any) => {
      if (typeof v !== "string" || !v.trim()) return;
      const t = v.trim();
      if (seen.has(t)) return;
      seen.add(t);
      pool.push({ key: t, hint: effOf(t, "") });
    };
    push(req.headers["x-api-key"]);
    const authH = typeof req.headers?.authorization === "string" ? req.headers.authorization : "";
    const bm = authH.match(/^Bearer\s*(.*)$/i);
    const bearer = (bm ? bm[1] : authH).trim();
    if (bearer && bearer.toLowerCase() !== "bearer") push(bearer);
    if (Array.isArray(body.apiKeys)) body.apiKeys.forEach(push);
    push(body.clientApiKey);
    push(body.masterKey);

    const maybeMaster = pool.find((p) => p.key.startsWith(MASTER_PREFIX))?.key || "";
    let effPool = pool;
    if (maybeMaster) {
      let payload: any;
      try {
        payload = masterDecrypt(maybeMaster);
      } catch (e: any) {
        return anthropicError(res, 401, e?.code === "EXPIRED" ? "Master key expire ho gayi — site se Regenerate karo." : "Master key invalid hai — site se dobara copy karo.", "authentication_error");
      }
      if (await isMasterRevoked(payload.mid)) {
        return anthropicError(res, 401, "Ye master key revoke ho chuki hai — nayi generate karo.", "authentication_error");
      }
      const out: PI[] = [];
      const s2 = new Set<string>();
      const take = (arr: any) => {
        if (!Array.isArray(arr)) return;
        arr.forEach((e: any) => {
          const k = typeof e === "string" ? e : e?.k;
          if (typeof k === "string" && k.trim() && !s2.has(k.trim())) {
            s2.add(k.trim());
            const u = typeof e?.u === "string" ? e.u : "";
            const item: PI = { key: k.trim(), hint: effOf(k.trim(), u) };
            const b = typeof e?.b === "string" ? e.b.trim().replace(/\/+$/, "") : "";
            if (b && allowedBase(b)) item.base = b;
            const m = typeof e?.m === "string" ? e.m.trim().slice(0, 120) : "";
            if (m) item.aff = m;
            out.push(item);
          }
        });
      };
      const pools = payload?.keys || {};
      take(pools["Edge Router"]);
      Object.keys(pools).forEach((pid) => { if (pid !== "Edge Router") take(pools[pid]); });
      effPool = out;
      if (effPool.length === 0) {
        return anthropicError(res, 401, "Is master key me koi key nahi hai.", "authentication_error");
      }
    }
    if (effPool.length === 0) {
      return anthropicError(res, 401, "API key dalo: ANTHROPIC_API_KEY me apni er1 master key rakho.", "authentication_error");
    }

    const { msgs } = toOpenAIMessages(body.system, messages);
    const oaiTools = toOpenAITools(body.tools);
    const oaiToolChoice = oaiTools ? toOpenAIToolChoice(body.tool_choice) : undefined;

    const ordered = orderPool(effPool, model);
    const msgId = `msg_router${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    let lastErr = "unknown error";
    let lastStatus = 502;

    for (let i = 0; i < ordered.length; i++) {
      const item = ordered[i];
      const itemBase = item.base || null;
      const servedId = itemBase ? "custom" : item.hint === "unknown" ? "prov-anthropic" : item.hint;
      const isNative = !itemBase && servedId === "prov-anthropic";
      // Translated path: requested model only if provider-native, else that upstream's default.
      const serveModel = itemBase ? model : isNative ? model : (model.startsWith("claude-") ? (UPSTREAMS[servedId]?.defaultModel || model) : model);
      const h = kh(item.key);
      lastUsed.set(h, Date.now());

      try {
        if (isNative) {
          // 1:1 native proxy to Anthropic (stream passthrough included).
          const fwd: any = { model, max_tokens: maxTokens, messages, temperature, ...(wantStream ? { stream: true } : {}) };
          if (typeof body.system !== "undefined") fwd.system = body.system;
          if (Array.isArray(body.tools)) fwd.tools = body.tools;
          if (typeof body.tool_choice !== "undefined") fwd.tool_choice = body.tool_choice;
          if (stopSequences.length > 0) fwd.stop_sequences = stopSequences;
          const beta = typeof req.headers["anthropic-beta"] === "string" ? req.headers["anthropic-beta"] : "";
          const resp = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": item.key,
              "anthropic-version": "2023-06-01",
              ...(beta ? { "anthropic-beta": beta } : {}),
            },
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
              } finally {
                try { reader.releaseLock(); } catch {}
              }
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
            cdUntil.set(h, Date.now() + COOLDOWN_MS);
            fail429.set(h, (fail429.get(h) || 0) + 1);
          } else if (resp.status === 401 || resp.status === 403) {
            // hint is prov-anthropic here (or unknown) — only sure when tagged, unknown keys just deprioritize
            failOther.set(h, (failOther.get(h) || 0) + 1);
          } else {
            failOther.set(h, (failOther.get(h) || 0) + 1);
          }
          if (![401, 403, 429, 500, 502, 503, 504].includes(resp.status)) break;
          continue;
        }

        // Translated path via OpenAI-compat upstream.
        const base = itemBase || UPSTREAMS[servedId]?.baseUrl || UPSTREAMS["prov-gemini"].baseUrl;
        const oaiBody: any = {
          model: serveModel,
          messages: msgs,
          max_tokens: maxTokens,
          temperature,
          ...(oaiTools ? { tools: oaiTools, tool_choice: oaiToolChoice } : {}),
          ...(stopSequences.length > 0 ? { stop: stopSequences } : {}),
          ...(wantStream ? { stream: true } : {}),
        };
        const resp = await fetch(`${base.replace(/\/+$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${item.key}`,
            "HTTP-Referer": "https://edge-ai-router.vercel.app",
            "X-Title": "Edge Router",
          },
          body: JSON.stringify(oaiBody),
        });
        if (!resp.ok) {
          const edata: any = await resp.json().catch(() => null);
          lastErr = edata?.error?.message || edata?.message || `Upstream HTTP ${resp.status}`;
          lastStatus = resp.status;
          if (resp.status === 429) {
            cdUntil.set(h, Date.now() + COOLDOWN_MS);
            fail429.set(h, (fail429.get(h) || 0) + 1);
          } else {
            failOther.set(h, (failOther.get(h) || 0) + 1);
          }
          const nativeMatch = serveModel === model;
          const retryable = [401, 403, 429, 500, 502, 503, 504].includes(resp.status) || (!nativeMatch && [400, 404].includes(resp.status));
          if (!retryable) break;
          continue;
        }

        if (!wantStream || !resp.body) {
          const d: any = await resp.json().catch(() => null);
          const choice = d?.choices?.[0];
          const { blocks, hasTools } = openAIMessageToBlocks(choice?.message || {});
          const usage = d?.usage || {};
          res.setHeader("X-Edge-Upstream", servedId);
          res.setHeader("X-Edge-Model", serveModel);
          return res.json({
            id: msgId,
            type: "message",
            role: "assistant",
            content: blocks,
            model,
            stop_reason: finishToStop(choice?.finish_reason, hasTools),
            usage: {
              input_tokens: usage.prompt_tokens ?? 0,
              output_tokens: usage.completion_tokens ?? 0,
            },
          });
        }

        // Streaming: OpenAI SSE -> Anthropic SSE (headers only after upstream 200, so rotation stays safe).
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Edge-Upstream": servedId, "X-Edge-Model": serveModel });
        const send = (obj: any) => res.write(`event: ${obj.type}\ndata: ${JSON.stringify(obj)}\n\n`);
        send({ type: "message_start", message: { id: msgId, type: "message", role: "assistant", content: [], model, stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } } });
        let textOpen = false;
        let toolIdx = -1;
        let toolId = "";
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
          const lines = raw.split("\n");
          for (const ln of lines) {
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
                toolId = typeof tc.id === "string" ? tc.id : `toolu_${Math.random().toString(36).slice(2)}`;
                toolName = tc.function?.name || toolName || "tool";
                send({ type: "content_block_start", index: toolIdx, content_block: { type: "tool_use", id: toolId, name: toolName, input: {} } });
                toolOpen = true;
              }
              if (tc.id) toolId = tc.id;
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
        } finally {
          try { reader.releaseLock(); } catch {}
        }
        if (textOpen) send({ type: "content_block_stop", index: 0 });
        if (toolOpen) send({ type: "content_block_stop", index: toolIdx });
        if (!textOpen && !toolOpen) {
          send({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
          send({ type: "content_block_stop", index: 0 });
        }
        send({ type: "message_delta", delta: { stop_reason: finishToStop(finishReason, toolIdx >= 0) }, usage: { output_tokens: outTokens } });
        send({ type: "message_stop" });
        return res.end();
      } catch (e: any) {
        lastErr = `Upstream unreachable: ${e?.message || e}`;
        lastStatus = 502;
        failOther.set(h, (failOther.get(h) || 0) + 1);
        // Network-level failure — try next key (different upstream may be fine).
        continue;
      }
    }

    const type = lastStatus === 401 ? "authentication_error" : lastStatus === 429 ? "rate_limit_error" : lastStatus === 404 ? "not_found_error" : "api_error";
    return anthropicError(res, lastStatus === 401 || lastStatus === 429 || lastStatus === 404 ? lastStatus : 502, `${lastErr} (${ordered.length} keys tried)`, type);
  } catch (err: any) {
    console.error("anthropic/messages error:", err);
    return anthropicError(res, 500, err?.message || "messages failed");
  }
}
