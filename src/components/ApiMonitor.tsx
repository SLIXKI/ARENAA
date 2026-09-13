import React, { useState, useEffect, useMemo } from 'react';
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  Play,
  RotateCcw,
  Trash2,
  Eye,
  EyeOff,
  Search,
  Zap,
  Clock,
  RefreshCw,
} from 'lucide-react';
import type { Provider } from '../types/router';
import {
  getProviderKeyEntries,
  removeProviderKey,
  setKeyStatus,
  maskKey,
  effectiveUpstream,
  UPSTREAM_NAMES,
  UNIVERSAL_PROVIDER_ID,
  type KeyEntry,
} from '../utils/providerKeys';
import {
  displayStatus,
  getKeyHealth,
  recordKeyOk,
  recordKey429,
  recordKeyDead,
  recordKeyError,
  clearKeyCooldown,
  cooldownLeftMs,
  type KeyHealthStatus,
} from '../utils/keyHealth';
import { notify } from '../utils/notify';

interface ApiMonitorProps {
  providers: Provider[];
}

type Filter = 'all' | KeyHealthStatus;

const STATUS_META: Record<KeyHealthStatus, { label: string; cls: string; icon: React.ReactNode }> = {
  working: {
    label: 'WORKING',
    cls: 'bg-emerald-950 text-emerald-300 border-emerald-800',
    icon: <CheckCircle2 className="w-3 h-3" />,
  },
  cooldown: {
    label: 'EXHAUSTED',
    cls: 'bg-amber-950 text-amber-300 border-amber-800',
    icon: <Clock className="w-3 h-3" />,
  },
  dead: {
    label: 'DEAD',
    cls: 'bg-rose-950 text-rose-300 border-rose-800',
    icon: <XCircle className="w-3 h-3" />,
  },
  untested: {
    label: 'UNTESTED',
    cls: 'bg-neutral-900 text-neutral-400 border-neutral-700',
    icon: <HelpCircle className="w-3 h-3" />,
  },
};

