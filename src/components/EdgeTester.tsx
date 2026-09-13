import React, { useState } from 'react';
import { 
  Terminal, 
  Send, 
  AlertTriangle, 
  CheckCircle2, 
  Zap, 
  Clock, 
  Server, 
  ShieldAlert, 
  Radio, 
  Layers, 
  CornerDownRight, 
  Copy, 
  Check,
  Cpu
} from 'lucide-react';
import { Endpoint, Provider, RoutingPolicy, RoutingDecision } from '../types/router';
import { EdgeRouterEngine, markProviderKeysExhausted } from '../services/edgeRouterEngine';
import { SmartPromptRouter, PromptAnalysis } from '../services/autonomousWatchdog';
import { SkeletonLoader } from './SkeletonLoader';
import { getActiveGeminiKey } from '../utils/auth';
import { getAllProviderKeys, getProviderKeyEntries, getProviderKeyHints, markDeadByPrefixes, reviveProviderKey, effectiveUpstream } from '../utils/providerKeys';
import { modelsWithKeyStatus, upstreamForModel, UPSTREAM_META } from '../utils/upstream';
import { loadLiveCatalog, getModelStatus, markModelOk, markModelFailed, isModelGoneError, runCatalogSync } from '../utils/catalog';
import { recordKeyOk, recordKey429, recordKeyDead } from '../utils/keyHealth';
import { listCustomEndpoints } from '../utils/customEndpoints';
import { notify } from '../utils/notify';

interface EdgeTesterProps {
  activeProvider: Provider;
  providers?: Provider[];
  fallbackChain?: string[];
  endpoints: Endpoint[];
  routingPolicy: RoutingPolicy;
  onRecordDecision: (decision: RoutingDecision, updatedEndpoints: Endpoint[]) => void;
  onUpdateUsage?: (providerId: string, requests: number, tokens: number) => void;
}

