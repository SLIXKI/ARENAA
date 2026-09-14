import { Endpoint, Provider, RoutingDecision, RoutingPolicy, RegionCode } from '../types/router';
import { probeGateway, computeStats, isSameOriginEndpoint } from '../utils/probe';

// Geographic latency estimates based on client location to region
export const REGIONAL_PROXIMITY: Record<RegionCode, Record<string, number>> = {
  'ap-south-1': { 'india': 8, 'apac': 42, 'eu': 112, 'us-east': 165, 'us-west': 180, 'latam': 225 },
  'ap-south-2': { 'india': 12, 'apac': 48, 'eu': 118, 'us-east': 170, 'us-west': 185, 'latam': 230 },
  'us-east-1': { 'us-east': 18, 'us-west': 45, 'eu': 82, 'india': 168, 'apac': 160, 'latam': 95 },
  'us-west-2': { 'us-east': 45, 'us-west': 16, 'eu': 110, 'india': 182, 'apac': 125, 'latam': 115 },
  'eu-central-1': { 'us-east': 85, 'us-west': 115, 'eu': 14, 'india': 116, 'apac': 140, 'latam': 150 },
  'eu-west-1': { 'us-east': 78, 'us-west': 108, 'eu': 19, 'india': 122, 'apac': 150, 'latam': 145 },
  'ap-southeast-1': { 'us-east': 175, 'us-west': 135, 'eu': 145, 'india': 38, 'apac': 12, 'latam': 210 },
  'ap-northeast-1': { 'us-east': 155, 'us-west': 110, 'eu': 165, 'india': 74, 'apac': 32, 'latam': 195 },
  'sa-east-1': { 'us-east': 110, 'us-west': 130, 'eu': 160, 'india': 230, 'apac': 230, 'latam': 15 },
  'global-anycast': { 'india': 9, 'us-east': 12, 'us-west': 14, 'eu': 11, 'apac': 13, 'latam': 15 },
};

// In-memory simulated edge cache for zero-overhead performance
const edgeCache = new Map<string, { response: string; timestamp: number }>();

// Per-key cooldown after 429 (memory-only, 60s). Key: `${providerId}:${keyIndex}`
const keyCooldowns = new Map<string, number>();
const KEY_COOLDOWN_MS = 60000;

export function markProviderKeysExhausted(providerId: string, poolSize: number) {
  const now = Date.now();
  for (let i = 0; i < poolSize; i++) {
    keyCooldowns.set(`${providerId}:${i}`, now + KEY_COOLDOWN_MS);
  }
}

export function getUsableKeyIndexes(providerId: string, poolSize: number): number[] {
  const now = Date.now();
  const all = Array.from({ length: poolSize }, (_, i) => i);
  // Strict: cooled keys are skipped (fallback avoids just-429 providers).
  // Callers fall back to index 0 only when nothing is usable.
  return all.filter((i) => (keyCooldowns.get(`${providerId}:${i}`) || 0) <= now);
}

export function countUsableKeys(providerId: string, pool: string[] | undefined): number {
  if (!pool || pool.length === 0) return 0;
  return getUsableKeyIndexes(providerId, pool.length).length;
}

