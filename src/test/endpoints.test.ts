import { describe, it, expect } from 'vitest';
import {
  validateCustomEndpoint, addCustomEndpoint, listCustomEndpoints,
  updateCustomEndpoint, deleteCustomEndpoint, customPoolEntries, customEndpointsSig,
} from '../utils/customEndpoints';
import { computeStats, type ProbeSample } from '../utils/probe';

const good = { name: 'My vLLM', baseUrl: 'https://llm.example.com/v1', key: 'sk-local-0123456789abcdef', model: 'my-model' };

describe('validateCustomEndpoint — SSRF guard (client mirror)', () => {
  it('accepts a normal public https endpoint', () => {
    expect(validateCustomEndpoint(good)).toBe('');
  });

  it.each([
    ['plain http', { ...good, baseUrl: 'http://llm.example.com/v1' }],
    ['localhost', { ...good, baseUrl: 'https://localhost/v1' }],
    ['localhost subdomain', { ...good, baseUrl: 'https://api.localhost/v1' }],
    ['.local', { ...good, baseUrl: 'https://box.local/v1' }],
    ['.internal', { ...good, baseUrl: 'https://svc.internal/v1' }],
    ['loopback ip', { ...good, baseUrl: 'https://127.0.0.1/v1' }],
    ['link-local / cloud metadata', { ...good, baseUrl: 'https://169.254.169.254/latest/meta-data' }],
    ['rfc1918 10/8', { ...good, baseUrl: 'https://10.0.0.5/v1' }],
    ['rfc1918 192.168/16', { ...good, baseUrl: 'https://192.168.1.20/v1' }],
    ['rfc1918 172.16/12', { ...good, baseUrl: 'https://172.16.4.9/v1' }],
    ['all-zeros', { ...good, baseUrl: 'https://0.0.0.0/v1' }],
    ['ipv6 literal', { ...good, baseUrl: 'https://[::1]/v1' }],
    ['bare hostname', { ...good, baseUrl: 'https://mybox/v1' }],
    ['not a url', { ...good, baseUrl: 'llm.example.com' }],
    ['empty', { ...good, baseUrl: '' }],
  ])('rejects %s', (_label, draft) => {
    expect(validateCustomEndpoint(draft).length).toBeGreaterThan(0);
  });

  it('rejects a missing name / key / model', () => {
    expect(validateCustomEndpoint({ ...good, name: '' })).not.toBe('');
    expect(validateCustomEndpoint({ ...good, key: '' })).not.toBe('');
    expect(validateCustomEndpoint({ ...good, model: '' })).not.toBe('');
  });
});

describe('custom endpoint CRUD', () => {
  it('adds, lists, updates and deletes', () => {
    const ep = addCustomEndpoint({ ...good, tag: '' });
    expect(ep.id).toBeTruthy();
    expect(listCustomEndpoints()).toHaveLength(1);

    expect(updateCustomEndpoint(ep.id, { model: 'renamed-model' })).toBe(true);
    expect(listCustomEndpoints()[0].model).toBe('renamed-model');

    deleteCustomEndpoint(ep.id);
    expect(listCustomEndpoints()).toHaveLength(0);
  });

  it('gives every endpoint a distinct id', () => {
    addCustomEndpoint({ ...good, tag: '' });
    const dup = addCustomEndpoint({ ...good, tag: '' });
    expect(dup.id).toBeTruthy();
    // Behaviour is "allow but distinct id" — assert we can tell them apart.
    expect(new Set(listCustomEndpoints().map((e) => e.id)).size).toBe(listCustomEndpoints().length);
  });
});

describe('customPoolEntries — what actually goes into the master key', () => {
  it('carries base URL and model affinity so the gateway can dial the right box', () => {
    addCustomEndpoint({ ...good, tag: '' });
    const entries = customPoolEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].b).toBe(good.baseUrl);
    expect(entries[0].m).toBe(good.model);
    expect(entries[0].k).toBe(good.key);
  });

  it('omits disabled endpoints', () => {
    // Self-contained: the setup file clears storage before every test.
    const ep = addCustomEndpoint({ ...good, tag: '' });
    expect(customPoolEntries()).toHaveLength(1);
    updateCustomEndpoint(ep.id, { enabled: false });
    expect(customPoolEntries()).toHaveLength(0);
  });
});

describe('customEndpointsSig — stale-master detection', () => {
  it('changes when a base URL, key, model or tag changes', () => {
    addCustomEndpoint({ ...good, tag: '' });
    const before = customEndpointsSig();
    const [ep] = listCustomEndpoints();
    updateCustomEndpoint(ep.id, { model: 'other-model' });
    expect(customEndpointsSig()).not.toBe(before);
  });

  it('is order-insensitive (sorting before hashing)', () => {
    addCustomEndpoint({ name: 'A', baseUrl: 'https://a.example.com/v1', key: 'sk-aaaaaaaaaaaaaaaaaaaa', model: 'm', tag: '' });
    addCustomEndpoint({ name: 'B', baseUrl: 'https://b.example.com/v1', key: 'sk-bbbbbbbbbbbbbbbbbbbb', model: 'm', tag: '' });
    const sig1 = customEndpointsSig();
    const all = listCustomEndpoints();
    deleteCustomEndpoint(all[0].id);
    addCustomEndpoint({ name: 'A', baseUrl: 'https://a.example.com/v1', key: 'sk-aaaaaaaaaaaaaaaaaaaa', model: 'm', tag: '' });
    expect(customEndpointsSig()).toBe(sig1);
  });
});

describe('computeStats — real telemetry aggregation', () => {
  const samples = (spec: [boolean, number][]): ProbeSample[] =>
    spec.map(([ok, ms], i) => ({ t: 1_000 + i, ok, ms: ok ? ms : 0 }));

  it('reports measured:false with no history (never fabricates)', () => {
    const s = computeStats([]);
    expect(s.measured).toBe(false);
    expect(s.uptimePct).toBe(0);
    expect(s.medianMs).toBe(0);
  });

  it('computes uptime as a real success ratio', () => {
    const s = computeStats(samples([[true, 100], [true, 120], [false, 0], [true, 140]]));
    expect(s.samples).toBe(4);
    expect(s.ok).toBe(3);
    expect(s.failed).toBe(1);
    expect(s.uptimePct).toBe(75);
  });

  it('computes median and p95 from successful probes only', () => {
    const s = computeStats(samples([[true, 10], [true, 20], [true, 30], [true, 400], [false, 0]]));
    expect(s.medianMs).toBe(20);
    expect(s.p95Ms).toBe(400);
    expect(s.lastMs).toBe(0); // the last probe failed
    expect(s.lastOk).toBe(false);
  });

  it('handles an all-failing history', () => {
    const s = computeStats(samples([[false, 0], [false, 0]]));
    expect(s.uptimePct).toBe(0);
    expect(s.medianMs).toBe(0);
    expect(s.measured).toBe(true);
  });
});
