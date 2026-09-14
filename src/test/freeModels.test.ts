import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FREE_POLICY, KEYLESS_UPSTREAMS, isFreeModel, isChatModelId, NON_CHAT_RE,
} from '../utils/freeModels';

// ---------------------------------------------------------------------------
// Classifier semantics
// ---------------------------------------------------------------------------
describe('isFreeModel — evidence tiers', () => {
  it('treats a keyless upstream as free for anyone', () => {
    expect(isFreeModel('prov-pollinations', 'openai')).toBe(true);
    expect(KEYLESS_UPSTREAMS).toContain('prov-pollinations');
  });

  it('treats a whole-free-tier upstream as free', () => {
    for (const u of ['prov-gemini', 'prov-groq', 'prov-githubmodels', 'prov-cerebras', 'prov-sambanova', 'prov-huggingface']) {
      expect(isFreeModel(u, 'some-model-id')).toBe(true);
    }
  });

  it('honours per-id policy, and rejects ids outside it', () => {
    expect(isFreeModel('prov-zhipu', 'glm-4-flash')).toBe(true);
    expect(isFreeModel('prov-zhipu', 'glm-4.5-air')).toBe(true);
    expect(isFreeModel('prov-zhipu', 'glm-4.6')).toBe(false);
    expect(isFreeModel('prov-siliconflow', 'Qwen/Qwen2.5-7B-Instruct')).toBe(true);
    expect(isFreeModel('prov-siliconflow', 'Qwen/Qwen2.5-72B-Instruct')).toBe(false);
  });

  it('honours the :free suffix on ANY upstream', () => {
    expect(isFreeModel('prov-openrouter', 'google/gemma-4-31b-it:free')).toBe(true);
    // Even an upstream with no policy at all, if the id says free.
    expect(isFreeModel('prov-someunknown', 'anything:free')).toBe(true);
  });

  it('lets the provider\'s own pricing verdict outrank policy', () => {
    // OpenRouter is the "live" tier: with no pricing data we must NOT assume free.
    expect(isFreeModel('prov-openrouter', 'anthropic/claude-sonnet-4')).toBe(false);
    // Provider says free -> free.
    expect(isFreeModel('prov-openrouter', 'some/model', true)).toBe(true);
    // Provider says it costs money -> paid, even on an otherwise-free upstream.
    expect(isFreeModel('prov-groq', 'llama-3.3-70b-versatile', false)).toBe(false);
  });

  it('defaults to PAID for upstreams with no policy — the safe direction', () => {
    for (const u of ['prov-openai', 'prov-anthropic', 'prov-deepseek', 'prov-mistral', 'prov-xai',
      'prov-perplexity', 'prov-together', 'prov-fireworks', 'prov-cohere', 'prov-nebius']) {
      expect(isFreeModel(u, 'whatever-model')).toBe(false);
    }
    expect(isFreeModel('prov-does-not-exist', 'whatever')).toBe(false);
  });
});