export class EdgeRouterEngine {
  /**
   * Selects an endpoint based on policy, handles failover redundancy
   */
  static routeRequest(
    provider: Provider,
    endpoints: Endpoint[],
    policy: RoutingPolicy,
    clientOriginRegion: string = 'us-east',
    simulateOutageOnFirstNode: boolean = false,
    prompt: string = 'Hello world',
    options?: {
      enableCrossProviderFallback?: boolean;
      allProviders?: Provider[];
      fallbackChain?: string[];
      simulateQuotaExhaustion?: boolean;
      providerKeys?: Record<string, string[]>;
    }
  ): {
    decision: RoutingDecision;
    updatedEndpoints: Endpoint[];
  } {
    let activeProvider = provider;
    let crossProviderFailover = false;
    let initialProviderName: string | undefined;
    let fallbackChainList: string[] = [];

    // Check if daily quota exhaustion is simulated or if cross-provider fallback should trigger
    if (options?.simulateQuotaExhaustion && options?.enableCrossProviderFallback && options?.allProviders && options?.fallbackChain) {
      initialProviderName = provider.name;
      // Look for next provider in chain
      const nextProviderId = options.fallbackChain.find((id) => id !== provider.id);
      const nextProvider = options.allProviders.find((p) => p.id === nextProviderId);
      const nextEndpoints = endpoints.filter((ep) => ep.providerId === nextProviderId && ep.enabled);

      if (nextProvider && nextEndpoints.length > 0) {
        activeProvider = nextProvider;
        crossProviderFailover = true;
        fallbackChainList = [provider.name, nextProvider.name];
      }
    }

    let providerEndpoints = endpoints.filter(
      (ep) => ep.providerId === activeProvider.id && ep.enabled
    );

    const usableKeysOf = (pid: string): number => {
      const pool = options?.providerKeys?.[pid];
      if (!options?.providerKeys) return 1; // keys unknown (legacy call) — don't block
      return countUsableKeys(pid, pool);
    };

    if (providerEndpoints.length === 0) {
      // If no endpoints for active provider, try cross-provider fallback as emergency
      // (skip providers with zero usable keys so we never route blind)
      if (options?.enableCrossProviderFallback && options?.allProviders && options?.fallbackChain) {
        for (const chainId of options.fallbackChain) {
          const fallbackCand = options.allProviders.find((p) => p.id === chainId);
          const fallbackEps = endpoints.filter((ep) => ep.providerId === chainId && ep.enabled);
          if (fallbackCand && fallbackEps.length > 0 && usableKeysOf(chainId) > 0) {
            initialProviderName = activeProvider.name;
            activeProvider = fallbackCand;
            providerEndpoints = fallbackEps;
            crossProviderFailover = true;
            fallbackChainList = [initialProviderName, fallbackCand.name];
            break;
          }
        }
      }
      if (providerEndpoints.length === 0) {
        throw new Error(`No enabled endpoints found for provider "${activeProvider.name}".`);
      }
    }

    const cacheKey = `${activeProvider.id}:${prompt.trim().toLowerCase()}`;
    const cachedHit = edgeCache.get(cacheKey);
    const isCached = !!cachedHit && Date.now() - cachedHit.timestamp < 60000;

    let selectedEndpoint: Endpoint;
    let failoverOccurred = crossProviderFailover;
    let failoverReason: string | undefined = crossProviderFailover
      ? `Daily quota limit / 429 reached on [${initialProviderName}]. Seamlessly cascaded to [${activeProvider.name}] at the edge.`
      : undefined;

    // Filter tier 1 primary endpoints
    const tier1Endpoints = providerEndpoints.filter((ep) => ep.priorityTier === 1 && ep.status !== 'offline');
    const tier2Endpoints = providerEndpoints.filter((ep) => ep.priorityTier >= 2 && ep.status !== 'offline');

    let pool = tier1Endpoints.length > 0 ? tier1Endpoints : providerEndpoints;

    // Check if simulation causes outage on primary
    if (simulateOutageOnFirstNode && pool.length > 0) {
      const primaryCandidate = pool[0];
      failoverOccurred = true;
      failoverReason = crossProviderFailover 
        ? `${failoverReason} Secondary node picked after primary outage.`
        : `Primary node [${primaryCandidate.name}] simulated 429 Rate-Limit. Instant edge failover triggered.`;
      
      // Fallback to next tier or remaining healthy pool
      const secondaryPool = pool.filter((ep) => ep.id !== primaryCandidate.id);
      if (secondaryPool.length > 0) {
        pool = secondaryPool;
      } else if (tier2Endpoints.length > 0) {
        pool = tier2Endpoints;
      }
    }

    // Apply specific policy
    switch (policy) {
      case 'lowest-latency': {
        const sorted = [...pool].sort((a, b) => a.latencyMs - b.latencyMs);
        selectedEndpoint = sorted[0];
        break;
      }

      case 'regional-geo': {
        // Find endpoint with lowest regional proximity latency
        const sortedByGeo = [...pool].sort((a, b) => {
          const proxA = REGIONAL_PROXIMITY[a.region]?.[clientOriginRegion] ?? a.latencyMs;
          const proxB = REGIONAL_PROXIMITY[b.region]?.[clientOriginRegion] ?? b.latencyMs;
          return proxA - proxB;
        });
        selectedEndpoint = sortedByGeo[0];
        break;
      }

      case 'weighted-round-robin': {
        const totalWeight = pool.reduce((acc, ep) => acc + (ep.weight || 1), 0);
        let randomNum = Math.random() * totalWeight;
        let picked = pool[0];
        for (const ep of pool) {
          randomNum -= ep.weight || 1;
          if (randomNum <= 0) {
            picked = ep;
            break;
          }
        }
        selectedEndpoint = picked;
        break;
      }

      case 'cost-optimized': {
        // Prioritize endpoints with larger remaining rate limit pool and tier 1
        const sortedByRate = [...pool].sort(
          (a, b) => b.rateLimitRemaining - a.rateLimitRemaining
        );
        selectedEndpoint = sortedByRate[0];
        break;
      }

      case 'failover-cascade':
      default: {
        // Strictly tier 1, lowest latency
        const tier1Healthy = pool.filter((ep) => ep.status === 'healthy');
        if (tier1Healthy.length > 0) {
          selectedEndpoint = tier1Healthy[0];
        } else {
          selectedEndpoint = pool[0];
        }
        break;
      }
    }

    const calculatedLatency = isCached
      ? Math.floor(Math.random() * 2) + 1 // 1-2ms for edge cache hit
      : selectedEndpoint.latencyMs + Math.floor(Math.random() * 6 - 3);

    // Construct mock AI completion output based on prompt
    const responseText = isCached
      ? cachedHit!.response
      : `{"status":"ok","provider":"${activeProvider.name}","routed_region":"${selectedEndpoint.region}","node":"${selectedEndpoint.name}","latency_ms":${calculatedLatency},"tokens":42,"edge_status":"200 OK"}`;

    if (!isCached) {
      edgeCache.set(cacheKey, { response: responseText, timestamp: Date.now() });
    }

    const decision: RoutingDecision = {
      id: 'req_' + Math.random().toString(36).substring(2, 9),
      timestamp: Date.now(),
      providerId: activeProvider.id,
      providerName: activeProvider.name,
      selectedEndpointId: selectedEndpoint.id,
      selectedEndpointName: selectedEndpoint.name,
      selectedRegion: selectedEndpoint.region,
      policyApplied: policy,
      latencyMs: calculatedLatency,
      statusCode: 200,
      cached: isCached,
      failoverAttempted: failoverOccurred,
      failoverReason,
      crossProviderFailover,
      initialProviderName,
      fallbackChain: fallbackChainList.length > 0 ? fallbackChainList : undefined,
      promptSummary: prompt.length > 50 ? prompt.slice(0, 50) + '...' : prompt,
      responsePayload: responseText,
      tokensUsed: Math.floor(Math.random() * 150) + 30,
      apiKeyIndex: (() => {
        const pool = options?.providerKeys?.[activeProvider.id] || [];
        if (pool.length === 0) return undefined;
        return getUsableKeyIndexes(activeProvider.id, pool.length)[0] ?? 0;
      })(),
      keyPoolSize: (options?.providerKeys?.[activeProvider.id] || []).length || undefined,
    };

    // Update endpoint telemetry stats in immutably cloned array
    const updatedEndpoints = endpoints.map((ep) => {
      if (ep.id === selectedEndpoint.id) {
        return {
          ...ep,
          totalRouted: ep.totalRouted + 1,
          rateLimitRemaining: Math.max(0, ep.rateLimitRemaining - 1),
          latencyMs: Math.max(5, calculatedLatency),
          lastChecked: Date.now(),
        };
      }
      return ep;
    });

    return { decision, updatedEndpoints };
  }

  /**
   * Live health sweep — REAL measurements only.
   *
   * Same-origin gateway endpoints get an actual /api/health round-trip and uptime
   * becomes a rolling success ratio over the stored probe history. Third-party
   * endpoints cannot be probed from the browser (CORS), so they are left
   * unmeasured rather than being handed a fabricated latency.
   */
  static async runHealthSweep(endpoints: Endpoint[]): Promise<Endpoint[]> {
    const results = await Promise.all(
      endpoints.map(async (ep) => {
        if (!isSameOriginEndpoint(ep.baseUrl)) {
          return { ...ep, lastChecked: Date.now() };
        }
        const sample = await probeGateway(ep.baseUrl);
        const stats = computeStats();
        return {
          ...ep,
          latencyMs: sample.ok ? Math.round(sample.ms) : ep.latencyMs,
          uptimePercentage: stats.measured ? stats.uptimePct : ep.uptimePercentage,
          status: sample.ok
            ? ep.status === 'offline'
              ? ('healthy' as const)
              : ep.status
            : ('offline' as const),
          errorsCount: sample.ok ? ep.errorsCount : ep.errorsCount + 1,
          lastChecked: Date.now(),
        };
      }),
    );
    return results;
  }
}