function fmtCountdown(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function timeAgo(ts: number): string {
  if (!ts) return 'kabhi nahi';
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s pehle`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m pehle`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h pehle`;
  return `${Math.floor(h / 24)}d pehle`;
}

export const ApiMonitor: React.FC<ApiMonitorProps> = ({ providers }) => {
  const [tick, setTick] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  const [upstreamFilter, setUpstreamFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [showMap, setShowMap] = useState<Record<number, boolean>>({});
  const [testing, setTesting] = useState<Record<number, boolean>>({});
  const [testingAll, setTestingAll] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  // Re-render every second so cooldown countdowns tick live
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const poolId = UNIVERSAL_PROVIDER_ID;
  void tick;

  const entries: { entry: KeyEntry; index: number }[] = useMemo(() => {
    try {
      return getProviderKeyEntries(poolId).map((entry, index) => ({ entry, index }));
    } catch {
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, poolId, providers]);

  const rows = useMemo(() => {
    return entries.map(({ entry, index }) => {
      const up = effectiveUpstream(entry);
      const status = displayStatus(entry.k, entry.s === 'dead');
      const health = getKeyHealth(entry.k);
      return { entry, index, up, status, health };
    });
  }, [entries]);

  const counts = useMemo(() => {
    const c: Record<KeyHealthStatus, number> = { working: 0, cooldown: 0, dead: 0, untested: 0 };
    rows.forEach((r) => {
      c[r.status]++;
    });
    return c;
  }, [rows]);

  const upstreamsPresent = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => set.add(r.up));
    return [...set].sort();
  }, [rows]);

  const filtered = rows.filter((r) => {
    if (filter !== 'all' && r.status !== filter) return false;
    if (upstreamFilter !== 'all' && r.up !== upstreamFilter) return false;
    const q = search.trim().toLowerCase();
    if (q && !r.entry.k.toLowerCase().includes(q) && !(r.entry.g || '').toLowerCase().includes(q)) return false;
    return true;
  });

  const refresh = () => setTick((x) => x + 1);

  const testOne = async (globalIndex: number, silent = false): Promise<boolean> => {
    const ent = getProviderKeyEntries(poolId)[globalIndex];
    if (!ent) return false;
    const up = effectiveUpstream(ent);
    setTesting((t) => ({ ...t, [globalIndex]: true }));
    try {
      const res = await fetch('/api/keys/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: ent.k, upstream: up === 'unknown' ? undefined : up }),
      });
      const data: any = await res.json().catch(() => null);
      if (data?.ok) {
        recordKeyOk(ent.k, data.upstream || up, data.latencyMs || 0);
        if (ent.s === 'dead') setKeyStatus(poolId, globalIndex, 'active');
        if (!silent) notify('success', `Key #${globalIndex + 1} WORKING`, `${UPSTREAM_NAMES[data.upstream] || data.upstream} • ${data.latencyMs}ms • ${data.model}`);
        return true;
      }
      const st = data?.status;
      const err = data?.error || 'Test fail';
      if (st === 429) {
        recordKey429(ent.k, data?.upstream || up, err);
        if (!silent) notify('warn', `Key #${globalIndex + 1} EXHAUSTED (429)`, '60s cooldown — rotation dusri keys pe chala gaya.');
      } else if (st === 401 || st === 403) {
        recordKeyDead(ent.k, data?.upstream || up, err);
        setKeyStatus(poolId, globalIndex, 'dead');
        if (!silent) notify('error', `Key #${globalIndex + 1} DEAD`, `${err.slice(0, 100)}${ent.g ? ` — ${ent.g} se nayi nikalo.` : ''}`);
      } else {
        recordKeyError(ent.k, data?.upstream || up, err);
        if (!silent) notify('error', `Key #${globalIndex + 1} test fail`, err.slice(0, 120));
      }
      return false;
    } catch (e: any) {
      recordKeyError(ent.k, up, e?.message || 'network error');
      if (!silent) notify('error', `Key #${globalIndex + 1} test fail`, 'Network error.');
      return false;
    } finally {
      setTesting((t) => ({ ...t, [globalIndex]: false }));
      refresh();
    }
  };

  const testAll = async () => {
    if (testingAll || entries.length === 0) return;
    setTestingAll(true);
    setProgress({ done: 0, total: entries.length });
    let ok = 0;
    for (let i = 0; i < entries.length; i++) {
      const { index } = entries[i];
      const good = await testOne(index, true);
      if (good) ok++;
      setProgress({ done: i + 1, total: entries.length });
      // Gap taaki test khud rate-limit na trigger kare
      await new Promise((r) => setTimeout(r, 400));
    }
    setTestingAll(false);
    notify(ok === entries.length ? 'success' : 'warn', `Test complete: ${ok}/${entries.length} working`, ok === entries.length ? 'Saari keys live hai. Rotation ready.' : 'Dead/exhausted keys upar dekho — revive ya replace karo.');
    refresh();
  };

  const handleRevive = (idx: number) => {
    const ent = getProviderKeyEntries(poolId)[idx];
    if (!ent) return;
    setKeyStatus(poolId, idx, 'active');
    clearKeyCooldown(ent.k);
    notify('success', `Key #${idx + 1} revived`, 'Wapas rotation me.');
    refresh();
  };

  const handleDelete = (idx: number) => {
    removeProviderKey(poolId, idx);
    notify('warn', `Key #${idx + 1} deleted`, 'Pool se hata di.');
    refresh();
  };

  const total = rows.length;
  const healthyPct = total > 0 ? Math.round(((counts.working + counts.untested) / total) * 100) : 100;

  return (
    <div className="space-y-6 pb-16 font-mono">
      {/* Header */}
      <div className="border-b border-neutral-800/80 pb-4 sm:pb-6 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs uppercase tracking-widest text-neutral-400">
          <span>LIVE KEY HEALTH</span>
          <span>//</span>
          <span className="text-emerald-400 font-semibold">SMART ROTATION MONITOR</span>
        </div>
        <h1 className="text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tight text-white uppercase">
          API MONITOR — KAUNSI KEY LIVE?
        </h1>
        <p className="text-xs sm:text-sm text-neutral-400 font-sans max-w-3xl leading-relaxed">
          Har key ki live halat: <strong className="text-emerald-300">WORKING</strong> (jawab de rahi),
          <strong className="text-amber-300"> EXHAUSTED</strong> (429 — 60s cooldown, auto-skip),
          <strong className="text-rose-300"> DEAD</strong> (401/403 — replace karo).
          Rotation automatically cooled/dead keys skip karke healthy key pakadta hai — rate limit kabhi nahi lagega.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
        <div className="p-3 sm:p-4 bg-neutral-900/60 border border-neutral-800 space-y-1">
          <div className="text-[10px] text-neutral-500 uppercase flex items-center gap-1"><Activity className="w-3 h-3" />Total keys</div>
          <div className="text-2xl font-black text-white">{total}</div>
          <div className="text-[10px] text-neutral-500">{upstreamsPresent.length} providers</div>
        </div>
        <button type="button" onClick={() => setFilter(filter === 'working' ? 'all' : 'working')} className={`p-3 sm:p-4 border space-y-1 text-left transition-colors ${filter === 'working' ? 'border-emerald-500 bg-emerald-950/40' : 'bg-neutral-900/60 border-neutral-800 hover:border-emerald-800'}`}>
          <div className="text-[10px] text-emerald-400 uppercase flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Working</div>
          <div className="text-2xl font-black text-emerald-300">{counts.working}</div>
          <div className="text-[10px] text-neutral-500">ready to serve</div>
        </button>
        <button type="button" onClick={() => setFilter(filter === 'cooldown' ? 'all' : 'cooldown')} className={`p-3 sm:p-4 border space-y-1 text-left transition-colors ${filter === 'cooldown' ? 'border-amber-500 bg-amber-950/40' : 'bg-neutral-900/60 border-neutral-800 hover:border-amber-800'}`}>
          <div className="text-[10px] text-amber-400 uppercase flex items-center gap-1"><Clock className="w-3 h-3" />Exhausted</div>
          <div className="text-2xl font-black text-amber-300">{counts.cooldown}</div>
          <div className="text-[10px] text-neutral-500">429 cooldown</div>
        </button>
        <button type="button" onClick={() => setFilter(filter === 'dead' ? 'all' : 'dead')} className={`p-3 sm:p-4 border space-y-1 text-left transition-colors ${filter === 'dead' ? 'border-rose-500 bg-rose-950/40' : 'bg-neutral-900/60 border-neutral-800 hover:border-rose-800'}`}>
          <div className="text-[10px] text-rose-400 uppercase flex items-center gap-1"><XCircle className="w-3 h-3" />Dead</div>
          <div className="text-2xl font-black text-rose-300">{counts.dead}</div>
          <div className="text-[10px] text-neutral-500">401/403 quota</div>
        </button>
        <button type="button" onClick={() => setFilter(filter === 'untested' ? 'all' : 'untested')} className={`p-3 sm:p-4 border space-y-1 text-left transition-colors ${filter === 'untested' ? 'border-neutral-400 bg-neutral-900' : 'bg-neutral-900/60 border-neutral-800 hover:border-neutral-600'}`}>
          <div className="text-[10px] text-neutral-400 uppercase flex items-center gap-1"><HelpCircle className="w-3 h-3" />Untested</div>
          <div className="text-2xl font-black text-neutral-200">{counts.untested}</div>
          <div className="text-[10px] text-neutral-500">test pending</div>
        </button>
        <div className="p-3 sm:p-4 bg-neutral-900/60 border border-neutral-800 space-y-1">
          <div className="text-[10px] text-neutral-500 uppercase flex items-center gap-1"><Zap className="w-3 h-3" />Pool health</div>
          <div className={`text-2xl font-black ${healthyPct >= 80 ? 'text-emerald-300' : healthyPct >= 50 ? 'text-amber-300' : 'text-rose-300'}`}>{healthyPct}%</div>
          <div className="w-full h-1.5 bg-neutral-800 overflow-hidden">
            <div className={`h-full transition-all ${healthyPct >= 80 ? 'bg-emerald-400' : healthyPct >= 50 ? 'bg-amber-400' : 'bg-rose-400'}`} style={{ width: `${healthyPct}%` }} />
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col md:flex-row md:items-center gap-2 bg-neutral-900/60 border border-neutral-800 p-3">
        <button
          type="button"
          onClick={testAll}
          disabled={testingAll || total === 0}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-400 hover:bg-emerald-300 disabled:opacity-50 text-neutral-950 font-bold text-xs uppercase flex-shrink-0 min-h-[42px]"
        >
          {testingAll ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          <span>{testingAll ? `TESTING ${progress.done}/${progress.total}...` : 'TEST ALL KEYS'}</span>
        </button>
        {testingAll && (
          <div className="flex-1 h-2 bg-neutral-800 overflow-hidden min-w-[120px]">
            <div className="h-full bg-emerald-400 transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
          </div>
        )}
        <div className="flex flex-1 flex-col sm:flex-row gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search key / gmail..."
              className="w-full bg-neutral-950 border border-neutral-800 pl-8 pr-2 py-2 text-xs text-neutral-200 placeholder-neutral-600 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <select
            value={upstreamFilter}
            onChange={(e) => setUpstreamFilter(e.target.value)}
            className="bg-neutral-950 border border-neutral-800 px-2 py-2 text-xs text-neutral-200 focus:border-emerald-500 focus:outline-none"
          >
            <option value="all">All providers ({upstreamsPresent.length})</option>
            {upstreamsPresent.map((u) => (
              <option key={u} value={u}>{UPSTREAM_NAMES[u] || u}</option>
            ))}
          </select>
          <div className="flex border border-neutral-800 text-[10px]">
            {(['all', 'working', 'cooldown', 'dead', 'untested'] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`px-2 py-2 uppercase ${filter === f ? 'bg-neutral-100 text-neutral-950 font-bold' : 'text-neutral-400 hover:text-white'}`}
              >
                {f === 'cooldown' ? '429' : f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Key rows */}
      {total === 0 ? (
        <div className="p-8 text-center border border-dashed border-neutral-800 space-y-2">
          <AlertTriangle className="w-8 h-8 text-neutral-600 mx-auto" />
          <p className="text-xs uppercase text-neutral-400">Koi key nahi hai — pehle KEYS button se keys dalo</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-6 text-center border border-neutral-800 text-xs text-neutral-500">
          Is filter me koi key nahi — filter badlo.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(({ entry, index, up, status, health }) => {
            const meta = STATUS_META[status];
            const cooling = status === 'cooldown' ? cooldownLeftMs(entry.k) : 0;
            const busy = testing[index];
            return (
              <div key={`${index}-${entry.k.slice(0, 12)}`} className="border border-neutral-800 bg-neutral-950 p-3 space-y-2">
                <div className="flex flex-col lg:flex-row lg:items-center gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-[11px] text-neutral-500 font-bold flex-shrink-0">#{index + 1}</span>
                    <span className="text-[10px] px-1.5 py-0.5 bg-neutral-900 border border-neutral-700 text-neutral-200 font-bold flex-shrink-0">
                      {UPSTREAM_NAMES[up] || up}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 border font-bold flex items-center gap-1 flex-shrink-0 ${meta.cls}`}>
                      {meta.icon}
                      <span>{meta.label}</span>
                      {status === 'cooldown' && cooling > 0 && <span>• {fmtCountdown(cooling)}</span>}
                    </span>
                    <code className="text-[11px] text-neutral-300 truncate min-w-0">
                      {showMap[index] ? entry.k : maskKey(entry.k)}
                    </code>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button type="button" onClick={() => setShowMap((s) => ({ ...s, [index]: !s[index] }))} title="Show/hide" className="p-1.5 text-neutral-400 hover:text-white border border-neutral-800">
                      {showMap[index] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => testOne(index)}
                      disabled={busy || testingAll}
                      title="Live test this key"
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-neutral-100 hover:bg-white disabled:opacity-50 text-neutral-950 text-[11px] font-bold uppercase"
                    >
                      {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                      <span>{busy ? 'TESTING' : 'TEST'}</span>
                    </button>
                    {(status === 'dead' || status === 'cooldown') && (
                      <button type="button" onClick={() => handleRevive(index)} title="Revive (wapas rotation me)" className="p-1.5 text-emerald-400 hover:text-emerald-300 border border-emerald-800">
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button type="button" onClick={() => handleDelete(index)} title="Delete key" className="p-1.5 text-neutral-400 hover:text-rose-300 border border-neutral-800">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-neutral-500">
                  {entry.g && <span className="text-sky-300">{entry.g}</span>}
                  <span>last test: {health ? timeAgo(health.lastTested) : 'kabhi nahi'}</span>
                  {health && health.lastLatencyMs > 0 && <span>latency: <strong className="text-neutral-300">{health.lastLatencyMs}ms</strong></span>}
                  {health && (health.success > 0 || health.fail429 > 0 || health.failAuth > 0 || health.failOther > 0) && (
                    <span>
                      ok:<strong className="text-emerald-400">{health.success}</strong>
                      {' '}429:<strong className="text-amber-400">{health.fail429}</strong>
                      {' '}auth-fail:<strong className="text-rose-400">{health.failAuth}</strong>
                      {health.failOther > 0 && <> other:<strong className="text-neutral-300">{health.failOther}</strong></>}
                    </span>
                  )}
                  {health?.lastError && status !== 'working' && (
                    <span className="text-neutral-400 break-all">err: {health.lastError}</span>
                  )}
                  {entry.u && <span className="text-violet-300">tag: {UPSTREAM_NAMES[entry.u] || entry.u}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* How rotation works */}
      <div className="p-3 sm:p-4 bg-neutral-900/60 border border-neutral-800 text-[11px] font-sans text-neutral-400 leading-relaxed">
        <strong className="text-white font-mono text-xs">SMART ROTATION KAISE KAAM KARTA HAI:</strong>
        <span> Har request pe gateway healthy keys ko priority deta hai — affinity match (model→provider) pehle, phir untagged, phir baaki. 429 wali key turant 60s cooldown pe jaati hai aur skip hoti hai; 401/403 wali sirf tab DEAD hoti hai jab uske apne provider pe fail ho (galat-provider mismatch pe nahi). Least-recently-used order se load sab keys pe bat-ta hai. Jitni zyada keys, utna kam rate-limit — bas KEYS me daalte jao.</span>
      </div>
    </div>
  );
};
