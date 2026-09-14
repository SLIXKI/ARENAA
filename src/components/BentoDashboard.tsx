import React from 'react';
import { 
  Globe2, 
  ShieldCheck, 
  Zap, 
  Layers, 
  ArrowUpRight, 
  Server, 
  CheckCircle2, 
  AlertTriangle, 
  Radio, 
  Sliders, 
  Edit3, 
  Trash2, 
  Plus, 
  RefreshCw,
  Power,
  Copy,
  ChevronRight,
  Flame,
  ArrowRight,
  Cpu
} from 'lucide-react';
import { PageHeader } from './PageHeader';
import { LiveStatusStrip } from './LiveStatusStrip';
import { Endpoint, Provider, RoutingPolicy, RoutingDecision, WatchdogEvent } from '../types/router';

interface BentoDashboardProps {
  activeProvider: Provider;
  providers?: Provider[];
  fallbackChain?: string[];
  endpoints: Endpoint[];
  routingPolicy: RoutingPolicy;
  onSelectPolicy: (policy: RoutingPolicy) => void;
  onToggleEndpoint: (id: string) => void;
  onEditEndpoint: (endpoint: Endpoint) => void;
  onDeleteEndpoint: (id: string) => void;
  onOpenAddEndpoint: () => void;
  recentDecisions: RoutingDecision[];
  onOpenTester: () => void;
  onOpenQuota?: () => void;
  isWatchdogActive?: boolean;
  onToggleWatchdog?: () => void;
  watchdogLogs?: WatchdogEvent[];
  onTriggerWatchdogAudit?: () => void;
}

