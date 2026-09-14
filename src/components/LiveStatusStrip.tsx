import React, { useCallback, useEffect, useState } from 'react';
import { Activity, KeyRound, Layers, Radio, RefreshCw, Timer, CheckCircle2, AlertTriangle } from 'lucide-react';
import { computeStats, probeGateway, readProbeHistory, type ProbeStats } from '../utils/probe';
import { getProviderKeys, UNIVERSAL_PROVIDER_ID, UPSTREAM_IDS } from '../utils/providerKeys';
import { loadLiveCatalog } from '../utils/catalog';

/** Re-render the "x s ago" labels without a timer running when nothing needs it. */
function useNow(intervalMs: number, enabled: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
  return now;
}

function agoLabel(ts: number, now: number): string {
  if (!ts) return 'never';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/**
 * Real gateway telemetry.
 *
 * Every number here comes from an actual measurement. The previous dashboard
 * asserted "sub-millisecond edge resolution" and "0.00 ms overhead" as static
 * labels and generated latency from `Math.random()`; this reads the rolling probe
 * history and shows what was genuinely observed — including "not measured yet"
 * when nothing has been.
 */
export const LiveStatusStrip: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [stats, setStats] = useState<ProbeStats>(() => computeStats(readProbeHistory()));
  const [busy, setBusy] = useState(false);
  const [keys, setKeys] = useState(0);
  const [models, setModels] = useState(0);
  const [catalogAge, setCatalogAge] = useState(0);

  const refreshCounts = useCallback(() => {
    try {
      setKeys(getProviderKeys(UNIVERSAL_PROVIDER_ID).length);
    } catch {
      setKeys(0);
    }
    try {
      const c = loadLiveCatalog();
      setModels(c?.models?.length || 0);
      setCatalogAge(c?.syncedAt || 0);
    } catch {
      setModels(0);
      setCatalogAge(0);
    }
  }, []);

  useEffect(() => {
    refreshCounts();
  }, [refreshCounts]);

  // Probe once on mount so the strip is never empty on a fresh load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await probeGateway();
      if (!cancelled) setStats(computeStats());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const now = useNow(5000, !!stats.lastChecked);

  const handleProbe = useCallback(async () => {
    setBusy(true);
    await probeGateway();
    setStats(computeStats());
    refreshCounts();
    setBusy(false);
  }, [refreshCounts]);

  const live = stats.measured && stats.lastOk === true;
  const down = stats.measured && stats.lastOk === false;

  const cells = [
    {
      Icon: Radio,
      label: 'Gateway',
      value: !stats.measured ? 'not probed' : live ? 'reachable' : down ? 'unreachable' : 'degraded',
      tone: !stats.measured ? 'dim' : live ? 'good' : 'bad',
      sub: `${stats.samples} real probe${stats.samples === 1 ? '' : 's'}`,
    },
    {
      Icon: Timer,
      label: 'Latency',
      value: stats.medianMs > 0 ? `${stats.medianMs} ms` : '—',
      tone: stats.medianMs > 0 ? 'good' : 'dim',
      sub: stats.p95Ms > 0 ? `p95 ${stats.p95Ms} ms` : 'median, no data yet',
    },
    {
      Icon: Activity,
      label: 'Uptime',
      value: stats.measured ? `${stats.uptimePct}%` : '—',
      tone: !stats.measured ? 'dim' : stats.uptimePct >= 95 ? 'good' : stats.uptimePct >= 70 ? 'warn' : 'bad',
      sub: stats.measured ? `${stats.ok}/${stats.samples} successful` : 'measured, not simulated',
    },
    {
      Icon: KeyRound,
      label: 'Keys',
      value: String(keys),
      tone: keys > 0 ? 'good' : 'warn',
      sub: keys > 0 ? `across ${UPSTREAM_IDS.length} providers` : 'add one to start',
    },
    {
      Icon: Layers,
      label: 'Models',
      value: models > 0 ? String(models) : '—',
      tone: models > 0 ? 'good' : 'dim',
      sub: catalogAge ? `catalog ${agoLabel(catalogAge, now)}` : 'no live catalog yet',
    },
  ];

  const toneClass = (tone: string) =>
    tone === 'good'
      ? 'text-emerald-300'
      : tone === 'warn'
        ? 'text-amber-300'
        : tone === 'bad'
          ? 'text-rose-300'
          : 'text-neutral-500';

  return (
    <section className={className} aria-label="Live gateway status">
      <div className="ui-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/8 px-3.5 py-2.5 sm:px-4">
          <div className="flex items-center gap-2">
            <span
              className={`ui-dot ${live ? 'ui-dot-live bg-emerald-400 text-emerald-400' : down ? 'bg-rose-400 text-rose-400' : 'bg-neutral-600 text-neutral-600'}`}
              aria-hidden
            />
            <span className="ui-eyebrow">Live status</span>
            <span className="hidden text-[11px] text-neutral-600 sm:inline">
              measured from real round-trips · {agoLabel(stats.lastChecked, now)}
            </span>
          </div>
          <button
            type="button"
            onClick={handleProbe}
            disabled={busy}
            className="ui-btn ui-btn-ghost ui-btn-sm"
            aria-label="Probe the gateway now"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{busy ? 'Probing…' : 'Probe now'}</span>
          </button>
        </div>

        <dl className="grid grid-cols-2 divide-x divide-y divide-white/6 sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0">
          {cells.map(({ Icon, label, value, sub, tone }) => (
            <div key={label} className="min-w-0 px-3.5 py-3 sm:px-4">
              <dt className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.09em] text-neutral-500">
                <Icon className="h-3 w-3 flex-none" aria-hidden /> {label}
              </dt>
              <dd className={`mt-1 truncate font-mono text-lg font-bold tabular-nums sm:text-xl ${toneClass(tone)}`}>
                {value}
              </dd>
              <dd className="mt-0.5 flex items-center gap-1 truncate text-[10.5px] text-neutral-600">
                {tone === 'bad' ? (
                  <AlertTriangle className="h-3 w-3 flex-none text-rose-400" aria-hidden />
                ) : tone === 'good' ? (
                  <CheckCircle2 className="h-3 w-3 flex-none text-emerald-500/70" aria-hidden />
                ) : null}
                <span className="truncate">{sub}</span>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
};
