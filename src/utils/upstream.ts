// Shared upstream routing table (frontend mirror of api/v1 + server logic).
// Model naam -> upstream; key prefix -> upstream. Keep in sync with backend maps.
import { detectKeyUpstream } from "./providerKeys";

export const UPSTREAM_META: Record<string, { name: string; short: string }> = {
  "prov-gemini": { name: "Google Gemini", short: "Gemini" },
  "prov-groq": { name: "Groq", short: "Groq" },
  "prov-openrouter": { name: "OpenRouter", short: "OpenRouter" },
  "prov-cerebras": { name: "Cerebras", short: "Cerebras" },
  "prov-openai": { name: "OpenAI", short: "OpenAI" },
  "prov-anthropic": { name: "Anthropic", short: "Anthropic" },
  "prov-deepseek": { name: "DeepSeek", short: "DeepSeek" },
  "prov-mistral": { name: "Mistral", short: "Mistral" },
  "prov-xai": { name: "xAI", short: "xAI" },
  "prov-perplexity": { name: "Perplexity", short: "Perplexity" },
  "prov-together": { name: "Together", short: "Together" },
  "prov-fireworks": { name: "Fireworks", short: "Fireworks" },
  "prov-siliconflow": { name: "SiliconFlow", short: "SiliconFlow" },
  "prov-novita": { name: "Novita", short: "Novita" },
  "prov-hyperbolic": { name: "Hyperbolic", short: "Hyperbolic" },
  "prov-chutes": { name: "Chutes", short: "Chutes" },
  "prov-glhf": { name: "GLHF", short: "GLHF" },
  "prov-cohere": { name: "Cohere", short: "Cohere" },
  unknown: { name: "Unknown", short: "?" },
};

export const MODEL_UPSTREAM: Record<string, string> = {
  // Gemini
  "gemini-flash-latest": "prov-gemini",
  "gemini-3.6-flash": "prov-gemini",
  "gemini-pro-latest": "prov-gemini",
  "gemini-flash-lite-latest": "prov-gemini",
  // Groq
  "llama-3.3-70b-versatile": "prov-groq",
  "mixtral-8x7b-32768": "prov-groq",
  "gemma2-9b-it": "prov-groq",
  "llama-3.1-8b-instant": "prov-groq",
  // OpenRouter (free)
  "google/gemma-4-31b-it:free": "prov-openrouter",
  "nex-agi/nex-n2.5-mini:free": "prov-openrouter",
  "liquid/lfm-2.5-2.6b:free": "prov-openrouter",
  // Cerebras
  "llama-3.3-70b": "prov-cerebras",
  "llama3.1-8b": "prov-cerebras",
  // OpenAI
  "gpt-4o-mini": "prov-openai",
  "gpt-4o": "prov-openai",
  "gpt-4.1-mini": "prov-openai",
  "gpt-4.1": "prov-openai",
  "o1-mini": "prov-openai",
  "o3-mini": "prov-openai",
  "chatgpt-4o-latest": "prov-openai",
  // Anthropic
  "claude-3-5-haiku-latest": "prov-anthropic",
  "claude-3-5-sonnet-latest": "prov-anthropic",
  "claude-3-haiku-20240307": "prov-anthropic",
  // DeepSeek
  "deepseek-chat": "prov-deepseek",
  "deepseek-reasoner": "prov-deepseek",
  // Mistral
  "mistral-small-latest": "prov-mistral",
  "mistral-medium-latest": "prov-mistral",
  "mistral-large-latest": "prov-mistral",
  "open-mistral-7b": "prov-mistral",
  "open-mixtral-8x7b": "prov-mistral",
  // xAI
  "grok-3-mini": "prov-xai",
  grok: "prov-xai",
  "grok-2-1212": "prov-xai",
  // Perplexity
  sonar: "prov-perplexity",
  "sonar-pro": "prov-perplexity",
  "sonar-reasoning": "prov-perplexity",
  // Together
  "meta-llama/Llama-3.3-70B-Instruct-Turbo": "prov-together",
  "Qwen/Qwen2.5-Coder-32B-Instruct": "prov-together",
  // Fireworks
  "accounts/fireworks/models/llama-v3p1-8b-instruct": "prov-fireworks",
  "accounts/fireworks/models/qwen2p5-coder-32b-instruct": "prov-fireworks",
  // SiliconFlow
  "Qwen/Qwen2.5-7B-Instruct": "prov-siliconflow",
  "THUDM/glm-4-9b-chat": "prov-siliconflow",
  // Novita
  "meta-llama/llama-3.1-8b-instruct": "prov-novita",
  // Hyperbolic
  "meta-llama/Meta-Llama-3.1-8B-Instruct": "prov-hyperbolic",
  // Chutes
  "deepseek-ai/DeepSeek-V3": "prov-chutes",
  // GLHF
  "hf:meta-llama/Llama-3.3-70B-Instruct": "prov-glhf",
  "hf:Qwen/Qwen2.5-72B-Instruct": "prov-glhf",
  // Cohere
  "command-r-plus": "prov-cohere",
  "command-r": "prov-cohere",
};

export function upstreamForModel(model: string): string | null {
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
  // OpenRouter free / namespaced catch-alls
  if (model.endsWith(":free")) return "prov-openrouter";
  if (model.startsWith("openai/") || model.startsWith("anthropic/")) return "prov-openrouter";
  return null;
}

export interface ModelKeyStatus {
  model: string;
  upstream: string | null;
  upstreamName: string;
  hasKey: boolean;
}

// Har model ke saath: kaunsa upstream + uski key pool me hai ya nahi.
// pools values can be plain key strings; hints (explicit tags) improve unknown-key matching.
export function modelsWithKeyStatus(
  models: string[],
  pools: Record<string, string[]>,
  hints?: Record<string, string[]>
): ModelKeyStatus[] {
  const allKeys: string[] = [];
  const allHints: string[] = [];
  Object.values(pools).forEach((arr) => {
    if (Array.isArray(arr)) allKeys.push(...arr);
  });
  if (hints) {
    Object.values(hints).forEach((arr) => {
      if (Array.isArray(arr)) allHints.push(...arr);
    });
  }
  const hasKeyFor = (up: string | null): boolean => {
    if (!up) return allKeys.length > 0;
    if (allHints.includes(up)) return true;
    return allKeys.some((k) => detectKeyUpstream(k) === up);
  };
  return models.map((model) => {
    const up = upstreamForModel(model);
    return {
      model,
      upstream: up,
      upstreamName: up ? UPSTREAM_META[up]?.short || up : "Auto",
      hasKey: hasKeyFor(up),
    };
  });
}
