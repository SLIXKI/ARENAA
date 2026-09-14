import React, { useState, useEffect } from 'react';
import { 
  Flame, 
  RotateCcw, 
  Zap, 
  TrendingUp, 
  AlertTriangle, 
  CheckCircle2, 
  ArrowRight, 
  Plus, 
  Clock, 
  ShieldCheck,
  Cpu
} from 'lucide-react';
import { Provider, ProviderDailyUsage } from '../types/router';

interface DailyQuotaTrackerProps {
  providers: Provider[];
  activeProvider: Provider;
  onSelectProvider: (providerId: string) => void;
  dailyUsages: Record<string, ProviderDailyUsage>;
  onUpdateUsage: (providerId: string, deltaRequests: number, deltaTokens: number) => void;
  onResetUsage: (providerId?: string) => void;
  fallbackChain: string[];
}

export const DailyQuotaTracker: React.FC<DailyQuotaTrackerProps> = ({
  providers,
  activeProvider,
  onSelectProvider,
  dailyUsages,
  onUpdateUsage,
  onResetUsage,
  fallbackChain,
}) => {
  const [filter, setFilter] = useState<'all' | 'active'>('all');
  const [timeUntilReset, setTimeUntilReset] = useState('');

  // Calculate UTC reset timer
  useEffect(() => {
    const updateCountdown = () => {
      const now = new Date();
      const nextReset = new Date();
      nextReset.setUTCHours(24, 0, 0, 0); // 00:00 UTC
      const diffMs = nextReset.getTime() - now.getTime();
      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
      setTimeUntilReset(`${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, []);

  const displayedProviders = filter === 'active' 
    ? providers.filter((p) => p.id === activeProvider.id)
    : providers;

  // Aggregate totals
  const usageEntries = Object.values(dailyUsages || {}) as Array<{
    requestsUsed?: number;
    requestsLimit?: number;
    tokensUsed?: number;
    tokensLimit?: number;
  }>;
  const totalTokensUsed: number = usageEntries.reduce((acc: number, u) => acc + (Number(u?.tokensUsed) || 0), 0);
  const totalTokensCapacity: number = usageEntries.reduce((acc: number, u) => acc + (Number(u?.tokensLimit) || 0), 0);
  const totalRequestsUsed: number = usageEntries.reduce((acc: number, u) => acc + (Number(u?.requestsUsed) || 0), 0);
  const totalRequestsCapacity: number = usageEntries.reduce((acc: number, u) => acc + (Number(u?.requestsLimit) || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="bg-neutral-900/80 border border-neutral-800 p-4 sm:p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-neutral-800/80 pb-4">
          <div className="min-w-0 space-y-1.5">
            <p className="ui-eyebrow flex items-center gap-2 text-amber-300">
              <Flame className="h-3.5 w-3.5 animate-pulse" aria-hidden /> Daily quota
            </p>
            <h2 className="ui-h2 text-white">Token burn &amp; free-tier limits</h2>
            <p className="text-[13px] leading-relaxed text-neutral-400">
              Burn-down meters against each provider's daily limit. At 90% the watchdog cascades traffic to the next
              provider in your fallback chain. Counters reset at UTC midnight.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-950 border border-neutral-800 font-mono text-xs text-neutral-300">
              <Clock className="w-3.5 h-3.5 text-neutral-400" />
              <span className="text-neutral-500 uppercase">RESETS AT 00:00 UTC:</span>
              <span className="text-emerald-400 font-semibold">{timeUntilReset}</span>
            </div>

            <button
              onClick={() => onResetUsage()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-750 text-neutral-200 hover:text-white border border-neutral-700 font-mono text-xs uppercase transition-colors"
              title="Reset all daily usage counters to baseline"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset Counters</span>
            </button>
          </div>
        </div>

        {/* Global Stats Ribbon */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-xs">
          <div className="p-3 bg-neutral-950/60 border border-neutral-850">
            <div className="text-neutral-500 text-[10px] uppercase">Combined Free Capacity</div>
            <div className="text-sm sm:text-base font-bold text-white mt-0.5">
              {(totalTokensCapacity / 1000000).toFixed(1)}M+ Tokens
            </div>
            <div className="text-[10px] text-neutral-400 mt-1">Across all high-limit APIs</div>
          </div>

          <div className="p-3 bg-neutral-950/60 border border-neutral-850">
            <div className="text-neutral-500 text-[10px] uppercase">Total Burn Today</div>
            <div className="text-sm sm:text-base font-bold text-emerald-400 mt-0.5">
              {(totalTokensUsed / 1000000).toFixed(2)}M Tokens
            </div>
            <div className="text-[10px] text-neutral-400 mt-1">
              {Math.round((totalTokensUsed / (totalTokensCapacity || 1)) * 100)}% consumed
            </div>
          </div>

          <div className="p-3 bg-neutral-950/60 border border-neutral-850">
            <div className="text-neutral-500 text-[10px] uppercase">Daily Requests Routed</div>
            <div className="text-sm sm:text-base font-bold text-white mt-0.5">
              {totalRequestsUsed.toLocaleString()} / {totalRequestsCapacity.toLocaleString()}
            </div>
            <div className="text-[10px] text-neutral-400 mt-1">RPD capacity remaining</div>
          </div>

          <div className="p-3 bg-neutral-950/60 border border-neutral-850">
            <div className="text-neutral-500 text-[10px] uppercase">Cost Incurred</div>
            <div className="text-sm sm:text-base font-bold text-emerald-400 mt-0.5">
              $0.00 (100% FREE)
            </div>
            <div className="text-[10px] text-neutral-400 mt-1">Zero billing tier applied</div>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center justify-between gap-2 pt-1 font-mono text-xs">
          <div className="flex items-center gap-1.5 bg-neutral-950 p-1 border border-neutral-800">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1 transition-colors ${
                filter === 'all'
                  ? 'bg-neutral-800 text-white font-bold'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              All Providers ({providers.length})
            </button>
            <button
              onClick={() => setFilter('active')}
              className={`px-3 py-1 transition-colors ${
                filter === 'active'
                  ? 'bg-neutral-800 text-white font-bold'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              Active: {activeProvider.name}
            </button>
          </div>

          <div className="text-[11px] text-neutral-400 hidden sm:block">
            Tip: Click "+500 reqs" to simulate quota spike &amp; trigger auto-cascade
          </div>
        </div>
      </div>

      {/* Grid of Provider Quota Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {displayedProviders.map((p) => {
          const usage = dailyUsages[p.id] || {
            providerId: p.id,
            requestsUsed: 120,
            requestsLimit: 1500,
            tokensUsed: 85000,
            tokensLimit: 1000000,
            primaryUnit: 'requests' as const,
            lastUpdated: Date.now(),
          };

          const isTokenBased = usage.primaryUnit === 'tokens';
          const used = isTokenBased ? usage.tokensUsed : usage.requestsUsed;
          const limit = isTokenBased ? usage.tokensLimit : usage.requestsLimit;
          const percent = Math.min(100, Math.round((used / (limit || 1)) * 100));

          // Determine next fallback provider in chain
          const currentIdx = fallbackChain.indexOf(p.id);
          const nextFallbackId = currentIdx !== -1 && currentIdx < fallbackChain.length - 1
            ? fallbackChain[currentIdx + 1]
            : fallbackChain[0] !== p.id ? fallbackChain[0] : null;
          const nextFallbackProvider = providers.find((pr) => pr.id === nextFallbackId);

          let statusColor = 'text-emerald-400 border-emerald-850 bg-emerald-950/40';
          let barColor = 'bg-emerald-500';
          let statusLabel = 'HEALTHY';

          if (percent >= 90) {
            statusColor = 'text-rose-400 border-rose-850 bg-rose-950/40';
            barColor = 'bg-rose-500';
            statusLabel = 'EXHAUSTED / CASCADING';
          } else if (percent >= 70) {
            statusColor = 'text-amber-400 border-amber-850 bg-amber-950/40';
            barColor = 'bg-amber-500';
            statusLabel = 'HIGH USAGE';
          }

          const isSelected = p.id === activeProvider.id;

          return (
            <div
              key={p.id}
              className={`bg-neutral-900/70 border transition-all duration-150 p-4 sm:p-5 flex flex-col justify-between space-y-4 font-mono ${
                isSelected ? 'border-neutral-500 shadow-lg ring-1 ring-neutral-700' : 'border-neutral-800/90 hover:border-neutral-700'
              }`}
            >
              <div className="space-y-3">
                {/* Top header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm sm:text-base font-bold text-white truncate">{p.name}</span>
                      {isSelected && (
                        <span className="text-[10px] px-1.5 py-0.2 bg-white text-neutral-950 font-bold uppercase tracking-wider">
                          ACTIVE
                        </span>
                      )}
                      <span className={`text-[10px] px-1.5 py-0.2 border uppercase ${statusColor}`}>
                        {statusLabel}
                      </span>
                    </div>
                    <div className="text-[11px] text-neutral-400 font-sans truncate">
                      {p.category} • {p.models.length} Models
                    </div>
                  </div>

                  <button
                    onClick={() => onSelectProvider(p.id)}
                    className="text-[11px] px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white border border-neutral-700 uppercase transition-colors flex-shrink-0"
                  >
                    Select
                  </button>
                </div>

                {/* Quota badge */}
                <div className="p-2 bg-neutral-950 border border-neutral-850 flex items-center justify-between text-xs">
                  <span className="text-neutral-400 uppercase text-[10px]">Free Quota Tag:</span>
                  <span className="text-emerald-400 font-medium text-[11px] truncate">
                    {p.dailyTokenQuota || 'High Limit Free Tier'}
                  </span>
                </div>

                {/* Progress Bar & Details */}
                <div className="space-y-1.5 pt-1">
                  <div className="flex justify-between items-baseline text-xs">
                    <span className="text-neutral-400 text-[11px] uppercase">
                      {isTokenBased ? 'Daily Tokens' : 'Daily Requests (RPD)'}
                    </span>
                    <div className="space-x-1">
                      <span className="text-white font-bold">
                        {isTokenBased
                          ? `${(used / 1000).toFixed(0)}k / ${(limit / 1000).toFixed(0)}k`
                          : `${used.toLocaleString()} / ${limit.toLocaleString()}`}
                      </span>
                      <span className="text-neutral-400 font-normal">({percent}%)</span>
                    </div>
                  </div>

                  {/* Visual Bar */}
                  <div className="w-full h-2.5 bg-neutral-950 border border-neutral-800 overflow-hidden">
                    <div
                      className={`h-full ${barColor} transition-all duration-300`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>

                  <div className="flex justify-between text-[10px] text-neutral-500 font-sans">
                    <span>
                      Remaining: {isTokenBased ? `${((limit - used) / 1000).toFixed(0)}k tokens` : `${Math.max(0, limit - used)} reqs`}
                    </span>
                    <span>Resets at 00:00 UTC</span>
                  </div>
                </div>

                {/* Secondary metric */}
                <div className="grid grid-cols-2 gap-2 text-[11px] pt-1 border-t border-neutral-850">
                  <div className="text-neutral-400">
                    <span className="text-neutral-500 block text-[9px] uppercase">Requests Today</span>
                    <span className="text-neutral-200">{usage.requestsUsed.toLocaleString()}</span>
                  </div>
                  <div className="text-neutral-400 text-right">
                    <span className="text-neutral-500 block text-[9px] uppercase">Tokens Burned</span>
                    <span className="text-neutral-200">{(usage.tokensUsed / 1000).toFixed(0)}k</span>
                  </div>
                </div>
              </div>

              {/* Bottom Actions & Auto-Cascade Target */}
              <div className="pt-2 border-t border-neutral-850 space-y-2">
                {nextFallbackProvider && (
                  <div className="flex items-center justify-between text-[10px] text-neutral-400 bg-neutral-950/70 px-2 py-1 border border-neutral-850">
                    <span className="uppercase text-neutral-500">Auto-Cascade target:</span>
                    <div className="flex items-center gap-1 text-neutral-300 font-medium">
                      <span>{nextFallbackProvider.name}</span>
                      <ArrowRight className="w-3 h-3 text-emerald-400" />
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => onUpdateUsage(p.id, 100, 45000)}
                    className="flex-1 py-1 px-2 bg-neutral-800 hover:bg-neutral-750 text-neutral-300 hover:text-white border border-neutral-700 text-[10px] uppercase transition-colors"
                  >
                    +100 Reqs
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateUsage(p.id, 500, 250000)}
                    className="flex-1 py-1 px-2 bg-neutral-800 hover:bg-neutral-750 text-neutral-300 hover:text-white border border-neutral-700 text-[10px] uppercase transition-colors"
                  >
                    +500 Reqs
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateUsage(p.id, limit, limit)}
                    className="py-1 px-2 bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-800/80 text-[10px] uppercase transition-colors"
                    title="Simulate 100% quota hit to test auto-cascade"
                  >
                    Exhaust 429
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
