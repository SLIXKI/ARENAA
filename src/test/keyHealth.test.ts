import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  recordKeyOk, recordKey429, recordKeyDead, recordKeyError, getKeyHealth,
  isKeyCooling, cooldownLeftMs, clearKeyCooldown, displayStatus, smartOrderIndexes,
  COOLDOWN_MS,
} from '../utils/keyHealth';
import { keyId } from '../utils/providerKeys';

const K1 = 'gsk_keyOne0123456789abcdef';
const K2 = 'AIzaSyKeyTwo0123456789abcdef';
const K3 = 'sk-or-v1-keyThree0123456789';

afterEach(() => { vi.useRealTimers(); });

describe('keyId — health keys never hold raw key material', () => {
  it('is prefix:length:hash, not the key itself', () => {
    const id = keyId(K1);
    expect(id).not.toContain(K1);
    expect(id.startsWith('gsk_ke')).toBe(true);
    expect(id).toContain(`:${K1.length}:`);
  });

  it('is stable and collision-resistant for similar keys', () => {
    expect(keyId(K1)).toBe(keyId(K1));
    expect(keyId(K1)).not.toBe(keyId(K2));
    // Same prefix, different body — must not collide.
    expect(keyId('gsk_aaaaaaaaaaaaaaaaaaaaaa')).not.toBe(keyId('gsk_bbbbbbbbbbbbbbbbbbbbbb'));
  });
});

describe('health recording', () => {
  it('recordKeyOk marks working, stores latency and clears cooldown', () => {
    recordKey429(K1, 'prov-groq');
    expect(isKeyCooling(K1)).toBe(true);
    recordKeyOk(K1, 'prov-groq', 123);
    const h = getKeyHealth(K1)!;
    expect(h.status).toBe('working');
    expect(h.lastLatencyMs).toBe(123);
    expect(isKeyCooling(K1)).toBe(false);
    expect(h.success).toBe(1);
  });

  it('recordKey429 starts a cooldown that actually expires', () => {
    recordKey429(K2, 'prov-gemini');
    expect(isKeyCooling(K2)).toBe(true);
    expect(cooldownLeftMs(K2)).toBeGreaterThan(0);
    expect(cooldownLeftMs(K2)).toBeLessThanOrEqual(COOLDOWN_MS);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + COOLDOWN_MS + 1000);
    expect(isKeyCooling(K2)).toBe(false);
    expect(cooldownLeftMs(K2)).toBe(0);
  });

  it('recordKeyDead marks dead and counts an auth failure', () => {
    recordKeyDead(K3, 'prov-openrouter');
    const h = getKeyHealth(K3)!;
    expect(h.status).toBe('dead');
    expect(h.failAuth).toBe(1);
  });

  it('recordKeyError counts but does NOT quarantine', () => {
    // A transient 500 must not kill a good key.
    recordKeyError(K1, 'prov-groq', 'upstream 503');
    expect(getKeyHealth(K1)!.status).not.toBe('dead');
    expect(getKeyHealth(K1)!.failOther).toBe(1);
  });
});

describe('displayStatus', () => {
  it('pool-level dead wins over stored health', () => {
    recordKeyOk(K1, 'prov-groq', 10);
    expect(displayStatus(K1, true)).toBe('dead');
    expect(displayStatus(K1, false)).toBe('working');
  });

  it('reports untested for a key nobody has probed', () => {
    expect(displayStatus('gsk_neverSeen0123456789', false)).toBe('untested');
  });
});

describe('clearKeyCooldown — the REVIVE button', () => {
  it('lifts a cooldown immediately', () => {
    recordKey429(K2, 'prov-gemini');
    expect(isKeyCooling(K2)).toBe(true);
    clearKeyCooldown(K2);
    expect(isKeyCooling(K2)).toBe(false);
  });
});

describe('smartOrderIndexes — client-side LRU rotation', () => {
  it('puts cooling keys last', () => {
    recordKey429(K1, 'prov-groq');
    recordKeyOk(K2, 'prov-gemini', 50);
    recordKeyOk(K3, 'prov-openrouter', 50);
    const order = smartOrderIndexes([K1, K2, K3]);
    expect(order[order.length - 1]).toBe(0); // K1 cooling -> last
    expect(order).toContain(1);
    expect(order).toContain(2);
  });

  it('is a permutation (never drops or duplicates a key)', () => {
    const keys = [K1, K2, K3];
    const order = smartOrderIndexes(keys);
    expect(order.slice().sort()).toEqual([0, 1, 2]);
  });

  it('handles an empty pool', () => {
    expect(smartOrderIndexes([])).toEqual([]);
  });
});