export const EdgeTester: React.FC<EdgeTesterProps> = ({
  activeProvider,
  providers = [],
  fallbackChain = [],
  endpoints,
  routingPolicy,
  onRecordDecision,
  onUpdateUsage,
}) => {
  const [prompt, setPrompt] = useState('Analyze edge router latency across multi-region clusters');
  const [selectedModel, setSelectedModel] = useState(activeProvider.models[0] || 'default-model');
  const [clientRegion, setClientRegion] = useState('india');
  const [simulateFailure, setSimulateFailure] = useState(false);
  const [simulateQuotaExhaustion, setSimulateQuotaExhaustion] = useState(false);
  const [crossProviderFallbackEnabled, setCrossProviderFallbackEnabled] = useState(true);
  const [enableRealInference, setEnableRealInference] = useState(true);
  const [promptAnalysis, setPromptAnalysis] = useState<PromptAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastResult, setLastResult] = useState<RoutingDecision | null>(null);
  const [copied, setCopied] = useState(false);
  const [testerError, setTesterError] = useState('');
  const [modelFilter, setModelFilter] = useState<'active' | 'all'>(() => {
    try {
      return localStorage.getItem('er_model_filter') === 'all' ? 'all' : 'active';
    } catch {
      return 'active';
    }
  });
  const [modelSearch, setModelSearch] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [catalogTick, setCatalogTick] = useState(0);
  const [lastSync, setLastSync] = useState<number>(() => loadLiveCatalog()?.syncedAt || 0);

  // Sync selectedModel if activeProvider changes
  React.useEffect(() => {
    if (activeProvider.models.length > 0 && !activeProvider.models.includes(selectedModel)) {
      setSelectedModel(activeProvider.models[0]);
    }
  }, [activeProvider]);

  const handleAutoPickModel = () => {
    const analysis = SmartPromptRouter.analyzePrompt(prompt, providers);
    setPromptAnalysis(analysis);
    // Find provider by slug
    const recProvider = providers.find((p) => p.slug === analysis.recommendedProviderSlug);
    if (recProvider && recProvider.models.includes(analysis.recommendedModel)) {
      setSelectedModel(analysis.recommendedModel);
    } else if (recProvider && recProvider.models.length > 0) {
      setSelectedModel(recProvider.models[0]);
    }
  };

  const providerEndpoints = endpoints.filter((ep) => ep.providerId === activeProvider.id && ep.enabled);

  const handleDispatch = async () => {
    if (providerEndpoints.length === 0 && !crossProviderFallbackEnabled) return;

    setIsLoading(true);
    setTesterError('');

    try {
      const pools = getAllProviderKeys((providers || []).map((p) => p.id));
      // 1. Resolve edge routing decision (skips keyless providers in fallback)
      const { decision, updatedEndpoints } = EdgeRouterEngine.routeRequest(
        activeProvider,
        endpoints,
        routingPolicy,
        clientRegion,
        simulateFailure,
        prompt,
        {
          enableCrossProviderFallback: crossProviderFallbackEnabled,
          allProviders: providers,
          fallbackChain,
          simulateQuotaExhaustion,
          providerKeys: pools,
        }
      );

      // 2. Real Live Inference via gateway (/api/v1/chat/completions) + provider key pool
      if (enableRealInference) {
        try {
          const t0 = Date.now();
          const pool = pools[decision.providerId] || [];
          const entries = getProviderKeyEntries(decision.providerId);
          const hints = getProviderKeyHints(decision.providerId);
          const fallbackKey = getActiveGeminiKey();
          const apiKeys = pool.length > 0 ? [...pool] : (fallbackKey ? [fallbackKey] : []);
          const keyUpstreams = pool.length > 0 ? [...hints] : (fallbackKey ? ['prov-gemini'] : []);
          const keyBases: string[] = apiKeys.map(() => '');
          const keyModels: string[] = apiKeys.map(() => '');
          // Custom endpoints ride along: own base + model affinity (gateway routes them first on match).
          try {
            listCustomEndpoints().filter((c) => c.enabled && c.key && c.baseUrl && c.model).forEach((c) => {
              if (apiKeys.includes(c.key.trim())) return;
              apiKeys.push(c.key.trim());
              keyUpstreams.push(c.tag || 'unknown');
              keyBases.push(c.baseUrl);
              keyModels.push(c.model);
            });
          } catch { /* ignore */ }
          const res = await fetch('/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(apiKeys[0] ? { 'Authorization': `Bearer ${apiKeys[0]}` } : {}),
            },
            body: JSON.stringify({
              providerId: decision.providerId,
              apiKeys,
              keyUpstreams,
              keyBases,
              keyModels,
              model: selectedModel,
              messages: [{ role: 'user', content: prompt }],
              max_tokens: 600,
              temperature: 0.7,
            }),
          });

          const findByPrefix = (prefix: string): number => pool.findIndex((k) => k.startsWith(prefix));
          const upstreamOfIdx = (idx: number): string => {
            const e = entries[idx];
            if (e) return effectiveUpstream(e);
            return upstreamForModel(selectedModel) || 'unknown';
          };
          const reportDead = (prefixes: any) => {
            const list = Array.isArray(prefixes) ? prefixes.filter((p) => typeof p === 'string') : [];
            if (list.length === 0) return;
            const fresh = markDeadByPrefixes(decision.providerId, list);
            fresh.forEach((e) => {
              recordKeyDead(e.k, effectiveUpstream(e));
              notify('error', `Dead key OUT: ${decision.providerName}`, `#${pool.findIndex((k) => k === e.k) + 1}${e.g ? ` (${e.g})` : ''} kaam nahi kar rahi — us Gmail se nayi nikalo.`);
            });
          };
          // Per-key 429 cooldowns (SMART: sirf exhausted keys cool hoti hai, poora pool nahi)
          const report429 = (prefixes: any) => {
            const list = Array.isArray(prefixes) ? prefixes.filter((p) => typeof p === 'string') : [];
            list.forEach((p) => {
              const idx = findByPrefix(p);
              if (idx !== -1) recordKey429(pool[idx], upstreamOfIdx(idx));
            });
            return list.length;
          };

          if (res.ok) {
            const data = await res.json();
            const text = data.choices?.[0]?.message?.content || '';
            decision.responsePayload = text;
            const hdr = res.headers.get('X-Edge-Latency-Ms');
            decision.latencyMs = hdr ? Number(hdr) : Date.now() - t0;
            decision.tokensUsed = data.usage?.total_tokens || decision.tokensUsed;
            decision.isLive = true;
            markModelOk(selectedModel);
            // Prefer key_prefix match (order-proof), fallback to key_index
            const kp = data.edge_routing?.key_prefix;
            let ki = typeof data.edge_routing?.key_index === 'number' ? data.edge_routing.key_index : -1;
            if (typeof kp === 'string' && kp) {
              const found = findByPrefix(kp);
              if (found !== -1) ki = found;
            }
            if (ki >= 0) {
              decision.apiKeyIndex = ki;
              recordKeyOk(pool[ki], data.edge_routing?.upstream_id || upstreamOfIdx(ki), decision.latencyMs);
              if (reviveProviderKey(decision.providerId, ki)) {
                notify('success', `Key wapas live: ${decision.providerName} #${ki + 1}`, 'Dead mark hata diya.');
              }
            }
            reportDead(data.edge_routing?.dead_key_prefixes);
            report429(data.edge_routing?.rate_limited_prefixes);
            if (decision.crossProviderFailover || (data.edge_routing?.keys_tried || 1) > 1) {
              notify('warn', `Key rotate: ${decision.providerName}`, `Key #${(ki ?? 0) + 1} se jawab aaya (${data.edge_routing?.keys_tried || 1} tried).`);
            }
          } else if (res.status === 401) {
            decision.responsePayload = `${decision.providerName} ki key dalo (KEYS button → Provider Keys).`;
            decision.isLive = false;
            notify('warn', 'Key missing', `${decision.providerName} ke liye koi key nahi mili.`);
          } else if (res.status === 429 || res.status === 502) {
            const data = await res.json().catch(() => null);
            reportDead(data?.error?.dead_key_prefixes || data?.edge_routing?.dead_key_prefixes);
            const cooled = report429(data?.error?.rate_limited_prefixes || data?.edge_routing?.rate_limited_prefixes);
            if (cooled === 0) {
              // Backend ne specific keys nahi batayi — engine-level fallback cooldown
              markProviderKeysExhausted(decision.providerId, Math.max(1, pool.length));
            }
            const emsg = data?.error?.message || `Upstream busy (${res.status}). 60s cooldown lagaya.`;
            decision.responsePayload = emsg;
            decision.isLive = false;
            if (isModelGoneError(emsg)) {
              markModelFailed(selectedModel);
              setCatalogTick((t) => t + 1);
              notify('warn', `Model hata: ${selectedModel}`, 'Provider pe ye model nahi raha — list se auto-hide. Sync se wapas aayega.');
            } else {
              notify('error', `Quota/busy: ${decision.providerName}`, cooled > 0 ? `${cooled} key(s) 60s cooldown pe — baaki keys se auto-rotate.` : 'Keys 60s cooldown pe. Fallback ya nayi key lagao.');
            }
          } else {
            const data = await res.json().catch(() => null);
            const emsg = data?.error?.message || `Request fail (${res.status}).`;
            decision.responsePayload = emsg;
            decision.isLive = false;
            if (isModelGoneError(emsg)) {
              markModelFailed(selectedModel);
              setCatalogTick((t) => t + 1);
              notify('warn', `Model hata: ${selectedModel}`, 'Provider pe ye model nahi raha.');
            }
          }
        } catch (netErr) {
          console.warn('Live inference call warning:', netErr);
        }
      }

      setLastResult(decision);
      onRecordDecision(decision, updatedEndpoints);
      if (onUpdateUsage) {
        onUpdateUsage(decision.providerId, 1, decision.tokensUsed || 45);
      }
    } catch (err: any) {
      console.error(err);
      const msg = err?.message || 'Test fail ho gaya. Provider Keys me key dalo.';
      setTesterError(msg);
      notify('error', 'Edge test fail', msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyPayload = () => {
    if (!lastResult) return;
    navigator.clipboard.writeText(lastResult.responsePayload);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-8 pb-16">
      {/* Header */}
      <div className="border-b border-neutral-800/80 pb-6 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 font-mono text-[11px] sm:text-xs uppercase tracking-widest text-neutral-400">
          <span>INTERACTIVE SANDBOX</span>
          <span>//</span>
          <span className="text-white font-semibold">LIVE ROUTER DISPATCH</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white font-mono uppercase break-words">
          EDGE ROUTING & FAILOVER SIMULATOR
        </h1>
        <p className="text-xs sm:text-sm text-neutral-400 font-sans max-w-2xl leading-relaxed">
          Dispatch requests through the simulated edge worker. Test latency distribution, failover triggers, and cache resolution with zero server overhead.
        </p>
      </div>

      {testerError && (
        <div className="p-3 bg-rose-950/70 border border-rose-800/80 text-rose-300 text-xs font-sans">
          {testerError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8">
        {/* Left Column: Request Dispatch Form (Span 6) */}
        <div className="lg:col-span-6 space-y-6">
          <div className="bg-neutral-900/60 border border-neutral-800 p-4 sm:p-6 space-y-5 sm:space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-800 pb-4">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                <h2 className="text-sm font-bold font-mono tracking-wide text-white uppercase truncate">
                  Request Configuration
                </h2>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono text-neutral-400 truncate">
                  PROVIDER: <strong className="text-white">{activeProvider.name}</strong>
                </span>
                {activeProvider.dailyTokenQuota && (
                  <span className="text-[10px] font-mono font-medium text-emerald-400 bg-emerald-950/70 border border-emerald-800/80 px-1.5 py-0.5">
                    ⚡ {activeProvider.dailyTokenQuota}
                  </span>
                )}
              </div>
            </div>

            {/* Model Selector — LIVE catalog: sirf working models (green dot = key ready) */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="block text-xs font-mono uppercase tracking-wider text-neutral-300">
                  Target Model <span className="text-neutral-500 normal-case">(● key ready)</span>
                </label>
                <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">
                  Provider: <strong className="text-emerald-400">{activeProvider.name}</strong>
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <div className="flex border border-neutral-800 text-[10px] font-mono">
                  {(['active', 'all'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => {
                        setModelFilter(f);
                        try {
                          localStorage.setItem('er_model_filter', f);
                        } catch { /* ignore */ }
                      }}
                      className={`px-2 py-1 uppercase tracking-wider ${modelFilter === f ? 'bg-neutral-100 text-neutral-950 font-bold' : 'text-neutral-400 hover:text-white'}`}
                    >
                      {f === 'active' ? 'Active' : 'All'}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={modelSearch}
                  onChange={(e) => setModelSearch(e.target.value)}
                  placeholder="Search models..."
                  className="flex-1 min-w-[120px] bg-neutral-950 border border-neutral-800 px-2 py-1 text-[11px] font-mono text-neutral-200 placeholder-neutral-600 focus:border-emerald-500 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={syncing}
                  onClick={async () => {
                    setSyncing(true);
                    try {
                      const fresh = await runCatalogSync((providers || []).map((p) => p.id));
                      if (fresh) setLastSync(fresh.syncedAt);
                      setCatalogTick((t) => t + 1);
                    } finally {
                      setSyncing(false);
                    }
                  }}
                  title="Providers se fresh model list kheecho"
                  className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-neutral-200 disabled:opacity-50"
                >
                  {syncing ? 'SYNCING...' : 'SYNC'}
                </button>
                {lastSync > 0 && (
                  <span className="text-[9px] font-mono text-neutral-500">
                    synced {new Date(lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
              {(() => {
                void catalogTick;
                const live = loadLiveCatalog();
                const pools = getAllProviderKeys((providers || []).map((p) => p.id));
                const allEff: string[] = [];
                try {
                  (providers || []).forEach((p) => {
                    getProviderKeyEntries(p.id).forEach((e) => {
                      if (e.s === 'active') allEff.push(effectiveUpstream(e));
                    });
                  });
                } catch { /* ignore */ }
                const hasKeyFor = (up: string | null) => {
                  if (!up) return allEff.length > 0;
                  return allEff.includes(up);
                };
                const failedMap = getModelStatus();
                type Row = { id: string; up: string | null; upName: string; hasKey: boolean; failed: boolean; free: boolean };
                let rows: Row[];
                if (live && live.models.length > 0) {
                  const seen = new Set<string>();
                  rows = [];
                  live.models.forEach((m) => {
                    if (seen.has(m.id)) return;
                    seen.add(m.id);
                    rows.push({
                      id: m.id,
                      up: m.upstream || upstreamForModel(m.id),
                      upName: UPSTREAM_META[m.upstream]?.short || UPSTREAM_META[upstreamForModel(m.id) || '']?.short || 'Auto',
                      hasKey: false,
                      failed: failedMap[m.id]?.state === 'failed',
                      free: m.free !== false,
                    });
                  });
                  rows.forEach((r) => {
                    r.hasKey = hasKeyFor(r.up);
                  });
                } else {
                  rows = modelsWithKeyStatus(activeProvider.models, pools).map((s) => ({
                    id: s.model,
                    up: upstreamForModel(s.model),
                    upName: s.upstreamName,
                    hasKey: s.hasKey,
                    failed: failedMap[s.model]?.state === 'failed',
                    free: true,
                  }));
                }
                // Custom endpoints: apna model, apni key — hamesha ready (own key inside).
                try {
                  const have = new Set(rows.map((r) => r.id));
                  listCustomEndpoints().filter((c) => c.enabled && c.model).forEach((c) => {
                    if (have.has(c.model)) {
                      const r = rows.find((x) => x.id === c.model);
                      if (r) { r.hasKey = true; r.upName = `${r.upName} + ${c.name}`; }
                      return;
                    }
                    have.add(c.model);
                    rows.push({
                      id: c.model,
                      up: c.tag || 'custom',
                      upName: `Custom · ${c.name}`,
                      hasKey: true,
                      failed: failedMap[c.model]?.state === 'failed',
                      free: true,
                    });
                  });
                } catch { /* ignore */ }
                const q = modelSearch.trim().toLowerCase();
                const shown = rows.filter((r) => {
                  if (modelFilter === 'active' && (!r.hasKey || r.failed)) return false;
                  if (!q) return true;
                  return r.id.toLowerCase().includes(q) || r.upName.toLowerCase().includes(q);
                });
                const retired = modelFilter === 'all' ? rows.filter((r) => r.failed && (!q || r.id.toLowerCase().includes(q))) : [];
                const groups: { up: string; name: string; items: Row[] }[] = [];
                shown.filter((r) => !r.failed).forEach((r) => {
                  let g = groups.find((x) => x.up === (r.up || 'auto'));
                  if (!g) {
                    g = { up: r.up || 'auto', name: r.upName, items: [] as Row[] };
                    groups.push(g);
                  }
                  g.items.push(r);
                });
                const btn = (r: Row, dimmed: boolean) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelectedModel(r.id)}
                    title={r.failed ? `${r.id} — provider pe nahi raha (retired)` : r.hasKey ? `${r.id} → ${r.upName} (key ready)` : `${r.id} → ${r.upName} (KEY NAHI HAI — pehle KEYS me dalo)`}
                    className={`px-2.5 py-1 text-xs border transition-all duration-150 flex items-center gap-1.5 ${
                      selectedModel === r.id
                        ? 'border-neutral-200 bg-white text-neutral-950 font-bold'
                        : r.hasKey && !dimmed
                          ? 'border-neutral-700 bg-neutral-950 text-neutral-200 hover:text-white'
                          : 'border-neutral-800 bg-neutral-950/40 text-neutral-500 hover:text-neutral-300'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${r.hasKey && !dimmed ? 'bg-emerald-400' : r.failed ? 'bg-rose-500' : 'bg-neutral-700'}`}
                    />
                    <span className="break-all text-left">{r.id}</span>
                    {r.free && (
                      <span className="text-[8px] px-1 bg-emerald-950 text-emerald-400 border border-emerald-800/60 font-bold flex-shrink-0">
                        FREE
                      </span>
                    )}
                  </button>
                );
                return (
                  <div className="space-y-2.5">
                    {shown.filter((r) => !r.failed).length === 0 && (
                      <div className="p-2.5 bg-neutral-950 border border-neutral-800 text-[11px] font-sans text-neutral-400">
                        {modelFilter === 'active'
                          ? 'Koi active model nahi — KEYS me key dalo ya SYNC dabao.'
                          : 'Koi model nahi mila — search badlo ya SYNC dabao.'}
                      </div>
                    )}
                    {groups.map((g) => (
                      <div key={g.up} className="space-y-1">
                        <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-500">
                          {g.name} <span className="text-neutral-600">({g.items.length})</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5 font-mono text-xs">
                          {g.items.map((r) => btn(r, false))}
                        </div>
                      </div>
                    ))}
                    {retired.length > 0 && (
                      <div className="space-y-1 pt-1 border-t border-neutral-800">
                        <div className="text-[10px] font-mono uppercase tracking-wider text-rose-400/80">
                          Retired ({retired.length}) — provider ne hataya
                        </div>
                        <div className="flex flex-wrap gap-1.5 font-mono text-xs">
                          {retired.map((r) => btn(r, true))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Client Origin Region */}
            <div className="space-y-2">
              <label className="block text-xs font-mono uppercase tracking-wider text-neutral-300">
                Simulated Client Ingress Region
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-xs">
                {[
                  { id: 'india', label: 'India (Mumbai / Delhi)' },
                  { id: 'us-east', label: 'US-East (Virginia)' },
                  { id: 'us-west', label: 'US-West (Oregon)' },
                  { id: 'eu', label: 'Europe (Frankfurt)' },
                  { id: 'apac', label: 'Asia-Pacific (Singapore)' },
                  { id: 'latam', label: 'Latin America (São Paulo)' },
                ].map((reg) => (
                  <button
                    key={reg.id}
                    onClick={() => setClientRegion(reg.id)}
                    className={`p-2 border text-left transition-all duration-200 min-w-0 ${
                      clientRegion === reg.id
                        ? 'border-neutral-200 bg-neutral-950 text-white font-bold shadow-sm'
                        : 'border-neutral-800 bg-neutral-950/40 text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    <div className="text-[10px] text-neutral-500 uppercase">{reg.id}</div>
                    <div className="truncate text-[11px] sm:text-xs">{reg.label}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Prompt / Payload Input */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <div className="flex items-center gap-2">
                  <label className="block text-xs font-mono uppercase tracking-wider text-neutral-300">
                    Request Payload / Prompt
                  </label>
                  <button
                    type="button"
                    onClick={handleAutoPickModel}
                    title="Let AI analyze your prompt intent and pick the fastest/smartest model"
                    className="flex items-center gap-1 text-[10px] font-mono font-bold text-emerald-300 bg-emerald-950/80 hover:bg-emerald-900/90 border border-emerald-700/80 px-2 py-0.5 transition-all shadow-sm"
                  >
                    <Zap className="w-3 h-3 text-emerald-400" />
                    <span>SMART ROUTE (AI PICK)</span>
                  </button>
                </div>
                <span className="text-[11px] font-mono text-neutral-500 truncate">
                  Active Policy: {routingPolicy}
                </span>
              </div>

              {promptAnalysis && (
                <div className="p-2.5 bg-emerald-950/30 border border-emerald-800/80 text-[11px] font-mono space-y-1">
                  <div className="flex items-center justify-between text-emerald-300">
                    <span className="font-bold uppercase flex items-center gap-1.5">
                      <Cpu className="w-3 h-3 text-emerald-400" />
                      Task Type: {promptAnalysis.taskType}
                    </span>
                    <span className="text-[10px] bg-emerald-900/60 border border-emerald-700 px-1.5 py-0.5 text-white">
                      ~{promptAnalysis.estimatedLatencyMs}ms Est.
                    </span>
                  </div>
                  <p className="text-neutral-300 text-[11px] font-sans">
                    {promptAnalysis.reasoning}
                  </p>
                  <div className="text-[10px] text-emerald-400/90 pt-0.5">
                    → Target: <strong className="text-white">{promptAnalysis.recommendedModel}</strong> ({promptAnalysis.recommendedProviderSlug})
                  </div>
                </div>
              )}

              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                className="w-full bg-neutral-950 border border-neutral-800 p-3 font-mono text-xs text-neutral-200 focus:border-neutral-500 focus:outline-none transition-colors duration-200"
                placeholder="Enter prompt or JSON body..."
              />
            </div>

            {/* Outage Simulation Toggles */}
            <div className="space-y-3">
              {/* Toggle 0: Real Live Inference */}
              <div className="p-3.5 bg-neutral-950 border border-neutral-800 space-y-1">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Zap className={`w-4 h-4 flex-shrink-0 ${enableRealInference ? 'text-emerald-400' : 'text-neutral-500'}`} />
                    <span className="text-xs font-mono font-semibold uppercase text-neutral-200 truncate">
                      Real Live AI Inference (Via Server Proxy)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEnableRealInference(!enableRealInference)}
                    className={`w-10 h-5 flex items-center p-0.5 transition-colors duration-200 border flex-shrink-0 ${
                      enableRealInference
                        ? 'bg-emerald-500/20 border-emerald-500 justify-end'
                        : 'bg-neutral-800 border-neutral-700 justify-start'
                    }`}
                  >
                    <div
                      className={`w-3.5 h-3.5 transition-all duration-200 ${
                        enableRealInference ? 'bg-emerald-400' : 'bg-neutral-400'
                      }`}
                    />
                  </button>
                </div>
                <p className="text-[11px] font-sans text-neutral-400 leading-relaxed">
                  Sends the real prompt across the edge mesh proxy to generate live AI completion and measure true network latency.
                </p>
              </div>
              {/* Toggle 1: Node level failover */}
              <div className="p-3.5 bg-neutral-950 border border-neutral-800 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <ShieldAlert className={`w-4 h-4 flex-shrink-0 ${simulateFailure ? 'text-amber-400' : 'text-neutral-500'}`} />
                    <span className="text-xs font-mono font-semibold uppercase text-neutral-200 truncate">
                      Simulate Node Degradation / Regional Outage
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSimulateFailure(!simulateFailure)}
                    className={`w-10 h-5 flex items-center p-0.5 transition-colors duration-200 border flex-shrink-0 ${
                      simulateFailure
                        ? 'bg-amber-500/20 border-amber-500 justify-end'
                        : 'bg-neutral-800 border-neutral-700 justify-start'
                    }`}
                  >
                    <div
                      className={`w-3.5 h-3.5 transition-all duration-200 ${
                        simulateFailure ? 'bg-amber-400' : 'bg-neutral-400'
                      }`}
                    />
                  </button>
                </div>
                <p className="text-[11px] font-sans text-neutral-400 leading-relaxed">
                  Triggers failover across regional clusters within {activeProvider.name}.
                </p>
              </div>

              {/* Toggle 2: Cross-Provider Token Exhaustion */}
              <div className="p-3.5 bg-neutral-950 border border-neutral-800 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Zap className={`w-4 h-4 flex-shrink-0 ${simulateQuotaExhaustion ? 'text-rose-400' : 'text-neutral-500'}`} />
                    <span className="text-xs font-mono font-semibold uppercase text-neutral-200 truncate">
                      Simulate Daily Quota Limit Hit (429 Exhaustion)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSimulateQuotaExhaustion(!simulateQuotaExhaustion)}
                    className={`w-10 h-5 flex items-center p-0.5 transition-colors duration-200 border flex-shrink-0 ${
                      simulateQuotaExhaustion
                        ? 'bg-rose-500/20 border-rose-500 justify-end'
                        : 'bg-neutral-800 border-neutral-700 justify-start'
                    }`}
                  >
                    <div
                      className={`w-3.5 h-3.5 transition-all duration-200 ${
                        simulateQuotaExhaustion ? 'bg-rose-400' : 'bg-neutral-400'
                      }`}
                    />
                  </button>
                </div>
                <p className="text-[11px] font-sans text-neutral-400 leading-relaxed">
                  Simulates exhausting {activeProvider.name}'s daily free tier quota, testing auto-switch to next provider.
                </p>
              </div>

              {/* Toggle 3: Cross Provider Fallback Enabled */}
              <div className="p-3 bg-neutral-950 border border-neutral-850 flex items-center justify-between text-xs font-mono">
                <div className="flex items-center gap-2">
                  <Layers className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-neutral-300">Cross-Provider Auto-Cascade</span>
                </div>
                <button
                  type="button"
                  onClick={() => setCrossProviderFallbackEnabled(!crossProviderFallbackEnabled)}
                  className={`text-[10px] px-2 py-0.5 border font-semibold ${
                    crossProviderFallbackEnabled
                      ? 'border-emerald-500 bg-emerald-950/60 text-emerald-300'
                      : 'border-neutral-700 text-neutral-500'
                  }`}
                >
                  {crossProviderFallbackEnabled ? 'ENABLED' : 'DISABLED'}
                </button>
              </div>
            </div>

            {/* Dispatch Button */}
            <button
              id="dispatch-edge-btn"
              onClick={handleDispatch}
              disabled={isLoading || providerEndpoints.length === 0}
              className="w-full py-3 sm:py-3.5 bg-neutral-100 hover:bg-white text-neutral-950 font-mono text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all duration-200 shadow-sm disabled:opacity-50 min-h-[44px]"
            >
              <Send className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">DISPATCH REQUEST VIA EDGE ROUTER</span>
            </button>
          </div>
        </div>

        {/* Right Column: Routing Resolution & Telemetry Trace (Span 6) */}
        <div className="lg:col-span-6 space-y-6">
          <div className="bg-neutral-900/60 border border-neutral-800 p-4 sm:p-6 space-y-5 sm:space-y-6 min-h-[360px] sm:min-h-[440px]">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-4 gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Radio className="w-4 h-4 text-emerald-400 animate-pulse flex-shrink-0" />
                <h2 className="text-sm font-bold font-mono tracking-wide text-white uppercase truncate">
                  Edge Routing Resolution Trace
                </h2>
              </div>
              {lastResult && (
                <span className="text-[10px] sm:text-[11px] font-mono text-neutral-400 border border-neutral-800 px-2 py-0.5 bg-neutral-950 flex-shrink-0">
                  {lastResult.id}
                </span>
              )}
            </div>

            {/* Loading state using monochromatic skeleton shimmer (no spinners!) */}
            {isLoading ? (
              <div className="space-y-4 py-6">
                <div className="flex items-center justify-between">
                  <SkeletonLoader className="h-5 w-48" />
                  <SkeletonLoader className="h-5 w-24" />
                </div>
                <SkeletonLoader className="h-16 w-full" />
                <SkeletonLoader className="h-28 w-full" lines={3} />
                <SkeletonLoader className="h-12 w-full" />
              </div>
            ) : !lastResult ? (
              <div className="py-16 sm:py-20 text-center space-y-3">
                <Server className="w-10 h-10 text-neutral-700 mx-auto" />
                <p className="font-mono text-xs text-neutral-500 uppercase">
                  Awaiting request dispatch...
                </p>
                <p className="text-xs text-neutral-600 max-w-sm mx-auto font-sans">
                  Click "Dispatch Request" on the left to watch the edge router evaluate node health, resolve the optimum regional endpoint, and return telemetry headers.
                </p>
              </div>
            ) : (
              <div className="space-y-5 animate-in fade-in duration-250 font-mono text-xs overflow-hidden">
                {/* Result Highlights */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="p-2.5 bg-neutral-950 border border-neutral-800 min-w-0">
                    <span className="text-[10px] text-neutral-500 uppercase block">SELECTED NODE</span>
                    <span className="font-bold text-white text-xs truncate block">
                      {lastResult.selectedRegion}
                    </span>
                  </div>

                  <div className="p-2.5 bg-neutral-950 border border-neutral-800 min-w-0">
                    <span className="text-[10px] text-neutral-500 uppercase block">TOTAL LATENCY</span>
                    <span className="font-bold text-emerald-400 text-xs block">
                      {lastResult.latencyMs} ms
                    </span>
                  </div>

                  <div className="p-2.5 bg-neutral-950 border border-neutral-800 min-w-0">
                    <span className="text-[10px] text-neutral-500 uppercase block">EDGE CACHE</span>
                    <span className="font-bold text-neutral-200 text-xs block truncate">
                      {lastResult.cached ? 'HIT (1ms)' : 'MISS (Origin)'}
                    </span>
                  </div>

                  <div className="p-2.5 bg-neutral-950 border border-neutral-800 min-w-0">
                    <span className="text-[10px] text-neutral-500 uppercase block">STATUS CODE</span>
                    <span className="font-bold text-neutral-100 text-xs block">
                      200 OK
                    </span>
                  </div>
                </div>

                {/* Cross-Provider Cascade Banner (Priority Alert) */}
                {lastResult.crossProviderFailover ? (
                  <div className="p-3.5 bg-rose-950/40 border border-rose-800/80 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-rose-400 font-bold text-xs">
                        <Zap className="w-4 h-4 flex-shrink-0" />
                        <span className="truncate uppercase font-mono">CROSS-PROVIDER AUTO-CASCADE TRIGGERED</span>
                      </div>
                      <span className="text-[9px] font-mono bg-rose-900/60 border border-rose-700 text-rose-200 px-1.5 py-0.5">
                        ZERO-DOWNTIME SWITCH
                      </span>
                    </div>

                    <p className="text-[11px] text-rose-200/90 font-sans leading-relaxed">
                      {lastResult.failoverReason || 'Primary provider daily free token quota exhausted (429 Rate Limit). Seamlessly cascaded across edge mesh.'}
                    </p>

                    <div className="p-2 bg-black/60 border border-rose-900/60 flex items-center justify-between text-[11px] font-mono">
                      <div className="flex items-center gap-1.5">
                        <span className="text-neutral-500">FROM:</span>
                        <span className="text-rose-300 font-bold line-through">{lastResult.initialProviderName || activeProvider.name}</span>
                        <span className="text-neutral-600">(429 Limit)</span>
                      </div>
                      <span className="text-amber-400 font-bold">➔</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-neutral-500">SWITCHED TO:</span>
                        <span className="text-emerald-400 font-bold">{lastResult.providerName}</span>
                        <span className="text-neutral-400">({lastResult.selectedRegion})</span>
                      </div>
                    </div>
                  </div>
                ) : lastResult.failoverAttempted ? (
                  <div className="p-3.5 bg-amber-950/30 border border-amber-800/80 space-y-1">
                    <div className="flex items-center gap-2 text-amber-400 font-bold text-xs">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                      <span className="truncate">REGIONAL FAILOVER REDUNDANCY ENGAGED</span>
                    </div>
                    <p className="text-[11px] text-amber-200/80 font-sans">
                      {lastResult.failoverReason}
                    </p>
                    <div className="text-[10px] text-amber-400/90 font-mono pt-1 truncate">
                      → Rerouted to Secondary Node: <strong className="text-white">{lastResult.selectedEndpointName}</strong>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 bg-neutral-950 border border-neutral-800 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                    <div className="flex items-center gap-2 text-emerald-400 text-xs">
                      <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                      <span>PRIMARY ROUTE OPTIMAL</span>
                    </div>
                    <span className="text-[10px] sm:text-[11px] text-neutral-400">
                      Zero packet drops • Direct edge transit
                    </span>
                  </div>
                )}

                {/* Edge Ingress Headers */}
                <div className="space-y-1.5">
                  <span className="text-[10px] text-neutral-500 uppercase tracking-wider block">
                    Edge Response Headers
                  </span>
                  <div className="p-3 bg-neutral-950 border border-neutral-800 text-[11px] space-y-1 text-neutral-300 break-all">
                    <div><span className="text-neutral-500">x-edge-region:</span> {lastResult.selectedRegion}</div>
                    <div><span className="text-neutral-500">x-route-policy:</span> {lastResult.policyApplied}</div>
                    <div><span className="text-neutral-500">x-endpoint-node:</span> {lastResult.selectedEndpointName}</div>
                    <div><span className="text-neutral-500">x-edge-cache:</span> {lastResult.cached ? 'HIT' : 'MISS'}</div>
                    <div><span className="text-neutral-500">x-server-overhead:</span> 0.00ms</div>
                  </div>
                </div>

                {/* Response Payload */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-neutral-500 uppercase tracking-wider">
                        Response Payload
                      </span>
                      {lastResult.isLive ? (
                        <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-950/80 border border-emerald-700 px-1.5 py-0.5 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          LIVE REAL AI OUTPUT
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono text-neutral-500 bg-neutral-950 border border-neutral-850 px-1.5 py-0.5">
                          SYNTHETIC EDGE CACHE
                        </span>
                      )}
                    </div>
                    <button
                      onClick={handleCopyPayload}
                      className="text-[10px] text-neutral-400 hover:text-white flex items-center gap-1 min-h-[32px] px-2 py-1"
                    >
                      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copied ? 'COPIED' : 'COPY'}</span>
                    </button>
                  </div>
                  <pre className="p-3 bg-neutral-950 border border-neutral-800 text-[11px] text-neutral-300 overflow-x-auto whitespace-pre-wrap break-all max-h-60">
                    {lastResult.responsePayload}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
