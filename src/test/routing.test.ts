import { describe, it, expect } from 'vitest';
import { upstreamForModel, MODEL_UPSTREAM } from '../utils/upstream';
import { detectKeyUpstream, effectiveUpstream, isKnownUpstream, UPSTREAM_IDS } from '../utils/providerKeys';

describe('upstreamForModel — model name routing', () => {
  it('maps exact catalog entries', () => {
    expect(upstreamForModel('gemini-flash-latest')).toBe('prov-gemini');
    expect(upstreamForModel('llama-3.3-70b-versatile')).toBe('prov-groq');
    expect(upstreamForModel('claude-3-5-haiku-latest')).toBe('prov-anthropic');
    expect(upstreamForModel('deepseek-chat')).toBe('prov-deepseek');
  });

  it('applies prefix heuristics to models that are not in the static table', () => {
    // A brand-new model id must still route somewhere sensible.
    expect(upstreamForModel('gpt-5-turbo')).toBe('prov-openai');
    expect(upstreamForModel('gemini-99-flash')).toBe('prov-gemini');
    expect(upstreamForModel('claude-4-opus')).toBe('prov-anthropic');
    expect(upstreamForModel('grok-4')).toBe('prov-xai');
    expect(upstreamForModel('sonar-deep-research')).toBe('prov-perplexity');
    expect(upstreamForModel('glm-5-air')).toBe('prov-zhipu');
    expect(upstreamForModel('qwen3-max')).toBe('prov-qwen');
    expect(upstreamForModel('moonshot-v1-128k')).toBe('prov-moonshot');
  });

  it('routes :free suffixed ids to OpenRouter', () => {
    expect(upstreamForModel('some-vendor/new-model:free')).toBe('prov-openrouter');
  });

  it('routes namespaced ids NOT in the static table to OpenRouter', () => {
    expect(upstreamForModel('openai/gpt-4o-2024-11-20')).toBe('prov-openrouter');
    expect(upstreamForModel('anthropic/claude-3.5-sonnet')).toBe('prov-openrouter');
  });

  it('lets exact GitHub Models ids win over the openai/* catch-all', () => {
    // Deliberate ambiguity: GitHub Models really does serve `openai/gpt-4o`.
    // The exact table entry takes precedence over the OpenRouter prefix rule.
    // An OpenRouter-only caller is still served correctly because each key is
    // dialled at its OWN base URL, and a 404 from a non-target upstream is
    // retryable so rotation continues.
    expect(upstreamForModel('openai/gpt-4o')).toBe('prov-githubmodels');
    expect(upstreamForModel('openai/gpt-4o-mini')).toBe('prov-githubmodels');
  });

  it('distinguishes the near-identical Llama ids across providers', () => {
    expect(upstreamForModel('meta-llama/Llama-3.3-70B-Instruct')).toBe('prov-huggingface');
    expect(upstreamForModel('meta-llama/Llama-3.3-70B-Instruct-Turbo')).toBe('prov-together');
    expect(upstreamForModel('hf:meta-llama/Llama-3.3-70B-Instruct')).toBe('prov-glhf');
  });

  it('never throws on junk input', () => {
    expect(() => upstreamForModel('')).not.toThrow();
    expect(() => upstreamForModel('💥')).not.toThrow();
  });

  it('every value in the static table is a known upstream id', () => {
    // Guards against a typo silently disabling routing for a model.
    const bad = Object.entries(MODEL_UPSTREAM).filter(([, id]) => !isKnownUpstream(id));
    expect(bad).toEqual([]);
  });
});

describe('detectKeyUpstream — key prefix routing', () => {
  const cases: [string, string][] = [
    ['AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ123456', 'prov-gemini'],
    ['gsk_abcdefghijklmnopqrstuvwxyz1234', 'prov-groq'],
    ['sk-or-v1-abcdef0123456789', 'prov-openrouter'],
    ['csk-abcdef0123456789', 'prov-cerebras'],
    ['sk-proj-AbCdEfGhIjKlMnOpQrStUvWx', 'prov-openai'],
    ['sk-svcacct-AbCdEfGhIjKlMnOp', 'prov-openai'],
    ['sk-ant-api03-AbCdEfGhIjKlMnOp', 'prov-anthropic'],
    ['xai-AbCdEfGhIjKlMnOpQrSt', 'prov-xai'],
    ['pplx-AbCdEfGhIjKlMnOpQrSt', 'prov-perplexity'],
    ['fw_AbCdEfGhIjKlMnOpQrSt', 'prov-fireworks'],
    ['glhf_AbCdEfGhIjKlMnOpQrSt', 'prov-glhf'],
    ['ghp_AbCdEfGhIjKlMnOpQrStUvWx', 'prov-githubmodels'],
    ['github_pat_AbCdEfGhIjKlMnOpQrStUv', 'prov-githubmodels'],
    ['hf_AbCdEfGhIjKlMnOpQrStUvWx', 'prov-huggingface'],
    ['pollinations-free-tier', 'prov-pollinations'],
  ];

  it.each(cases)('detects %s -> %s', (key, expected) => {
    expect(detectKeyUpstream(key)).toBe(expected);
  });

  it('returns "unknown" for the 14 providers that all issue ambiguous sk- keys', () => {
    // This is exactly why the explicit `u` tag exists.
    expect(detectKeyUpstream('sk-deepseek-abcdef0123456789')).toBe('unknown');
    expect(detectKeyUpstream('sk-somethingelse-abcdef012345')).toBe('unknown');
  });

  it('never throws and never returns undefined', () => {
    for (const junk of ['', 'x', 'sk-', null as any, undefined as any]) {
      expect(typeof detectKeyUpstream(junk)).toBe('string');
    }
  });
});

describe('effectiveUpstream — explicit tag beats prefix detection', () => {
  it('prefers a known explicit tag', () => {
    // An ambiguous sk- key tagged as DeepSeek must be treated as DeepSeek.
    expect(effectiveUpstream({ k: 'sk-abcdef0123456789', g: '', s: 'active', a: 0, u: 'prov-deepseek' })).toBe('prov-deepseek');
  });

  it('ignores an invalid tag and falls back to prefix detection', () => {
    expect(effectiveUpstream({ k: 'gsk_abcdef0123456789', g: '', s: 'active', a: 0, u: 'not-a-provider' })).toBe('prov-groq');
  });

  it('an explicit tag overrides a conflicting prefix', () => {
    // The user knows better than the heuristic — e.g. a proxy that reissues keys.
    expect(effectiveUpstream({ k: 'AIzaSyABCDEFGHIJKLMNOPQRSTUV', g: '', s: 'active', a: 0, u: 'prov-openrouter' })).toBe('prov-openrouter');
  });

  it('accepts a bare string as well as a KeyEntry', () => {
    expect(effectiveUpstream('gsk_abcdef0123456789')).toBe('prov-groq');
  });
});

describe('upstream registry integrity', () => {
  it('has no duplicate ids', () => {
    expect(new Set(UPSTREAM_IDS).size).toBe(UPSTREAM_IDS.length);
  });

  it('isKnownUpstream rejects junk', () => {
    expect(isKnownUpstream('prov-gemini')).toBe(true);
    expect(isKnownUpstream('prov-doesnotexist')).toBe(false);
    expect(isKnownUpstream('')).toBe(false);
  });
});
