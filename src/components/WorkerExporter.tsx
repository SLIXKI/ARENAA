import React, { useState } from 'react';
import { 
  Code2, 
  Copy, 
  Check, 
  Download, 
  Upload, 
  Terminal, 
  Server, 
  FileText,
  Globe,
  Layers,
  ArrowRight,
  ShieldCheck,
  Zap,
  Key,
  Eye,
  EyeOff,
  RefreshCw,
  Lock,
  CheckCircle2,
  Trash2
} from 'lucide-react';
import { Endpoint, Provider, RoutingPolicy } from '../types/router';
import { getProviderKeyEntries, poolsSnapshot } from '../utils/providerKeys';
import { customPoolEntries, customEndpointsSig } from '../utils/customEndpoints';
import { notify } from '../utils/notify';

interface WorkerExporterProps {
  activeProvider: Provider;
  providers?: Provider[];
  endpoints: Endpoint[];
  routingPolicy: RoutingPolicy;
  fallbackChain?: string[];
  onImportConfig: (data: { providers?: Provider[]; endpoints?: Endpoint[] }) => void;
  userGeminiKey?: string;
  /** Compact: only Worker code + config portability (master key UI lives in ConnectHub). */
  compact?: boolean;
}

export const WorkerExporter: React.FC<WorkerExporterProps> = ({
  activeProvider,
  providers = [],
  endpoints,
  routingPolicy,
  fallbackChain = [],
  onImportConfig,
  userGeminiKey = '',
  compact = false,
}) => {
  const [copiedType, setCopiedType] = useState<string | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<'curl' | 'python' | 'node' | 'opencode' | 'nextjs'>('python');
  const [proxyModel, setProxyModel] = useState<string>('gemini-flash-latest');

  // UNIQUE MASTER KEY per user: link + ye key bahar use karo.
  // Background me isi me embedded provider pools se relay hota hai. Raw keys kabhi bahar nahi.
  const [masterKey, setMasterKey] = useState<string>(() => {
    try {
      return localStorage.getItem('er_master_key') || '';
    } catch {
      return '';
    }
  });
  const [masterMeta, setMasterMeta] = useState<any>(() => {
    try {
      return JSON.parse(localStorage.getItem('er_master_meta') || 'null');
    } catch {
      return null;
    }
  });
  const [showApiKey, setShowApiKey] = useState(false);
  const [masterBusy, setMasterBusy] = useState(false);
  const [masterMsg, setMasterMsg] = useState('');

  const poolSigNow = (() => {
    try {
      return poolsSnapshot((providers || []).map((p) => p.id)) + '|' + customEndpointsSig();
    } catch {
      return '';
    }
  })();
  const masterStale = !!masterKey && !!masterMeta && masterMeta.poolsSnapshot !== poolSigNow;
  const proxyApiKey = masterKey;
  const masterExpiryText = (() => {
    try {
      if (!masterMeta?.expiresAt) return '';
      const d = new Date(masterMeta.expiresAt);
      return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  })();

  const saveMaster = (key: string, meta: any) => {
    setMasterKey(key);
    setMasterMeta(meta);
    try {
      if (key) {
        localStorage.setItem('er_master_key', key);
        localStorage.setItem('er_master_meta', JSON.stringify(meta));
      } else {
        localStorage.removeItem('er_master_key');
        localStorage.removeItem('er_master_meta');
      }
    } catch { /* ignore */ }
  };

  const handleGenerateMaster = async (label: string) => {
    setMasterBusy(true);
    setMasterMsg('');
    try {
      const pools: Record<string, { k: string; g: string; u?: string; b?: string; m?: string }[]> = {};
      (providers || []).forEach((p) => {
        const entries = getProviderKeyEntries(p.id);
        if (entries.length > 0) pools[p.id] = entries.map((e) => ({ k: e.k, g: e.g, ...(e.u ? { u: e.u } : {}) }));
      });
      const customs = customPoolEntries();
      if (customs.length > 0) pools['custom'] = customs;
      if (Object.keys(pools).length === 0) {
        setMasterMsg('Pehle KEYS button se kam se kam 1 provider key dalo.');
        notify('warn', 'Master key nahi bani', 'Pools khali hai — pehle keys dalo.');
        return;
      }
      const res = await fetch('/api/keys/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: pools, label }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.masterKey) {
        setMasterMsg(data?.error || 'Generate fail ho gaya.');
        notify('error', 'Master generate fail', data?.error || 'Dobara try karo.');
        return;
      }
      saveMaster(data.masterKey, {
        mid: data.mid,
        label: data.label || label,
        expiresAt: data.expiresAt,
        counts: data.providers,
        poolsSnapshot: poolSigNow,
      });
      const totalKeys = Object.values(data.providers || {}).reduce((n: number, v: any) => n + (v?.count || 0), 0);
      setMasterMsg(`Master key ban gayi ✓ (${totalKeys} keys, expiry: ${new Date(data.expiresAt).toLocaleDateString()})${data.sizeWarn ? ` ⚠️ ${data.sizeWarn}` : ''}`);
      notify('success', 'Master key generated', `${totalKeys} keys embedded (tags samet), 90 din valid.`);
      if (data.sizeWarn) notify('warn', 'Master token bada hai', data.sizeWarn);
    } catch (e: any) {
      setMasterMsg('Network error — dobara try karo.');
    } finally {
      setMasterBusy(false);
    }
  };

  const handleDeleteMaster = async () => {
    if (!masterKey) return;
    setMasterBusy(true);
    try {
      let mode = 'local-only';
      try {
        const res = await fetch('/api/keys/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ masterKey }),
        });
        const data = await res.json().catch(() => null);
        mode = data?.mode || (data?.revoked ? 'global' : 'local-only');
      } catch { /* offline -> local wipe still */ }
      saveMaster('', null);
      if (mode === 'global') {
        setMasterMsg('Master key turant cut (global revoke) ✓');
        notify('success', 'Master revoked', 'Ye key kahin bhi kaam nahi karegi. Nayi Generate kar lo.');
      } else {
        setMasterMsg('App se hata di. Global instant-revoke ke liye Vercel KV connect karo.');
        notify('warn', 'Master local-delete', 'Is device se hati. Baanti copies expiry tak chalengi (KV nahi hai).');
      }
    } finally {
      setMasterBusy(false);
    }
  };

  const providerEndpoints = endpoints.filter(
    (ep) => ep.providerId === activeProvider.id && ep.enabled
  );

  const copyToClipboard = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 2000);
  };

  // Real single endpoint: isi Vercel deployment ka /api/v1 (zero-setup, GitHub -> Vercel direct)
  const universalBaseUrl = (() => {
    try {
      if (typeof window !== 'undefined' && window.location?.origin?.startsWith('http')) {
        return `${window.location.origin}/api/v1`;
      }
    } catch { /* ignore */ }
    return 'https://your-app.vercel.app/api/v1';
  })();
  const fullEndpoint = `${universalBaseUrl}/chat/completions`;

  // Client snippets: link + UNIQUE master key (background me pools se relay)
  const displayKey = proxyApiKey || 'er1...generate-karo';
  const codeSnippets: Record<'curl' | 'python' | 'node' | 'opencode' | 'nextjs', string> = {
    curl: `curl -X POST "${fullEndpoint}" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${displayKey}" \\
  -d '{
    "providerId": "Edge Router",
    "model": "${proxyModel}",
    "messages": [
      {"role": "user", "content": "Hello! Explain quantum computing in 2 sentences."}
    ],
    "temperature": 0.7
  }'`,

    python: `from openai import OpenAI

# Gateway link + tumhari UNIQUE master key (Export tab se)
client = OpenAI(
    base_url="${universalBaseUrl}",
    api_key="${displayKey}",
)

response = client.chat.completions.create(
    model="${proxyModel}",
    messages=[
        {"role": "user", "content": "How do edge distributed systems handle failovers?"}
    ],
    temperature=0.7,
    extra_body={"providerId": "Edge Router"},
)

print(response.choices[0].message.content)`,

    node: `import OpenAI from "openai";

// Gateway link + tumhari UNIQUE master key
const client = new OpenAI({
  baseURL: "${universalBaseUrl}",
  apiKey: "${displayKey}",
});

async function main() {
  const completion = await client.chat.completions.create({
    model: "${proxyModel}",
    messages: [
      { role: "user", content: "Summarize edge routing." }
    ],
    // @ts-ignore site provider ID (optional — default bhi universal hai)
    providerId: "Edge Router",
  } as any);

  console.log(completion.choices[0].message.content);
}

main();`,

    opencode: `# OpenCode / Cursor (.env) — single endpoint + tumhari key
OPENAI_BASE_URL="${universalBaseUrl}"
OPENAI_API_KEY="${displayKey}"
DEFAULT_MODEL="${proxyModel}"`,

    nextjs: `// Next.js route — single gateway
import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";

const edgeRouter = createOpenAI({
  baseURL: "${universalBaseUrl}",
  apiKey: "${displayKey}",
});

export async function POST(req: Request) {
  const { messages } = await req.json();
  const result = streamText({
    model: edgeRouter("${proxyModel}"),
    messages,
  });
  return result.toDataStreamResponse();
}`,
  };

  // Generate Cloudflare Worker TypeScript code with cross-provider auto-fallback & API Key Auth
  const workerCode = `/**
 * Edge Router - Serverless Edge API Router & Load Balancer
 * Zero server overhead • Evaluated at 300+ Edge PoPs
 * Provider: ${activeProvider.name} | Policy: ${routingPolicy}
 * Cross-Provider Fallback: Enabled (${fallbackChain.length} tiers)
 * Master Auth: Enforces Edge Router Proxy API Key
 */

interface RegionalEndpoint {
  id: string;
  providerId: string;
  providerName: string;
  name: string;
  region: string;
  url: string;
  weight: number;
  priorityTier: number;
}

// Configured Master Proxy API Key for Gateway Authentication
const PROXY_MASTER_KEY: string = "${proxyApiKey}";

const REGIONAL_NODES: RegionalEndpoint[] = ${JSON.stringify(
    endpoints
      .filter((ep) => ep.enabled)
      .map((ep) => {
        const pr = providers.find((p) => p.id === ep.providerId);
        return {
          id: ep.id,
          providerId: ep.providerId,
          providerName: pr ? pr.name : ep.providerId,
          name: ep.name,
          region: ep.region,
          url: ep.baseUrl,
          weight: ep.weight,
          priorityTier: ep.priorityTier,
        };
      }),
    null,
    2
  )};

const FALLBACK_CHAIN = ${JSON.stringify(fallbackChain)};
const ROUTING_POLICY: string = "${routingPolicy}";

export default {
  async fetch(request: Request, env: Record<string, string>, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "*",
        },
      });
    }

    // 0. Enforce Edge Router Proxy API Key Authorization
    const authHeader = request.headers.get("Authorization");
    const providedKey = authHeader ? authHeader.replace(/^Bearer\\s+/i, "").trim() : "";
    
    if (PROXY_MASTER_KEY && providedKey !== PROXY_MASTER_KEY) {
      return new Response(JSON.stringify({
        error: {
          message: "Unauthorized: Invalid or missing Edge Router Proxy API Key",
          type: "invalid_request_error",
          code: "invalid_api_key",
          hint: "Set Authorization: Bearer ${proxyApiKey.substring(0, 14)}..."
        }
      }), {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        }
      });
    }

    // 1. Resolve Universal Model Aliases
    const clonedReq = request.clone();
    let bodyJson: Record<string, unknown> = {};
    try {
      bodyJson = await clonedReq.json();
    } catch (_) {}

    const reqModel = (bodyJson.model as string) || "gemini-flash-latest";
    // Single Gemini gateway: all aliases resolve to the active provider
    let targetProvider = "${activeProvider.id}";

    // 2. Select primary node for active provider
    let availableNodes = REGIONAL_NODES.filter(n => n.providerId === targetProvider);
    if (availableNodes.length === 0) availableNodes = REGIONAL_NODES;

    let targetNode = selectEndpoint(availableNodes);
    let start = performance.now();
    let response: Response;
    let fallbackOccurred = false;
    let finalNode = targetNode;

    try {
      response = await forwardRequest(request, targetNode);

      // 3. Automated Cross-Provider Fallback on 429 (Quota Exceeded) or 5xx
      if (response.status === 429 || response.status >= 500) {
        console.warn(\`[429 Quota Hit] Cascading from \${targetNode.providerName} to fallback chain\`);
        
        for (const nextProviderId of FALLBACK_CHAIN) {
          if (nextProviderId === targetNode.providerId) continue;
          const fallbackCandidates = REGIONAL_NODES.filter(n => n.providerId === nextProviderId);
          if (fallbackCandidates.length === 0) continue;

          const candidateNode = selectEndpoint(fallbackCandidates);
          const fallbackResp = await forwardRequest(request, candidateNode);
          if (fallbackResp.status === 200) {
            response = fallbackResp;
            finalNode = candidateNode;
            fallbackOccurred = true;
            break;
          }
        }
      }
    } catch (err) {
      return new Response(JSON.stringify({ error: "Edge router upstream failure", detail: String(err) }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const latency = Math.round(performance.now() - start);

    // 4. Inject Edge Telemetry Headers
    const headers = new Headers(response.headers);
    headers.set("x-edge-router", "edge-router-v1");
    headers.set("x-edge-provider", finalNode.providerName);
    headers.set("x-edge-region", finalNode.region);
    headers.set("x-edge-latency-ms", latency.toString());
    headers.set("x-fallback-occurred", fallbackOccurred ? "true" : "false");

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  },
};

async function forwardRequest(request: Request, node: RegionalEndpoint): Promise<Response> {
  const targetUrl = new URL(request.url);
  const originUrl = new URL(node.url);
  targetUrl.protocol = originUrl.protocol;
  targetUrl.hostname = originUrl.hostname;
  targetUrl.port = originUrl.port;

  return fetch(targetUrl.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });
}

function selectEndpoint(nodes: RegionalEndpoint[]): RegionalEndpoint {
  if (nodes.length === 0) throw new Error("No nodes available");
  if (nodes.length === 1) return nodes[0];
  const totalWeight = nodes.reduce((sum, n) => sum + n.weight, 0);
  let random = Math.random() * totalWeight;
  for (const node of nodes) {
    random -= node.weight;
    if (random <= 0) return node;
  }
  return nodes[0];
}
`;

  // JSON export
  const exportConfigJson = () => {
    const data = {
      version: '2.0',
      exportedAt: new Date().toISOString(),
      activeProvider,
      fallbackChain,
      routingPolicy,
      endpoints,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `edgeroute-universal-router-config.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (json.endpoints && Array.isArray(json.endpoints)) {
          onImportConfig(json);
        }
      } catch (err) {
        alert('Invalid JSON configuration file');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6 sm:space-y-8 pb-16 font-mono min-w-0 max-w-full overflow-hidden">
      {!compact && (<>
      {/* Header */}
      <div className="border-b border-neutral-800/80 pb-4 sm:pb-6 space-y-2 min-w-0 max-w-full overflow-hidden">
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs uppercase tracking-widest text-neutral-400">
          <span>1-CLICK INTEGRATION</span>
          <span>//</span>
          <span className="text-emerald-400 font-semibold">UNIVERSAL BASEURL PROXY</span>
          <span>//</span>
          <span>OPENAI-COMPATIBLE</span>
        </div>
        <h1 className="text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tight text-white uppercase break-words">
          SINGLE ENDPOINT &amp; CLIENT CODE
        </h1>
        <p className="text-xs sm:text-sm text-neutral-400 font-sans max-w-3xl leading-relaxed break-words">
          1 endpoint: <strong className="text-white break-all">{fullEndpoint}</strong> — Cursor, OpenCode, Python sab isi se chalega. Key har user ki alag (signup wali Gemini key).
        </p>
      </div>

      {/* Hero Proxy Endpoint & API Key Card */}
      <div className="bg-neutral-900/80 border border-neutral-700 p-3.5 sm:p-6 space-y-5 shadow-xl min-w-0 max-w-full overflow-hidden">
        {/* Row 1: Universal Base URL */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-800 pb-4 min-w-0">
          <div className="space-y-1 min-w-0 max-w-full">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-neutral-500 uppercase tracking-widest block truncate">
                1. UNIVERSAL OPENAI-COMPATIBLE BASE URL
              </span>
              <span className="text-[9px] bg-neutral-800 text-neutral-300 px-1 py-0.2 border border-neutral-700">
                GLOBAL INGRESS
              </span>
            </div>
            <div className="flex items-center gap-2 min-w-0 max-w-full">
              <Globe className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400 flex-shrink-0" />
              <code className="text-xs sm:text-sm md:text-base text-white font-bold tracking-tight sm:tracking-wide break-all min-w-0">
                {universalBaseUrl}
              </code>
            </div>
            <div className="mt-2 flex items-center gap-2 min-w-0 max-w-full">
              <code className="text-[11px] sm:text-xs text-emerald-300 break-all">POST {fullEndpoint}</code>
              <button type="button" onClick={() => copyToClipboard(fullEndpoint, 'fullendpoint')} className="text-[10px] px-2 py-1 border border-neutral-700 text-neutral-300 hover:text-white uppercase">{copiedType === 'fullendpoint' ? 'Copied' : 'Copy endpoint'}</button>
            </div>
          </div>

          <button
            onClick={() => copyToClipboard(universalBaseUrl, 'baseurl')}
            className="flex items-center justify-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 bg-neutral-100 hover:bg-white text-neutral-950 font-bold text-xs uppercase tracking-wider transition-colors min-h-[42px] flex-shrink-0 w-full sm:w-auto"
          >
            {copiedType === 'baseurl' ? (
              <>
                <Check className="w-4 h-4 text-emerald-600" />
                <span>COPIED URL</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                <span>COPY BASE URL</span>
              </>
            )}
          </button>
        </div>

        {/* Row 2: UNIQUE master key (link + ye key bahar use karo) */}
        <div className="border-b border-neutral-800 pb-4 space-y-3 min-w-0 max-w-full">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-neutral-500 uppercase tracking-widest block truncate">
                2. TUMHARI UNIQUE MASTER KEY
              </span>
              <span className="text-[9px] bg-emerald-950/60 text-emerald-400 border border-emerald-800/80 px-1.5 py-0.5 font-bold">
                {masterKey ? (masterStale ? 'STALE — REGENERATE' : 'ACTIVE') : 'NOT GENERATED'}
              </span>
            </div>
            {masterExpiryText && (
              <span className="text-[10px] text-neutral-500">expiry: {masterExpiryText}</span>
            )}
          </div>

          {masterStale && (
            <div className="p-2.5 bg-amber-950/60 border border-amber-800/60 text-amber-300 text-[11px] font-sans">
              Pools badal gayi hai (key add/remove) — ye master purani pools pe chalegi. Regenerate karo.
            </div>
          )}
          {masterMsg && (
            <div className="p-2.5 bg-neutral-950 border border-neutral-700 text-neutral-300 text-[11px] font-sans break-words">
              {masterMsg}
            </div>
          )}

          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2.5 bg-neutral-950 p-2.5 sm:p-3 border border-neutral-800">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <Key className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <code className="text-xs sm:text-sm text-neutral-200 font-mono font-bold tracking-wide break-all select-all">
                  {proxyApiKey ? (showApiKey ? proxyApiKey : `${proxyApiKey.substring(0, 12)}••••••••••••••••••••`) : 'Generate dabao — har user ki alag key banegi'}
                </code>
              </div>
            </div>

            {/* Row 3: Provider ID — jaha ID dalni ho, yahi dalo */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-neutral-950 p-2.5 sm:p-3 border border-neutral-800">
              <div className="min-w-0">
                <span className="text-[10px] text-neutral-500 uppercase tracking-widest block">
                  3. PROVIDER ID (jaha mange, yahi dalo)
                </span>
                <code className="text-xs sm:text-sm text-emerald-300 font-mono font-bold tracking-wide break-all select-all">
                  Edge Router
                </code>
              </div>
              <button
                type="button"
                onClick={() => copyToClipboard('Edge Router', 'providerid')}
                className="flex items-center justify-center gap-1 px-3 py-1.5 bg-neutral-100 hover:bg-white text-neutral-950 font-bold text-xs font-mono uppercase tracking-wider transition-colors flex-shrink-0 w-full sm:w-auto"
              >
                {copiedType === 'providerid' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span>COPIED ID</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>COPY ID</span>
                  </>
                )}
              </button>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap flex-shrink-0">
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                title={showApiKey ? "Hide key" : "Show full key"}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 hover:text-white border border-neutral-750 text-xs font-mono transition-colors"
              >
                {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                <span>{showApiKey ? "HIDE" : "SHOW"}</span>
              </button>
              <button
                type="button"
                onClick={() => copyToClipboard(proxyApiKey, 'proxykey')}
                className="flex items-center gap-1 px-3 py-1.5 bg-neutral-100 hover:bg-white text-neutral-950 font-bold text-xs font-mono uppercase tracking-wider transition-colors"
              >
                {copiedType === 'proxykey' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span>COPIED KEY</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>COPY KEY</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={masterBusy}
              onClick={() => handleGenerateMaster(masterMeta?.label || 'web')}
              className="flex items-center gap-1 px-3 py-1.5 bg-emerald-400 hover:bg-emerald-300 disabled:opacity-50 text-neutral-950 font-bold text-xs font-mono uppercase transition-colors"
            >
              <Key className="w-3.5 h-3.5" />
              <span>{masterBusy ? 'WAIT...' : masterKey ? 'REGENERATE' : 'GENERATE MY KEY'}</span>
            </button>
            {masterKey && (
              <button
                type="button"
                disabled={masterBusy}
                onClick={handleDeleteMaster}
                title="Revoke + app se hatao"
                className="flex items-center gap-1 px-3 py-1.5 bg-neutral-900 hover:bg-rose-950/60 text-neutral-300 hover:text-rose-300 border border-neutral-700 hover:border-rose-800/60 disabled:opacity-50 text-xs font-mono uppercase transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>DELETE</span>
              </button>
            )}
          </div>

          <p className="text-[11px] text-neutral-400 font-sans leading-relaxed">
            Upar wala <strong>link</strong> + ye <strong>master key</strong> bahar (Python/OpenCode/curl) me dalo — background me tumhari saari provider keys se relay hoga. Raw provider keys kabhi share mat karo.
          </p>

          {/* 1-Click Quick Setup Helpers for Terminal / .env / Cursor */}
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 pt-1">
            <span className="text-[10px] text-neutral-500 uppercase font-mono tracking-wider">
              1-Click Setup:
            </span>
            <button
              type="button"
              onClick={() => copyToClipboard(`OPENAI_BASE_URL="${universalBaseUrl}"\nOPENAI_API_KEY="${proxyApiKey}"`, 'env_config')}
              className="flex items-center gap-1 px-2.5 py-1 bg-neutral-950 hover:bg-neutral-850 border border-neutral-800 hover:border-neutral-700 text-neutral-300 hover:text-white text-[11px] font-mono transition-colors"
            >
              {copiedType === 'env_config' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>Copy .env Snippet</span>
            </button>
            <button
              type="button"
              onClick={() => copyToClipboard(`export OPENAI_BASE_URL="${universalBaseUrl}"\nexport OPENAI_API_KEY="${proxyApiKey}"`, 'cli_export')}
              className="flex items-center gap-1 px-2.5 py-1 bg-neutral-950 hover:bg-neutral-850 border border-neutral-800 hover:border-neutral-700 text-neutral-300 hover:text-white text-[11px] font-mono transition-colors"
            >
              {copiedType === 'cli_export' ? <Check className="w-3 h-3 text-emerald-400" /> : <Terminal className="w-3 h-3" />}
              <span>Copy CLI export Command</span>
            </button>
            <button
              type="button"
              onClick={() => copyToClipboard(JSON.stringify({ "openai.baseURL": universalBaseUrl, "openai.apiKey": proxyApiKey }, null, 2), 'cursor_json')}
              className="flex items-center gap-1 px-2.5 py-1 bg-neutral-950 hover:bg-neutral-850 border border-neutral-800 hover:border-neutral-700 text-neutral-300 hover:text-white text-[11px] font-mono transition-colors"
            >
              {copiedType === 'cursor_json' ? <Check className="w-3 h-3 text-emerald-400" /> : <Code2 className="w-3 h-3" />}
              <span>Copy Cursor / VS Code JSON</span>
            </button>
          </div>
        </div>

        {/* Model Selector (single Gemini gateway) */}
        <div className="space-y-2 pt-1 min-w-0 max-w-full">
          <div className="flex items-center justify-between text-xs">
            <span className="text-neutral-400 text-[11px] uppercase">Select Gemini Model:</span>
            <span className="text-emerald-400 text-[11px]">Single gateway</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs min-w-0 max-w-full">
            {[
              {
                id: 'gemini-flash-latest',
                title: 'gemini-flash-latest',
                desc: 'Fast default (Gemini auto-route)',
              },
              {
                id: 'llama-3.3-70b-versatile',
                title: 'llama-3.3-70b-versatile',
                desc: 'Ultra-fast (Groq auto-route)',
              },
              {
                id: 'google/gemma-4-31b-it:free',
                title: 'google/gemma-4-31b-it:free',
                desc: 'Via OpenRouter auto-route',
              },
            ].map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setProxyModel(preset.id)}
                className={`p-3 text-left border transition-all ${
                  proxyModel === preset.id
                    ? 'border-emerald-500 bg-neutral-950 text-white shadow-md'
                    : 'border-neutral-800 bg-neutral-950/60 text-neutral-400 hover:text-neutral-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-xs">{preset.title}</span>
                  {proxyModel === preset.id && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                </div>
                <p className="text-[10px] text-neutral-500 font-sans mt-1 leading-snug">{preset.desc}</p>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Multi-Language Code Generator */}
      <div className="bg-neutral-900/60 border border-neutral-800 p-3.5 sm:p-6 space-y-4 min-w-0 max-w-full overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-800 pb-3 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <Terminal className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <h3 className="text-xs font-bold uppercase text-white tracking-wider truncate">
              Client Code Snippets ({selectedLanguage.toUpperCase()})
            </h3>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 min-w-0 max-w-full">
            {[
              { id: 'python', label: 'Python' },
              { id: 'node', label: 'TypeScript / Node' },
              { id: 'curl', label: 'cURL' },
              { id: 'opencode', label: 'OpenCode / Cursor' },
              { id: 'nextjs', label: 'Next.js AI SDK' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSelectedLanguage(tab.id as any)}
                className={`px-2.5 sm:px-3 py-1.5 text-[11px] sm:text-xs transition-colors ${
                  selectedLanguage === tab.id
                    ? 'bg-neutral-800 text-white font-bold border border-neutral-700'
                    : 'text-neutral-400 hover:text-white border border-transparent'
                }`}
              >
                {tab.label}
              </button>
            ))}

            <button
              onClick={() => copyToClipboard(codeSnippets[selectedLanguage], 'snippet')}
              className="flex items-center gap-1 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-750 text-neutral-200 hover:text-white border border-neutral-700 text-xs uppercase transition-colors ml-auto sm:ml-2 min-h-[34px]"
            >
              {copiedType === 'snippet' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>COPIED</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>COPY</span>
                </>
              )}
            </button>
          </div>
        </div>

        <div className="min-w-0 max-w-full overflow-hidden">
          <pre className="p-3 sm:p-4 bg-neutral-950 border border-neutral-800 text-[11px] sm:text-xs text-neutral-300 overflow-x-auto leading-relaxed max-h-[420px] max-w-full whitespace-pre">
            {codeSnippets[selectedLanguage]}
          </pre>
        </div>
      </div>

      </>)}
      {/* Lower Section: Full Edge Worker Script & Config Export */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-w-0 max-w-full">
        {/* Cloudflare Worker Script (Span 8) */}
        <div className="lg:col-span-8 bg-neutral-900/60 border border-neutral-800 p-3.5 sm:p-6 space-y-4 min-w-0 max-w-full overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-800 pb-3 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <Code2 className="w-4 h-4 text-neutral-400 flex-shrink-0" />
              <h3 className="text-xs font-bold uppercase text-white tracking-wider truncate">
                Full Edge Worker Code (With Cross-Provider Fallback)
              </h3>
            </div>
            <button
              onClick={() => copyToClipboard(workerCode, 'worker')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-750 text-neutral-200 hover:text-white border border-neutral-700 text-xs uppercase transition-colors w-fit flex-shrink-0"
            >
              {copiedType === 'worker' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>COPIED WORKER</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>COPY WORKER CODE</span>
                </>
              )}
            </button>
          </div>

          <div className="min-w-0 max-w-full overflow-hidden">
            <pre className="p-3 sm:p-3.5 bg-neutral-950 border border-neutral-800 text-[11px] sm:text-xs text-neutral-300 overflow-x-auto max-h-[400px] leading-relaxed max-w-full whitespace-pre">
              {workerCode}
            </pre>
          </div>
        </div>

        {/* Configuration Portability (Span 4) */}
        <div className="lg:col-span-4 bg-neutral-900/60 border border-neutral-800 p-3.5 sm:p-6 space-y-4 min-w-0 max-w-full overflow-hidden">
          <div className="border-b border-neutral-800 pb-3">
            <span className="text-[10px] text-neutral-500 uppercase tracking-wider">PORTABILITY</span>
            <h3 className="text-xs font-bold uppercase text-white tracking-wider mt-0.5">
              ROUTER CONFIGURATION
            </h3>
          </div>

          <p className="text-xs font-sans text-neutral-400 leading-relaxed">
            Download your full multi-provider configuration, regional nodes, quota policies, and fallback sequence as a portable JSON file.
          </p>

          <div className="space-y-2.5 pt-2">
            <button
              onClick={exportConfigJson}
              className="w-full flex items-center justify-center gap-2 py-3 bg-neutral-800 hover:bg-neutral-750 text-neutral-200 hover:text-white border border-neutral-700 text-xs uppercase tracking-wider transition-colors min-h-[44px]"
            >
              <Download className="w-3.5 h-3.5" />
              <span>EXPORT CONFIG JSON</span>
            </button>

            <label className="w-full flex items-center justify-center gap-2 py-3 bg-neutral-950 hover:bg-neutral-900 text-neutral-300 hover:text-white border border-neutral-800 hover:border-neutral-700 text-xs uppercase tracking-wider cursor-pointer transition-colors min-h-[44px]">
              <Upload className="w-3.5 h-3.5" />
              <span>IMPORT CONFIG JSON</span>
              <input
                type="file"
                accept=".json"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};
