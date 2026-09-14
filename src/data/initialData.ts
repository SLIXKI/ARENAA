import { Provider, Endpoint } from '../types/router';

// The gateway lives on whatever origin is serving this app — never a hardcoded
// domain, so self-hosted / preview / tunnel deployments all work out of the box.
export const SITE_ORIGIN: string =
  typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : 'http://localhost:3000';

export const GATEWAY_BASE_URL = `${SITE_ORIGIN}/api/v1`;
export const ANTHROPIC_BASE_URL = `${SITE_ORIGIN}/api/anthropic`;

// UNIVERSAL MODE: ONE provider (Edge Router) — sab models, sab keys, auto-route.
// Model naam se upstream select hota hai; providerId dene ki zaroorat nahi.
// No hardcoded secrets: every key is per-user (KEYS UI / Copilot).
// Pool: er_api_keys_Edge Router (key prefix se upstream auto-detect).

export const UNIVERSAL_MODELS: string[] = [
  'gemini-flash-latest',
  'gemini-3.6-flash',
  'gemini-pro-latest',
  'gemini-flash-lite-latest',
  'llama-3.3-70b-versatile',
  'mixtral-8x7b-32768',
  'gemma2-9b-it',
  'llama-3.1-8b-instant',
  'google/gemma-4-31b-it:free',
  'nex-agi/nex-n2.5-mini:free',
  'liquid/lfm-2.5-2.6b:free',
  'llama-3.3-70b',
  'llama3.1-8b',
  // OpenAI
  'gpt-4o-mini',
  'gpt-4o',
  'o1-mini',
  // Anthropic
  'claude-3-5-haiku-latest',
  'claude-3-5-sonnet-latest',
  // DeepSeek
  'deepseek-chat',
  'deepseek-reasoner',
  // Mistral
  'mistral-small-latest',
  'open-mistral-7b',
  // xAI
  'grok-3-mini',
  // Perplexity
  'sonar',
  // Together / Fireworks / SiliconFlow / Novita / Hyperbolic / Chutes / GLHF / Cohere
  'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  'accounts/fireworks/models/llama-v3p1-8b-instruct',
  'Qwen/Qwen2.5-7B-Instruct',
  'meta-llama/llama-3.1-8b-instruct',
  'meta-llama/Meta-Llama-3.1-8B-Instruct',
  'deepseek-ai/DeepSeek-V3',
  'hf:meta-llama/Llama-3.3-70B-Instruct',
  'command-r-plus',
  // Zhipu / Qwen / Moonshot / GitHub Models / HuggingFace / SambaNova / Nebius / Pollinations
  'glm-4-flash',
  'qwen-turbo',
  'kimi-k2-0711-preview',
  'openai/gpt-4o-mini',
  'meta-llama/Llama-3.3-70B-Instruct',
  'Meta-Llama-3.3-70B-Instruct',
  'Qwen/Qwen2.5-72B-Instruct',
  'openai',
];

export const INITIAL_PROVIDERS: Provider[] = [
  {
    id: 'Edge Router',
    name: 'Edge Router',
    slug: 'edge-router-universal',
    category: 'LLM & Multimodal',
    defaultBaseUrl: GATEWAY_BASE_URL,
    models: UNIVERSAL_MODELS,
    dailyTokenQuota: 'Apni keys lagao • auto-route',
  },
];

export const INITIAL_ENDPOINTS: Endpoint[] = [
  {
    id: 'ep-universal-anycast',
    providerId: 'Edge Router',
    name: 'Universal Gateway',
    region: 'global-anycast',
    regionLabel: 'Global Anycast',
    apiKey: '',
    baseUrl: GATEWAY_BASE_URL,
    weight: 100,
    priorityTier: 1,
    status: 'healthy',
    // Real numbers only: the live probe (src/utils/probe.ts) fills these in from
    // actual /api/health round-trips. 0 means "not measured yet" — never fabricated.
    latencyMs: 0,
    uptimePercentage: 0,
    rateLimitRpm: 10000,
    rateLimitRemaining: 10000,
    totalRouted: 0,
    errorsCount: 0,
    enabled: true,
    lastChecked: Date.now(),
  },
];

export const INITIAL_FALLBACK_CHAIN: string[] = ['Edge Router'];

export const INITIAL_DAILY_USAGES: Record<string, {
  requestsUsed: number;
  requestsLimit: number;
  tokensUsed: number;
  tokensLimit: number;
  primaryUnit: 'requests' | 'tokens';
}> = {
  'Edge Router': {
    requestsUsed: 0,
    requestsLimit: 10000,
    tokensUsed: 0,
    tokensLimit: 5000000,
    primaryUnit: 'requests',
  },
};

// Legacy IDs (purane clients/chain ke liye) — sab universal pe map hote hai.
export const LEGACY_PROVIDER_IDS: string[] = [
  'prov-gemini',
  'prov-groq',
  'prov-openrouter',
  'prov-cerebras',
];
