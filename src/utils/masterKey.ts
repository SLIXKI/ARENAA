// Shared master-key (er1...) helpers — ONE implementation used by ConnectHub,
// WorkerExporter, and anywhere else. Pools = provider keys + custom endpoints.
import type { Provider } from '../types/router';
import { getProviderKeyEntries, poolsSnapshot } from './providerKeys';
import { customPoolEntries, customEndpointsSig } from './customEndpoints';

export interface MasterMeta {
  mid?: string;
  label?: string;
  expiresAt?: number;
  counts?: Record<string, { count: number; gmails: string[] }>;
  poolsSnapshot?: string;
  customSig?: string;
}

const LS_KEY = 'er_master_key';
const LS_META = 'er_master_meta';

export function loadMaster(): { key: string; meta: MasterMeta | null } {
  try {
    const key = localStorage.getItem(LS_KEY) || '';
    const meta = JSON.parse(localStorage.getItem(LS_META) || 'null');
    return { key, meta };
  } catch {
    return { key: '', meta: null };
  }
}

export function saveMaster(key: string, meta: MasterMeta | null) {
  try {
    if (key) {
      localStorage.setItem(LS_KEY, key);
      localStorage.setItem(LS_META, JSON.stringify(meta));
    } else {
      localStorage.removeItem(LS_KEY);
      localStorage.removeItem(LS_META);
    }
  } catch { /* ignore */ }
}

export type MasterPoolEntry = { k: string; g: string; u?: string; b?: string; m?: string };

// Full pools object for /api/keys/issue: provider pools + custom endpoints.
export function buildMasterPools(providers: Provider[]): Record<string, MasterPoolEntry[]> {
  const pools: Record<string, MasterPoolEntry[]> = {};
  (providers || []).forEach((p) => {
    const entries = getProviderKeyEntries(p.id);
    if (entries.length > 0) pools[p.id] = entries.map((e) => ({ k: e.k, g: e.g, ...(e.u ? { u: e.u } : {}) }));
  });
  const customs = customPoolEntries();
  if (customs.length > 0) pools['custom'] = customs;
  return pools;
}

export function masterSigNow(providers: Provider[]): { poolsSnapshot: string; customSig: string } {
  let sig = '';
  try {
    sig = poolsSnapshot((providers || []).map((p) => p.id));
  } catch { /* ignore */ }
  return { poolsSnapshot: sig, customSig: customEndpointsSig() };
}

export function isMasterStale(providers: Provider[], meta: MasterMeta | null): boolean {
  if (!meta) return false;
  const now = masterSigNow(providers);
  return meta.poolsSnapshot !== now.poolsSnapshot || (meta.customSig || '') !== now.customSig;
}

export async function issueMaster(pools: Record<string, MasterPoolEntry[]>, label: string): Promise<any> {
  const res = await fetch('/api/keys/issue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys: pools, label }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.masterKey) {
    throw new Error(data?.error || 'Generate fail ho gaya.');
  }
  return data;
}

export async function revokeMaster(masterKey: string): Promise<string> {
  try {
    const res = await fetch('/api/keys/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ masterKey }),
    });
    const data = await res.json().catch(() => null);
    return data?.mode || (data?.revoked ? 'global' : 'local-only');
  } catch {
    return 'local-only';
  }
}

export function countMasterKeys(pools: Record<string, MasterPoolEntry[]>): number {
  return Object.values(pools).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0);
}

export function expiryText(expiresAt?: number): string {
  try {
    if (!expiresAt) return '';
    const d = new Date(expiresAt);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}
