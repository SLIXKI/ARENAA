// ---------------------------------------------------------------------------
// WHAT COUNTS AS A "FREE" MODEL
// ---------------------------------------------------------------------------
// This is the canonical statement of the free-model policy. The serverless
// function (api/v1/models.ts) and the dev server (server.ts) each carry a copy,
// because this project keeps api/ and server.ts deliberately self-contained with
// no cross-file imports. src/test/freeModels.test.ts asserts the three agree, so
// a change here that is not mirrored fails CI rather than silently diverging.
//
// Evidence tiers, strongest first:
//
//   live    The provider publishes per-model pricing in its own /models payload
//           (OpenRouter). We trust the provider rather than asserting anything.
//   keyless The service needs no key at all and is free by design (Pollinations).
//   all     The provider's free tier covers every model a key unlocks (Google AI
//           Studio, Groq, GitHub Models, Cerebras, SambaNova, HuggingFace router).
//   ids     Only specific models are free on that provider (Zhipu's glm-4-flash).
//
// Deliberate bias: when unsure we say PAID. Claiming a model is free when it is
// not costs the user real money; hiding a genuinely free model only costs them
// the chance to pick it. The `all`/`ids` tiers encode provider documentation as
// of 2026-09 and will drift as providers change their tiers — which is exactly
// why the `live` tier overrides them wherever a provider supplies pricing.

export type FreePolicyKind = 'keyless' | 'all' | 'live' | 'ids';
export type FreePolicy = { kind: FreePolicyKind; patterns?: RegExp[] };

export const FREE_POLICY: Record<string, FreePolicy> = {
  'prov-pollinations': { kind: 'keyless' },
  'prov-openrouter': { kind: 'live' },
  'prov-gemini': { kind: 'all' },
  'prov-groq': { kind: 'all' },
  'prov-githubmodels': { kind: 'all' },
  'prov-cerebras': { kind: 'all' },
  'prov-sambanova': { kind: 'all' },
  'prov-huggingface': { kind: 'all' },
  'prov-zhipu': { kind: 'ids', patterns: [/^glm-4-flash/i, /^glm-4-air/i, /^glm-4\.5-air/i] },
  'prov-siliconflow': { kind: 'ids', patterns: [/^Qwen\/Qwen2\.5-7B-Instruct$/i] },
};

/** Upstreams that are free with no key at all — available to every caller. */
export const KEYLESS_UPSTREAMS: string[] = Object.keys(FREE_POLICY).filter(
  (u) => FREE_POLICY[u].kind === 'keyless',
);

/**
 * Classify one model.
 *
 * `liveFree` is the provider's own verdict from its pricing payload and always
 * outranks policy: `true` means free, `false` means it costs money, `undefined`
 * means the provider said nothing and we fall back to policy.
 *
 * A model id ending in `:free` (the OpenRouter convention) is free no matter
 * which upstream serves it.
 */
export function isFreeModel(upstream: string, id: string, liveFree?: boolean): boolean {
  if (/:free$/i.test(id)) return true;
  if (liveFree === true) return true;
  if (liveFree === false) return false;
  const pol = FREE_POLICY[upstream];
  if (!pol) return false; // no policy -> assume paid
  if (pol.kind === 'keyless' || pol.kind === 'all') return true;
  if (pol.kind === 'ids') return (pol.patterns || []).some((re) => re.test(id));
  return false; // 'live' tier with no pricing data -> unknown -> paid
}

/**
 * Non-chat models are noise in a coding agent's picker, and OpenCode drops
 * embedding/rerank entries itself. Filtering server-side keeps the list honest.
 */
export const NON_CHAT_RE =
  /embedding|rerank|whisper|\btts\b|transcribe|guard|moderation|dall-e|image|video|audio|veo|lyria|bidi|live-|deep-research/i;

export function isChatModelId(id: string): boolean {
  return !!id && !NON_CHAT_RE.test(id);
}