export const BentoDashboard: React.FC<BentoDashboardProps> = ({
  activeProvider,
  providers = [],
  fallbackChain = [],
  endpoints,
  routingPolicy,
  onSelectPolicy,
  onToggleEndpoint,
  onEditEndpoint,
  onDeleteEndpoint,
  onOpenAddEndpoint,
  recentDecisions,
  onOpenTester,
  onOpenQuota,
  isWatchdogActive = true,
  onToggleWatchdog,
  watchdogLogs = [],
  onTriggerWatchdogAudit,
}) => {
  const providerEndpoints = endpoints.filter((ep) => ep.providerId === activeProvider.id);
  const activeEndpoints = providerEndpoints.filter((ep) => ep.enabled);
  const tier1Count = providerEndpoints.filter((ep) => ep.priorityTier === 1 && ep.enabled).length;
  const tier2Count = providerEndpoints.filter((ep) => ep.priorityTier >= 2 && ep.enabled).length;

  const avgLatency =
    activeEndpoints.length > 0
      ? Math.round(
          activeEndpoints.reduce((acc, ep) => acc + ep.latencyMs, 0) / activeEndpoints.length
        )
      : 0;

  const fastestNode = [...activeEndpoints].sort((a, b) => a.latencyMs - b.latencyMs)[0];

  const policyDescriptions: Record<RoutingPolicy, { title: string; desc: string; badge: string }> = {
    'weighted-round-robin': {
      title: 'Weighted Round-Robin',
      desc: 'Traffic distributed proportionally based on endpoint weight assignments.',
      badge: 'PROPORTIONAL LOAD BALANCING',
    },
    'lowest-latency': {
      title: 'Lowest Latency (Geo)',
      desc: 'Requests route dynamically to the endpoint with the fastest real-time edge response.',
      badge: 'SPEED OPTIMIZED',
    },
    'regional-geo': {
      title: 'Regional Proximity',
      desc: 'Directs traffic to the geographically nearest serverless edge cluster.',
      badge: 'LOCAL PROXIMITY',
    },
    'failover-cascade': {
      title: 'Failover Cascade (Zero-Downtime)',
      desc: 'Prioritizes Tier 1 nodes. Cascades immediately to Tier 2 on rate-limit or 5xx.',
      badge: 'HIGH REDUNDANCY',
    },
    'cost-optimized': {
      title: 'Cost & Quota Preserving',
      desc: 'Directs calls to endpoints with higher remaining rate limits and tier discounts.',
      badge: 'QUOTA PRESERVATION',
    },
  };

  return (
    <div className="space-y-6 sm:space-y-8 pb-16">
      <PageHeader
        eyebrow={
          <>
            <span>{activeProvider.name}</span>
            <span aria-hidden className="text-neutral-700">/</span>
            <span>{endpoints.length} endpoint{endpoints.length === 1 ? '' : 's'}</span>
            <span aria-hidden className="text-neutral-700">/</span>
            <span>{routingPolicy.replace(/-/g, ' ')}</span>
            {activeProvider.dailyTokenQuota && (
              <span className="ui-badge ui-badge-success ml-1">⚡ {activeProvider.dailyTokenQuota}</span>
            )}
          </>
        }
        title="Routing control"
        description="Every request goes to one gateway URL. The model name picks the provider, the key prefix picks the account, and a failure rotates to the next key mid-request."
        actions={
          <>
            {onOpenQuota && (
              <button type="button" onClick={onOpenQuota} className="ui-btn ui-btn-ghost">
                <Flame className="h-4 w-4 text-amber-400" /> Token quota
              </button>
            )}
            <button type="button" id="quick-test-btn" onClick={onOpenTester} className="ui-btn ui-btn-primary">
              <Zap className="h-4 w-4" /> Send a test request
            </button>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="ui-eyebrow">Models</span>
          <span className="ui-badge">{activeProvider.models.length}</span>
          {activeProvider.models.slice(0, 4).map((m) => (
            <span key={m} className="ui-badge font-mono normal-case tracking-normal">{m}</span>
          ))}
          {activeProvider.models.length > 4 && (
            <span className="ui-badge text-neutral-500">+{activeProvider.models.length - 4} more</span>
          )}
        </div>
      </PageHeader>

      {/* Measured gateway telemetry — real round-trips, never simulated. */}
      <LiveStatusStrip />

      {/* Cross-Provider Auto-Fallback Mesh Banner */}
      <div className="p-3 sm:p-3.5 bg-neutral-900/60 border border-neutral-800 flex flex-col md:flex-row md:items-center justify-between gap-3 font-mono text-xs w-full max-w-full min-w-0 overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 min-w-0 w-full md:w-auto">
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Zap className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span className="text-neutral-400 uppercase text-[10px] sm:text-[11px] whitespace-nowrap">
              FAILOVER SEQUENCE:
            </span>
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto py-1 max-w-full text-neutral-200">
            {(fallbackChain && fallbackChain.length > 0 ? fallbackChain : [activeProvider.id]).map((pid, idx) => {
              const p = (providers || []).find((x) => x.id === pid);
              const label = p ? p.name : pid;
              const isActive = pid === activeProvider.id && idx === 0;
              return (
                <span key={`${pid}-${idx}`} className="flex items-center gap-1.5 flex-shrink-0">
                  {idx > 0 && <ArrowRight className="w-3 h-3 text-neutral-600 flex-shrink-0" />}
                  <span className={`${isActive ? 'bg-white text-neutral-950 font-bold' : 'bg-neutral-950 border border-neutral-800 text-neutral-300'} px-1.5 py-0.5 text-[10px] flex-shrink-0`}>
                    {idx + 1}. {label}{isActive ? ' (ACTIVE)' : ''}
                  </span>
                </span>
              );
            })}
          </div>
        </div>

        {onOpenQuota && (
          <button
            onClick={onOpenQuota}
            className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 font-mono uppercase underline-offset-4 hover:underline flex-shrink-0 self-start md:self-auto"
          >
            <span>Manage Auto-Cascade Limits</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Autonomous Self-Driving Watchdog Control & Live Event Ticker */}
      <div className="bg-neutral-900/80 border border-neutral-800 p-4 sm:p-5 space-y-4 relative overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-neutral-800/80 pb-4">
          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`w-2 h-2 rounded-full ${isWatchdogActive ? 'bg-emerald-400 animate-pulse' : 'bg-neutral-500'}`} />
              <h2 className="text-xs sm:text-sm font-mono font-bold uppercase tracking-wider text-white flex items-center gap-2 truncate">
                <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                AUTONOMOUS SELF-DRIVING WATCHDOG
              </h2>
              <span className={`text-[9px] font-mono px-1.5 py-0.5 border ${
                isWatchdogActive
                  ? 'border-emerald-700 bg-emerald-950/70 text-emerald-300'
                  : 'border-neutral-700 bg-neutral-950 text-neutral-400'
              }`}>
                {isWatchdogActive ? 'CONTINUOUS MONITORING [ACTIVE]' : 'STANDBY'}
              </span>
            </div>
            <p className="text-[11px] text-neutral-400 font-sans max-w-2xl leading-relaxed">
              Proactively surveys active endpoints, prevents 429 quota exhaustion by auto-cascading at 85% capacity, and auto-demotes high-latency nodes without human intervention.
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-shrink-0">
            {onTriggerWatchdogAudit && (
              <button
                type="button"
                onClick={onTriggerWatchdogAudit}
                className="flex items-center gap-1.5 px-3 py-2 bg-neutral-950 hover:bg-neutral-800 text-neutral-200 border border-neutral-700 text-xs font-mono font-semibold transition-colors min-h-[38px]"
              >
                <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
                <span>TRIGGER AUDIT SWEEP</span>
              </button>
            )}

            {onToggleWatchdog && (
              <button
                type="button"
                onClick={onToggleWatchdog}
                className={`px-3 py-2 border font-mono text-xs font-bold uppercase tracking-wider transition-colors min-h-[38px] ${
                  isWatchdogActive
                    ? 'border-emerald-600 bg-emerald-950/60 text-emerald-300 hover:bg-emerald-900/70'
                    : 'border-neutral-700 bg-neutral-950 text-neutral-400 hover:text-white'
                }`}
              >
                {isWatchdogActive ? 'AUTO-HEAL: ON' : 'AUTO-HEAL: OFF'}
              </button>
            )}
          </div>
        </div>

        {/* Watchdog Specs & Live Self-Healing Stream */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono text-xs">
          <div className="p-3 bg-neutral-950 border border-neutral-850 space-y-1">
            <div className="text-[10px] text-neutral-500 uppercase flex items-center justify-between">
              <span>PROACTIVE QUOTA GUARD</span>
              <span className="text-emerald-400">85% TRIGGER</span>
            </div>
            <div className="text-white font-bold text-xs truncate">
              Auto-Cascades to Next Provider
            </div>
            <p className="text-[10px] font-sans text-neutral-400">
              Switches primary route before 429 rate limit exceptions occur.
            </p>
          </div>

          <div className="p-3 bg-neutral-950 border border-neutral-850 space-y-1">
            <div className="text-[10px] text-neutral-500 uppercase flex items-center justify-between">
              <span>LATENCY SELF-STABILIZER</span>
              <span className="text-emerald-400">&lt; 500ms SLA</span>
            </div>
            <div className="text-white font-bold text-xs truncate">
              Dynamic Tier Demotion
            </div>
            <p className="text-[10px] font-sans text-neutral-400">
              Degraded or flapping nodes automatically moved to secondary tier.
            </p>
          </div>

          <div className="p-3 bg-neutral-950 border border-neutral-850 space-y-1">
            <div className="text-[10px] text-neutral-500 uppercase flex items-center justify-between">
              <span>LATEST AUTONOMOUS EVENT</span>
              <span className="text-neutral-400">{watchdogLogs.length} logged</span>
            </div>
            {watchdogLogs.length > 0 ? (
              <>
                <div className="text-emerald-300 font-bold text-xs truncate">
                  {watchdogLogs[0].title}
                </div>
                <p className="text-[10px] font-sans text-neutral-300 truncate">
                  {watchdogLogs[0].actionTaken}
                </p>
              </>
            ) : (
              <div className="text-neutral-400 text-xs">
                All edge nodes nominal. Zero interventions required.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Asymmetric Bento-Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Bento Tile 1: Regional Nodes List (Span 8 Cols) */}
        <div className="lg:col-span-8 space-y-4">
          <div className="bg-neutral-900/60 border border-neutral-800 p-4 sm:p-6 relative overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 border-b border-neutral-800 pb-4 mb-5">
              <div>
                <div className="flex items-center gap-2">
                  <Globe2 className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                  <h2 className="text-sm sm:text-base font-bold font-mono tracking-wide text-white uppercase truncate">
                    Configured Regional Endpoints ({providerEndpoints.length})
                  </h2>
                </div>
                <p className="text-xs text-neutral-500 font-mono mt-0.5">
                  Multi-region redundancy pool for {activeProvider.name}
                </p>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  id="add-node-bento-btn"
                  onClick={onOpenAddEndpoint}
                  className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-3 py-2 bg-neutral-800 hover:bg-neutral-750 text-neutral-200 hover:text-white border border-neutral-700 text-xs font-mono uppercase tracking-wider transition-all duration-200 min-h-[38px]"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>ADD REGION NODE</span>
                </button>
              </div>
            </div>

            {/* Endpoints List */}
            {providerEndpoints.length === 0 ? (
              <div className="py-12 text-center border border-dashed border-neutral-800 p-6 sm:p-8 space-y-3">
                <Server className="w-8 h-8 text-neutral-600 mx-auto" />
                <p className="font-mono text-sm text-neutral-400 uppercase">
                  No regional endpoints configured for this provider yet
                </p>
                <p className="text-xs text-neutral-600 max-w-sm mx-auto">
                  Add multiple regional nodes (US-East, US-West, EU-Central, etc.) to enable automated load balancing and zero-downtime failover.
                </p>
                <button
                  onClick={onOpenAddEndpoint}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-neutral-100 text-neutral-950 font-mono text-xs font-semibold uppercase min-h-[44px]"
                >
                  <Plus className="w-4 h-4" /> Add First Endpoint
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {providerEndpoints.map((ep) => {
                  const isHealthy = ep.status === 'healthy';
                  const isRateLimited = ep.status === 'rate-limited';

                  return (
                    <div
                      key={ep.id}
                      className={`border transition-all duration-250 p-3.5 sm:p-4 overflow-hidden ${
                        ep.enabled
                          ? 'border-neutral-800 hover:border-neutral-700 bg-neutral-950/70'
                          : 'border-neutral-900 bg-neutral-950/30 opacity-60'
                      }`}
                    >
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        {/* Left column: Name & Region */}
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                !ep.enabled
                                  ? 'bg-neutral-600'
                                  : isHealthy
                                  ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]'
                                  : isRateLimited
                                  ? 'bg-amber-400'
                                  : 'bg-red-400'
                              }`}
                            />
                            <span className="font-mono font-semibold text-sm text-white tracking-tight truncate">
                              {ep.name}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 text-xs font-mono text-neutral-400 flex-wrap">
                            <span className="bg-neutral-900 px-1.5 py-0.5 border border-neutral-800 text-[11px] text-neutral-300 flex-shrink-0">
                              {ep.region}
                            </span>
                            <span className="text-neutral-500">•</span>
                            <span className="text-[11px] truncate">{ep.regionLabel}</span>
                          </div>
                        </div>

                        {/* Mid column: Latency & Weight & Tier (Grid on mobile, flex on sm) */}
                        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-3 sm:gap-4 text-xs font-mono w-full md:w-auto">
                          {/* Priority Tier */}
                          <div className="flex flex-col min-w-0">
                            <span className="text-[10px] text-neutral-500 uppercase">TIER</span>
                            <span
                              className={`px-2 py-0.5 text-[10px] sm:text-[11px] font-semibold border truncate ${
                                ep.priorityTier === 1
                                  ? 'border-neutral-600 bg-neutral-800 text-neutral-100'
                                  : 'border-neutral-800 bg-neutral-900 text-neutral-400'
                              }`}
                            >
                              {ep.priorityTier === 1 ? 'TIER 1 (PRIMARY)' : `TIER ${ep.priorityTier} (FAILOVER)`}
                            </span>
                          </div>

                          {/* Latency */}
                          <div className="flex flex-col min-w-0">
                            <span className="text-[10px] text-neutral-500 uppercase">LATENCY</span>
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`text-sm font-bold ${
                                  ep.latencyMs < 40
                                    ? 'text-emerald-400'
                                    : ep.latencyMs < 90
                                    ? 'text-neutral-200'
                                    : 'text-amber-400'
                                }`}
                              >
                                {ep.latencyMs}ms
                              </span>
                              <div className="w-10 sm:w-12 h-1.5 bg-neutral-800 overflow-hidden flex-shrink-0">
                                <div
                                  className="h-full bg-neutral-300 transition-all duration-300"
                                  style={{
                                    width: `${Math.min(100, Math.max(10, (ep.latencyMs / 180) * 100))}%`,
                                  }}
                                />
                              </div>
                            </div>
                          </div>

                          {/* Weight */}
                          <div className="flex flex-col min-w-0">
                            <span className="text-[10px] text-neutral-500 uppercase">WEIGHT</span>
                            <span className="text-xs font-bold text-neutral-300">{ep.weight}%</span>
                          </div>

                          {/* Quota / Status */}
                          <div className="flex flex-col min-w-0">
                            <span className="text-[10px] text-neutral-500 uppercase truncate">REMAINING RPM</span>
                            <span className="text-xs text-neutral-400 truncate">
                              {ep.rateLimitRemaining.toLocaleString()} / {ep.rateLimitRpm.toLocaleString()}
                            </span>
                          </div>
                        </div>

                        {/* Right column: Action Controls */}
                        <div className="flex items-center gap-2 border-t md:border-t-0 border-neutral-800/80 pt-3 md:pt-0 justify-end md:justify-start w-full md:w-auto">
                          {/* Toggle Enabled */}
                          <button
                            onClick={() => onToggleEndpoint(ep.id)}
                            title={ep.enabled ? 'Disable Node' : 'Enable Node'}
                            className={`p-2 min-h-[36px] min-w-[36px] flex items-center justify-center border font-mono text-xs transition-colors duration-200 ${
                              ep.enabled
                                ? 'border-neutral-700 bg-neutral-800 text-neutral-200 hover:bg-neutral-700'
                                : 'border-neutral-900 bg-neutral-950 text-neutral-600 hover:text-neutral-400'
                            }`}
                          >
                            <Power className="w-3.5 h-3.5" />
                          </button>

                          {/* Edit */}
                          <button
                            onClick={() => onEditEndpoint(ep)}
                            title="Edit Node Settings"
                            className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center border border-neutral-800 hover:border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 transition-colors duration-200"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>

                          {/* Delete */}
                          <button
                            onClick={() => onDeleteEndpoint(ep.id)}
                            title="Remove Node"
                            className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center border border-neutral-800 hover:border-red-900/60 bg-neutral-900 hover:bg-red-950/30 text-neutral-500 hover:text-red-400 transition-colors duration-200"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Sub-bar: Base URL & Masked Key */}
                      <div className="mt-3 pt-2.5 border-t border-neutral-900 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] font-mono text-neutral-500">
                        <div className="flex items-center gap-1.5 min-w-0 max-w-full overflow-hidden">
                          <span className="text-neutral-600 flex-shrink-0">ENDPOINT:</span>
                          <code className="text-neutral-400 truncate break-all block min-w-0">{ep.baseUrl}</code>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                          <span className="text-neutral-600">KEY:</span>
                          <span className="text-neutral-400">
                            {ep.apiKey.slice(0, 7)}••••••••{ep.apiKey.slice(-4)}
                          </span>
                          <span className="text-neutral-600">|</span>
                          <span className="text-neutral-500">{ep.uptimePercentage}% Uptime</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Bento Tile 3: Routing Policy Selector & Architecture (Span 8 Cols) */}
          <div className="bg-neutral-900/60 border border-neutral-800 p-4 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-800 pb-3">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                <h3 className="text-xs sm:text-sm font-bold font-mono tracking-wide text-white uppercase">
                  Routing Policy Configuration
                </h3>
              </div>
              <span className="font-mono text-[10px] sm:text-[11px] text-neutral-400 border border-neutral-800 px-2 py-0.5 bg-neutral-950 w-fit">
                ACTIVE: {routingPolicy.toUpperCase()}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 pt-2">
              {(
                [
                  'weighted-round-robin',
                  'lowest-latency',
                  'regional-geo',
                  'failover-cascade',
                  'cost-optimized',
                ] as RoutingPolicy[]
              ).map((pol) => {
                const isSelected = routingPolicy === pol;
                const info = policyDescriptions[pol];

                return (
                  <button
                    key={pol}
                    onClick={() => onSelectPolicy(pol)}
                    className={`text-left p-3.5 border transition-all duration-200 flex flex-col justify-between min-h-[110px] ${
                      isSelected
                        ? 'border-neutral-200 bg-neutral-950 text-white shadow-md'
                        : 'border-neutral-800 hover:border-neutral-700 bg-neutral-950/40 text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1 gap-2">
                        <span className="text-xs font-mono font-bold tracking-tight uppercase text-white truncate">
                          {info.title}
                        </span>
                        {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-white flex-shrink-0" />}
                      </div>
                      <p className="text-[11px] font-sans text-neutral-400 line-clamp-2 leading-relaxed">
                        {info.desc}
                      </p>
                    </div>
                    <div className="mt-3 pt-2 border-t border-neutral-900 text-[10px] font-mono text-neutral-500 uppercase truncate">
                      {info.badge}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Bento Tile 2: Edge Telemetry Metrics (Span 4 Cols) */}
        <div className="lg:col-span-4 space-y-6 min-w-0 max-w-full">
          {/* Serverless Performance Overview */}
          <div className="bg-neutral-900/60 border border-neutral-800 p-4 sm:p-6 space-y-6">
            <div className="border-b border-neutral-800 pb-3">
              <span className="text-[10px] font-mono tracking-widest text-neutral-500 uppercase">
                PERFORMANCE ARCHITECTURE
              </span>
              <h3 className="text-sm sm:text-base font-bold font-mono text-white tracking-wide uppercase mt-1">
                ZERO SERVER OVERHEAD
              </h3>
            </div>

            <div className="space-y-4 font-mono">
              <div className="p-3.5 bg-neutral-950 border border-neutral-800 space-y-1">
                <span className="text-[10px] text-neutral-500 uppercase">EDGE INGRESS OVERHEAD</span>
                <div className="flex items-baseline justify-between flex-wrap gap-1">
                  <span className="text-2xl font-black text-white font-mono">0.00 ms</span>
                  <span className="text-[10px] text-emerald-400 font-mono">SUB-MS RESOLUTION</span>
                </div>
                <p className="text-[11px] font-sans text-neutral-400">
                  Routing rules evaluated in-flight at nearest edge worker without centralized cold-starts.
                </p>
              </div>

              <div className="p-3.5 bg-neutral-950 border border-neutral-800 space-y-1">
                <span className="text-[10px] text-neutral-500 uppercase">AVG REGIONAL LATENCY</span>
                <div className="flex items-baseline justify-between flex-wrap gap-1">
                  <span className="text-2xl font-black text-white font-mono">{avgLatency} ms</span>
                  <span className="text-[10px] text-neutral-400 font-mono truncate">
                    FASTEST: {fastestNode?.region || 'N/A'} ({fastestNode?.latencyMs || 0}ms)
                  </span>
                </div>
              </div>

              <div className="p-3.5 bg-neutral-950 border border-neutral-800 space-y-1">
                <span className="text-[10px] text-neutral-500 uppercase">REDUNDANCY GUARANTEE</span>
                <div className="flex items-baseline justify-between flex-wrap gap-1">
                  <span className="text-2xl font-black text-white font-mono">
                    {tier1Count > 0 && tier2Count > 0 ? 'N+1 RESILIENT' : 'STANDARD'}
                  </span>
                  <span className="text-[10px] text-neutral-300 font-mono">
                    {tier1Count} Prim / {tier2Count} Failover
                  </span>
                </div>
                <p className="text-[11px] font-sans text-neutral-400">
                  Automatic failover triggers instantly when 429 rate limit or 5xx outage is encountered.
                </p>
              </div>
            </div>
          </div>

          {/* Bento Tile 4: Real-time Synchronized Decisions Feed */}
          <div className="bg-neutral-900/60 border border-neutral-800 p-4 sm:p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <div className="flex items-center gap-2 min-w-0">
                <Radio className="w-4 h-4 text-emerald-400 animate-pulse flex-shrink-0" />
                <h3 className="text-xs sm:text-sm font-bold font-mono tracking-wide text-white uppercase truncate">
                  Real-time Synchronized Feed
                </h3>
              </div>
              <span className="text-[10px] font-mono text-neutral-500 flex-shrink-0">LIVE</span>
            </div>

            <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
              {recentDecisions.length === 0 ? (
                <div className="py-8 text-center text-xs font-mono text-neutral-500 border border-neutral-900 p-4">
                  No edge requests dispatched yet.
                  <br />
                  <button
                    onClick={onOpenTester}
                    className="mt-2 text-neutral-300 hover:text-white underline underline-offset-2"
                  >
                    Open Tester to simulate
                  </button>
                </div>
              ) : (
                recentDecisions.slice(0, 6).map((dec) => (
                  <div
                    key={dec.id}
                    className="p-2.5 bg-neutral-950 border border-neutral-800/80 font-mono text-xs space-y-1.5 transition-all duration-200 hover:border-neutral-750 overflow-hidden"
                  >
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-neutral-300 font-bold truncate">{dec.selectedRegion}</span>
                      <span className="text-emerald-400 flex-shrink-0">{dec.latencyMs}ms</span>
                    </div>

                    <div className="text-[11px] text-neutral-400 truncate">
                      {dec.selectedEndpointName}
                    </div>

                    {dec.failoverAttempted && (
                      <div className="text-[10px] text-amber-400 flex items-center gap-1 min-w-0">
                        <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate min-w-0 flex-1">Failover: {dec.failoverReason}</span>
                      </div>
                    )}

                    <div className="flex items-center justify-between text-[10px] text-neutral-500 pt-1 border-t border-neutral-900">
                      <span className="truncate pr-2">{dec.policyApplied}</span>
                      <span className="flex-shrink-0">{new Date(dec.timestamp).toLocaleTimeString()}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