describe('isChatModelId — non-chat filtering', () => {
  it('drops embedding / rerank / audio / image models', () => {
    for (const bad of ['text-embedding-3-small', 'rerank-v1', 'whisper-1', 'gpt-4o-transcribe',
      'dall-e-3', 'veo-3', 'lyria-2', 'llama-guard-3', 'some-tts-voice']) {
      expect(isChatModelId(bad)).toBe(false);
    }
  });

  it('keeps ordinary chat models', () => {
    for (const good of ['gemini-flash-latest', 'llama-3.3-70b-versatile', 'deepseek-chat',
      'google/gemma-4-31b-it:free', 'glm-4-flash']) {
      expect(isChatModelId(good)).toBe(true);
    }
  });

  it('rejects empty ids', () => {
    expect(isChatModelId('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Parity: the policy is duplicated into api/v1/models.ts and server.ts because
// those files are intentionally import-free. A drift there means production and
// dev disagree about what is free, so it must fail CI rather than ship.
// ---------------------------------------------------------------------------
type PolicyEntry = { kind: string; patterns: string[] };

function extractPolicy(source: string): Record<string, PolicyEntry> {
  const start = source.indexOf('FREE_POLICY');
  expect(start).toBeGreaterThan(-1);
  const braceOpen = source.indexOf('{', source.indexOf('=', start));
  expect(braceOpen).toBeGreaterThan(-1);
  let depth = 0;
  let end = -1;
  for (let i = braceOpen; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  expect(end).toBeGreaterThan(braceOpen);
  const block = source.slice(braceOpen + 1, end);

  const out: Record<string, PolicyEntry> = {};
  // One entry per line:  "prov-x": { kind: "all" }  /  'prov-x': { kind: 'ids', patterns: [/a/, /b/] }
  const re = /['"](prov-[a-z0-9]+)['"]\s*:\s*\{\s*kind\s*:\s*['"]([a-z]+)['"]([^\n]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const patterns = [...m[3].matchAll(/\/((?:[^/\\]|\\.)+)\/([gimsuy]*)/g)]
      .map((x) => `${x[1]}|${x[2]}`);
    out[m[1]] = { kind: m[2], patterns };
  }
  return out;
}

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

describe('free-model policy parity across the three copies', () => {
  const canonical: Record<string, PolicyEntry> = Object.fromEntries(
    Object.entries(FREE_POLICY).map(([k, v]) => [
      k,
      { kind: v.kind, patterns: (v.patterns || []).map((re) => `${re.source}|${re.flags}`) },
    ]),
  );
  const apiCopy = extractPolicy(read('api/v1/models.ts'));
  const serverCopy = extractPolicy(read('server.ts'));

  it('the parser actually found every canonical entry (guards the test itself)', () => {
    expect(Object.keys(canonical).length).toBeGreaterThanOrEqual(8);
    expect(Object.keys(apiCopy).length).toBe(Object.keys(canonical).length);
    expect(Object.keys(serverCopy).length).toBe(Object.keys(canonical).length);
  });

  it('api/v1/models.ts matches src/utils/freeModels.ts', () => {
    expect(apiCopy).toEqual(canonical);
  });

  it('server.ts (dev) matches src/utils/freeModels.ts', () => {
    expect(serverCopy).toEqual(canonical);
  });

  it('all three declare the same keyless upstreams', () => {
    const keylessOf = (p: Record<string, PolicyEntry>) =>
      Object.keys(p).filter((k) => p[k].kind === 'keyless').sort();
    expect(keylessOf(apiCopy)).toEqual([...KEYLESS_UPSTREAMS].sort());
    expect(keylessOf(serverCopy)).toEqual([...KEYLESS_UPSTREAMS].sort());
  });

  it('every policy kind is one the classifier understands', () => {
    const kinds = new Set(Object.values(canonical).map((v) => v.kind));
    for (const k of kinds) expect(['keyless', 'all', 'live', 'ids']).toContain(k);
    // An "ids" entry with no patterns would silently classify nothing as free.
    for (const [name, v] of Object.entries(canonical)) {
      if (v.kind === 'ids') expect(v.patterns.length, `${name} has kind:ids but no patterns`).toBeGreaterThan(0);
    }
  });

  it('the non-chat filter is present in both server copies', () => {
    for (const rel of ['api/v1/models.ts', 'server.ts']) {
      const src = read(rel);
      expect(src.includes('NON_CHAT_RE'), `${rel} lost NON_CHAT_RE`).toBe(true);
      // spot-check two distinctive tokens from the shared regex survive mirroring
      expect(src.includes('rerank'), `${rel} filter lost 'rerank'`).toBe(true);
      expect(src.includes('deep-research'), `${rel} filter lost 'deep-research'`).toBe(true);
    }
    expect(NON_CHAT_RE.test('text-embedding-3-small')).toBe(true);
  });
});
