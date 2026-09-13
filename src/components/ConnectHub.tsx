import React, { useMemo, useState } from 'react';
import {
  Sparkles, Key, Copy, Check, Eye, EyeOff, RefreshCw, Trash2, Plus, Plug, FlaskConical,
  Terminal, ChevronDown, ShieldCheck, Zap, Cpu, Globe, Braces, FileJson, Settings2,
  Cloud, Rocket, CircleCheck, CircleX, Loader2, Server, Boxes, ArrowRight, Power,
} from 'lucide-react';
import type { Endpoint, Provider, RoutingPolicy } from '../types/router';
import { UNIVERSAL_MODELS } from '../data/initialData';
import { getProviderKeys } from '../utils/providerKeys';
import {
  listCustomEndpoints, addCustomEndpoint, deleteCustomEndpoint, updateCustomEndpoint,
  setCustomEndpointTest, validateCustomEndpoint, maskEndpointKey, type CustomEndpoint,
} from '../utils/customEndpoints';
import {
  loadMaster, saveMaster, buildMasterPools, masterSigNow, isMasterStale,
  issueMaster, revokeMaster, countMasterKeys, expiryText,
} from '../utils/masterKey';
import { UPSTREAM_NAMES, UPSTREAM_IDS } from '../utils/providerKeys';
import { WorkerExporter } from './WorkerExporter';
import { notify } from '../utils/notify';

interface ConnectHubProps {
  activeProvider: Provider;
  providers: Provider[];
  endpoints: Endpoint[];
  routingPolicy: RoutingPolicy;
  fallbackChain?: string[];
  onImportConfig: (data: { providers?: Provider[]; endpoints?: Endpoint[] }) => void;
  userGeminiKey?: string;
}

type ClientId = 'claude-code' | 'opencode' | 'cline' | 'continue' | 'cursor' | 'curl' | 'python' | 'node';

const CLIENTS: { id: ClientId; label: string; icon: React.ReactNode; blurb: string }[] = [
  { id: 'claude-code', label: 'Claude Code', icon: <Terminal className="w-4 h-4" />, blurb: 'Anthropic-native API — tools + streaming' },
  { id: 'opencode', label: 'OpenCode', icon: <Boxes className="w-4 h-4" />, blurb: 'opencode.json custom provider' },
  { id: 'cline', label: 'Cline', icon: <Plug className="w-4 h-4" />, blurb: 'OpenAI-Compatible mode' },
  { id: 'continue', label: 'Continue', icon: <Settings2 className="w-4 h-4" />, blurb: 'config.yaml model block' },
  { id: 'cursor', label: 'Cursor', icon: <Cpu className="w-4 h-4" />, blurb: 'Override OpenAI base URL' },
  { id: 'curl', label: 'cURL', icon: <Terminal className="w-4 h-4" />, blurb: 'Raw HTTP, any terminal' },
  { id: 'python', label: 'Python', icon: <Braces className="w-4 h-4" />, blurb: 'OpenAI SDK, 6 lines' },
  { id: 'node', label: 'Node.js', icon: <FileJson className="w-4 h-4" />, blurb: 'OpenAI SDK + Vercel AI SDK' },
];

const DISPLAY = { fontFamily: 'Syne, "Plus Jakarta Sans", sans-serif' } as const;

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

export const ConnectHub: React.FC<ConnectHubProps> = ({
  activeProvider, providers, endpoints, routingPolicy, fallbackChain = [], onImportConfig, userGeminiKey = '',
}) => {
  const [{ key: masterKey, meta: masterMeta }, setMaster] = useState(loadMaster);
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [label, setLabel] = useState(masterMeta?.label || 'my-cli');
  const [copied, setCopied] = useState<string | null>(null);
  const [client, setClient] = useState<ClientId>('claude-code');
  const [model, setModel] = useState('gemini-flash-latest');
  const [customModelInput, setCustomModelInput] = useState('');
  const [ceTick, setCeTick] = useState(0);
  const [draft, setDraft] = useState({ name: '', baseUrl: '', key: '', model: '', tag: '' });
  const [ceError, setCeError] = useState('');
  const [testingId, setTestingId] = useState<string | null>(null);

  const customs = useMemo(() => listCustomEndpoints(), [ceTick]);
  const enabledCustoms = customs.filter((c) => c.enabled);

  const origin = useMemo(() => {
    try {
      if (typeof window !== 'undefined' && window.location?.origin?.startsWith('http')) return window.location.origin;
    } catch { /* ignore */ }
    return 'https://your-app.vercel.app';
  }, []);
  const openaiBase = `${origin}/api/v1`;
  const anthropicBase = `${origin}/api/anthropic`;
  const displayKey = masterKey || 'er1...generate-karo';

  const keyCounts = useMemo(() => {
    let total = 0;
    const per: { id: string; name: string; n: number }[] = [];
    (providers || []).forEach((p) => {
      const n = getProviderKeys(p.id).length;
      if (n > 0) { total += n; per.push({ id: p.id, name: p.name, n }); }
    });
    return { total, per };
  }, [providers, masterKey]);

  const stale = !!masterKey && isMasterStale(providers, masterMeta);
  const allModels = useMemo(() => {
    const set = new Set<string>(UNIVERSAL_MODELS);
    enabledCustoms.forEach((c) => { if (c.model) set.add(c.model); });
    return [...set];
  }, [enabledCustoms]);

  const doCopy = async (text: string, id: string) => {
    const ok = await copyText(text);
    if (ok) {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    } else {
      notify('error', 'Copy fail', 'Text select karke manually copy karo.');
    }
  };

  const handleGenerate = async () => {
    setBusy(true);
    setMsg('');
    try {
      const pools = buildMasterPools(providers || []);
      if (Object.keys(pools).length === 0) {
        setMsg('Pehle KEYS button se kam se kam 1 provider key dalo — ya neeche custom endpoint add karo.');
        notify('warn', 'Key nahi bani', 'Pools khali hai — pehle keys ya endpoint dalo.');
        return;
      }
      const data = await issueMaster(pools, label.trim() || 'my-cli');
      const sigs = masterSigNow(providers || []);
      saveMaster(data.masterKey, {
        mid: data.mid, label: data.label || label, expiresAt: data.expiresAt,
        counts: data.providers, poolsSnapshot: sigs.poolsSnapshot, customSig: sigs.customSig,
      });
      setMaster(loadMaster());
      const total = countMasterKeys(pools);
      const nCustom = pools['custom']?.length || 0;
      setMsg(`Key ban gayi ✓ — ${total} keys inside (${keyCounts.per.length} providers${nCustom ? ` + ${nCustom} custom` : ''}), 90 din valid.${data.sizeWarn ? ` ⚠️ ${data.sizeWarn}` : ''}`);
      notify('success', 'Tumhari provider key ready', `${total} keys embedded — Claude Code / OpenCode me use karo.`);
      if (data.sizeWarn) notify('warn', 'Token bada hai', data.sizeWarn);
    } catch (e: any) {
      setMsg(e?.message || 'Network error — dobara try karo.');
      notify('error', 'Generate fail', e?.message || 'Dobara try karo.');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!masterKey) return;
    setBusy(true);
    try {
      const mode = await revokeMaster(masterKey);
      saveMaster('', null);
      setMaster(loadMaster());
      if (mode === 'global') {
        setMsg('Key turant cut (global revoke) ✓ — nayi generate kar lo.');
        notify('success', 'Key revoked', 'Ye key kahin bhi kaam nahi karegi.');
      } else {
        setMsg('App se hata di. Global instant-revoke ke liye Vercel KV connect karo.');
        notify('warn', 'Key local-delete', 'Is device se hati — baanti copies expiry tak chalengi.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleAddEndpoint = () => {
    const err = validateCustomEndpoint(draft);
    if (err) { setCeError(err); return; }
    const ep = addCustomEndpoint({ ...draft, tag: draft.tag === 'auto' ? '' : draft.tag });
    setDraft({ name: '', baseUrl: '', key: '', model: '', tag: '' });
    setCeError('');
    setCeTick((t) => t + 1);
    notify('success', `Endpoint add: ${ep.name}`, 'Ab TEST dabao — phir master key Regenerate karo taaki ye andar aaye.');
  };

  const handleTestEndpoint = async (ep: CustomEndpoint) => {
    setTestingId(ep.id);
    try {
      const res = await fetch('/api/keys/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: ep.key, baseUrl: ep.baseUrl, model: ep.model }),
      });
      const data = await res.json().catch(() => null);
      const ok = !!data?.ok;
      setCustomEndpointTest(ep.id, { ok, latencyMs: data?.latencyMs ?? 0, at: Date.now(), error: ok ? undefined : (data?.error || 'fail') });
      setCeTick((t) => t + 1);
      notify(ok ? 'success' : 'error', ok ? `${ep.name} LIVE ✓ (${data?.latencyMs}ms)` : `${ep.name} fail`, ok ? `Model ${data?.model} respond kar raha hai.` : (data?.error || 'Check URL/key/model.'));
    } catch {
      setCustomEndpointTest(ep.id, { ok: false, latencyMs: 0, at: Date.now(), error: 'network' });
      setCeTick((t) => t + 1);
      notify('error', `${ep.name} fail`, 'Network error.');
    } finally {
      setTestingId(null);
    }
  };

  // ---------- client snippets ----------
  const effModel = customModelInput.trim() || model;
  const snippets: Record<ClientId, { steps: string[]; code: string; lang: string; note?: string }> = {
    'claude-code': {
      lang: 'bash',
      steps: [
        'Upar se apni provider key Generate karo (1 click)',
        'Neeche wala block terminal me paste karo',
        '`claude` likho aur Enter — tumhara provider live hai',
      ],
      code: `# ══ Tumhara provider × Claude Code ══
export ANTHROPIC_BASE_URL="${anthropicBase}"
export ANTHROPIC_API_KEY="${displayKey}"
export ANTHROPIC_MODEL="${effModel}"

# ab bas:
claude`,
      note: 'Kamaal ki baat: tumhare paas sirf Gemini/Groq/OpenRouter keys ho tab bhi Claude Code chalega — gateway auto-translate karta hai (tools + streaming samet). Asli Anthropic key (sk-ant-) ho to 1:1 native chalti hai.',
    },
    'opencode': {
      lang: 'json',
      steps: [
        'Project me `opencode.json` banao (ya existing me provider block add karo)',
        'Neeche wala block paste karo',
        '`opencode` chalao → model list me "Edge Router (mine)" select karo',
      ],
      code: `{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "edge-router": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Edge Router (mine)",
      "options": {
        "baseURL": "${openaiBase}",
        "apiKey": "${displayKey}"
      },
      "models": {
        "${effModel}": { "name": "${effModel} (via my provider)" }
      }
    }
  }
}`,
    },
    'cline': {
      lang: 'text',
      steps: [
        'Cline → Settings (⚙) → API Provider = "OpenAI Compatible"',
        'Neeche wali 3 values copy-paste karo',
        'Save → Cline tumhare provider se baat karega',
      ],
      code: `Base URL :  ${openaiBase}
API Key  :  ${displayKey}
Model ID :  ${effModel}`,
      note: 'Roo Code / Kilo Code me bhi same 3 fields — provider mode "OpenAI Compatible" rakho.',
    },
    'continue': {
      lang: 'yaml',
      steps: [
        '`~/.continue/config.yaml` kholo',
        '`models:` list me ye block add karo',
        'Continue reload karo → model picker me dikhega',
      ],
      code: `models:
  - uses: openai/chat
    with:
      OPENAI_BASE_URL: ${openaiBase}
      OPENAI_API_KEY: ${displayKey}
      OPENAI_MODEL: ${effModel}`,
    },
    'cursor': {
      lang: 'text',
      steps: [
        'Cursor → Settings → Models → "Override OpenAI Base URL"',
        'Neeche wali values dalo + apni key "OpenAI API Key" me',
        'Chat me model select karke baat karo',
      ],
      code: `Override OpenAI Base URL :  ${openaiBase}
OpenAI API Key          :  ${displayKey}
Model                   :  ${effModel}`,
    },
    'curl': {
      lang: 'bash',
      steps: ['Terminal me paste karo — 1 request, live jawab'],
      code: `curl -X POST "${openaiBase}/chat/completions" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${displayKey}" \\
  -d '{
    "model": "${effModel}",
    "messages": [
      {"role": "user", "content": "Hello from my own provider!"}
    ]
  }'`,
    },
    'python': {
      lang: 'python',
      steps: ['`pip install openai` → ye 6 lines chalao'],
      code: `from openai import OpenAI

client = OpenAI(base_url="${openaiBase}", api_key="${displayKey}")

r = client.chat.completions.create(
    model="${effModel}",
    messages=[{"role": "user", "content": "Hello from my own provider!"}],
)
print(r.choices[0].message.content)`,
    },
    'node': {
      lang: 'typescript',
      steps: ['`npm i openai` → ye snippet chalao'],
      code: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${openaiBase}",
  apiKey: "${displayKey}",
});

const r = await client.chat.completions.create({
  model: "${effModel}",
  messages: [{ role: "user", content: "Hello from my own provider!" }],
});
console.log(r.choices[0].message.content);`,
    },
  };
  const active = snippets[client];

  const stats = [
    { icon: <Server className="w-4 h-4" />, value: String(keyCounts.per.length + (enabledCustoms.length > 0 ? 1 : 0)), label: 'pools live' },
    { icon: <Key className="w-4 h-4" />, value: String(keyCounts.total + enabledCustoms.length), label: 'keys inside' },
    { icon: <Cloud className="w-4 h-4" />, value: String(enabledCustoms.length), label: 'custom endpoints' },
    { icon: <Zap className="w-4 h-4" />, value: String(allModels.length), label: 'models via 1 key' },
  ];

  return (
    <div className="relative min-w-0 max-w-full overflow-hidden pb-16 font-sans">
      {/* aurora background */}
      <div className="absolute inset-0 -z-0 overflow-hidden" aria-hidden>
        <div className="cx-aurora cx-drift-a left-[-10%] top-[-6%] h-[420px] w-[520px] bg-emerald-500/25" />
        <div className="cx-aurora cx-drift-b right-[-12%] top-[8%] h-[460px] w-[560px] bg-cyan-500/20" />
        <div className="cx-aurora cx-drift-c left-[30%] top-[42%] h-[380px] w-[480px] bg-fuchsia-500/15" />
        <div className="absolute inset-0 bg-grid-texture opacity-60" />
        <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/60 to-transparent" />
      </div>

      <div className="relative z-10 space-y-6 sm:space-y-8">
        {/* HERO */}
        <div className="cx-fade-up pt-2 text-center sm:pt-6">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300 sm:text-xs">
            <Sparkles className="h-3.5 w-3.5" />
            Your own AI provider
          </div>
          <h1 style={DISPLAY} className="mx-auto max-w-3xl text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl">
            One key. Every model. <span className="cx-gradient-text">Any app.</span>
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-xs leading-relaxed text-neutral-300 sm:text-sm">
            Apni saari provider keys + apne custom endpoints — sab ek <strong className="text-white">master key</strong> me.
            Wahi key Claude Code, OpenCode, Cline, Cursor — har jagah chalegi. Quota khatam? Gateway khud next key pe rotate karega.
          </p>
          <div className="mx-auto mt-5 grid max-w-2xl grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
            {stats.map((s) => (
              <div key={s.label} className="cx-glass cx-card-hover cx-float rounded-2xl px-3 py-3" style={{ animationDelay: `${Math.random()}s` }}>
                <div className="flex items-center justify-center gap-1.5 text-emerald-300">{s.icon}<span style={DISPLAY} className="text-xl font-extrabold text-white sm:text-2xl">{s.value}</span></div>
                <div className="mt-0.5 text-[10px] uppercase tracking-widest text-neutral-400">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* STEP 01 — API KEY */}
        <section className="cx-fade-up cx-glass rounded-3xl p-4 sm:p-7" style={{ animationDelay: '0.08s' }}>
          <div className="mb-4 flex items-center gap-3">
            <div style={DISPLAY} className="cx-gradient-text text-4xl font-extrabold sm:text-5xl">01</div>
            <div>
              <h2 style={DISPLAY} className="text-lg font-bold text-white sm:text-xl">Tumhari provider key</h2>
              <p className="text-[11px] text-neutral-400 sm:text-xs">Generate dabao → yehi key har CLI/app me chalegi. Raw provider keys kabhi bahar nahi jaati.</p>
            </div>
            <span className={`ml-auto hidden items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wider sm:inline-flex ${masterKey ? (stale ? 'border-amber-400/40 bg-amber-400/10 text-amber-300' : 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300') : 'border-neutral-600 bg-neutral-800/60 text-neutral-400'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${masterKey ? (stale ? 'bg-amber-300' : 'bg-emerald-300') : 'bg-neutral-500'}`} />
              {masterKey ? (stale ? 'Stale — regenerate' : 'Active') : 'Not generated'}
            </span>
          </div>

          {stale && (
            <div className="mb-3 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-[11px] leading-relaxed text-amber-200 sm:text-xs">
              Keys ya custom endpoints badal gaye hai — ye key purani pools pe chal rahi hai. <strong>Regenerate</strong> dabao taaki sab kuch andar aaye.
            </div>
          )}
          {msg && (
            <div className="mb-3 rounded-xl border border-white/10 bg-black/40 p-3 text-[11px] leading-relaxed text-neutral-200 sm:text-xs">{msg}</div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Key ka naam (jaise my-macbook)"
              maxLength={40}
              className="w-full rounded-xl border border-white/10 bg-black/50 px-3.5 py-2.5 text-xs text-white placeholder-neutral-500 outline-none focus:border-emerald-400/60 sm:w-56"
            />
            <button
              type="button"
              disabled={busy}
              onClick={handleGenerate}
              className="cx-glow-btn cx-shimmer inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 px-6 py-2.5 text-xs font-extrabold uppercase tracking-wider text-neutral-950 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : masterKey ? <RefreshCw className="h-4 w-4" /> : <Key className="h-4 w-4" />}
              {busy ? 'Wait...' : masterKey ? 'Regenerate key' : 'Generate my key'}
            </button>
            {masterKey && (
              <button
                type="button"
                disabled={busy}
                onClick={handleDelete}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/40 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-neutral-300 transition-colors hover:border-rose-500/50 hover:text-rose-300 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            )}
          </div>

          <div className="cx-code mt-3 rounded-2xl p-3 sm:p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <div className="cx-pulse-ring hidden h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-500 sm:flex">
                  <Key className="h-4 w-4 text-neutral-950" />
                </div>
                <code className="min-w-0 flex-1 break-all font-mono text-[11px] font-bold leading-relaxed text-emerald-200 sm:text-xs">
                  {masterKey ? (showKey ? masterKey : `${masterKey.slice(0, 18)}••••••••••••••••••••••••••••••••`) : 'Generate dabao — har user ki alag, encrypted, 90-din key banegi'}
                </code>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1.5">
                <button type="button" onClick={() => setShowKey(!showKey)} className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-[11px] font-bold uppercase text-neutral-300 transition-colors hover:bg-white/10 hover:text-white">
                  {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} {showKey ? 'Hide' : 'Show'}
                </button>
                <button type="button" onClick={() => masterKey && doCopy(masterKey, 'master')} className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-2 font-mono text-[11px] font-extrabold uppercase text-neutral-950 transition-transform hover:scale-[1.03]">
                  {copied === 'master' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />} {copied === 'master' ? 'Copied' : 'Copy key'}
                </button>
              </div>
            </div>
            {(masterMeta?.expiresAt || keyCounts.total > 0 || enabledCustoms.length > 0) && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-white/5 pt-3">
                {masterMeta?.expiresAt && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-neutral-300">
                    <ShieldCheck className="h-3 w-3 text-emerald-300" /> expiry {expiryText(masterMeta.expiresAt)}
                  </span>
                )}
                {keyCounts.per.map((p) => (
                  <span key={p.id} className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-bold text-emerald-200">{p.name} × {p.n}</span>
                ))}
                {enabledCustoms.length > 0 && (
                  <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-[10px] font-bold text-cyan-200">custom × {enabledCustoms.length}</span>
                )}
              </div>
            )}
          </div>

          {/* endpoint URLs */}
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {[
              { tag: 'OPENAI API (OpenCode, Cline, SDKs)', url: openaiBase, id: 'oai' },
              { tag: 'ANTHROPIC API (Claude Code)', url: anthropicBase, id: 'anth' },
            ].map((e) => (
              <div key={e.id} className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/40 px-3 py-2.5">
                <Globe className="h-3.5 w-3.5 flex-shrink-0 text-cyan-300" />
                <div className="min-w-0 flex-1">
                  <div className="text-[9px] font-bold uppercase tracking-widest text-neutral-500">{e.tag}</div>
                  <code className="block truncate font-mono text-[11px] font-bold text-white sm:text-xs">{e.url}</code>
                </div>
                <button type="button" onClick={() => doCopy(e.url, e.id)} className="flex-shrink-0 rounded-lg border border-white/10 bg-white/5 p-2 text-neutral-300 transition-colors hover:bg-white/10 hover:text-white">
                  {copied === e.id ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* STEP 02 — CONNECT */}
        <section className="cx-fade-up cx-glass rounded-3xl p-4 sm:p-7" style={{ animationDelay: '0.14s' }}>
          <div className="mb-4 flex items-center gap-3">
            <div style={DISPLAY} className="cx-gradient-text text-4xl font-extrabold sm:text-5xl">02</div>
            <div>
              <h2 style={DISPLAY} className="text-lg font-bold text-white sm:text-xl">Connect anything in 30 seconds</h2>
              <p className="text-[11px] text-neutral-400 sm:text-xs">Apna tool chuno → model chuno → copy-paste → done. Snippets me tumhari key + URLs pehle se bhari hai.</p>
            </div>
          </div>

          {/* model picker */}
          <div className="mb-3 flex flex-col gap-2 rounded-2xl border border-white/10 bg-black/40 p-3 sm:flex-row sm:items-center">
            <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-widest text-neutral-400">Model for snippets:</span>
            <select
              value={customModelInput ? '__custom' : model}
              onChange={(e) => { if (e.target.value === '__custom') { setCustomModelInput('my-model'); } else { setCustomModelInput(''); setModel(e.target.value); } }}
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 font-mono text-xs text-white outline-none focus:border-emerald-400/60"
            >
              {allModels.map((m) => (<option key={m} value={m}>{m}</option>))}
              <option value="__custom">✎ custom model id...</option>
            </select>
            {customModelInput !== '' && (
              <input
                value={customModelInput}
                onChange={(e) => setCustomModelInput(e.target.value)}
                placeholder="exact model id"
                className="min-w-0 flex-1 rounded-lg border border-emerald-400/40 bg-neutral-900 px-3 py-2 font-mono text-xs text-white outline-none"
              />
            )}
          </div>

          {/* client tabs */}
          <div className="mb-3 flex flex-wrap gap-1.5">
            {CLIENTS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setClient(c.id)}
                title={c.blurb}
                className={`inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-[11px] font-bold text-neutral-300 transition-all hover:border-white/25 hover:text-white sm:text-xs ${client === c.id ? 'cx-tab-active' : ''}`}
              >
                {c.icon} {c.label}
              </button>
            ))}
          </div>

          <div className="grid gap-3 lg:grid-cols-5">
            <div className="space-y-2 lg:col-span-2">
              {active.steps.map((s, i) => (
                <div key={i} className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-black/30 p-3">
                  <div style={DISPLAY} className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500 text-xs font-extrabold text-neutral-950">{i + 1}</div>
                  <p className="text-[11px] leading-relaxed text-neutral-200 sm:text-xs">{s}</p>
                </div>
              ))}
              {active.note && (
                <div className="rounded-xl border border-cyan-400/25 bg-cyan-400/5 p-3 text-[11px] leading-relaxed text-cyan-100/90">{active.note}</div>
              )}
            </div>
            <div className="lg:col-span-3">
              <div className="cx-code overflow-hidden rounded-2xl">
                <div className="flex items-center justify-between border-b border-white/5 px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-rose-400/80" /><span className="h-2.5 w-2.5 rounded-full bg-amber-300/80" /><span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
                    <span className="ml-2 font-mono text-[10px] uppercase tracking-widest text-neutral-500">{CLIENTS.find((c) => c.id === client)?.label} · {active.lang}</span>
                  </div>
                  <button type="button" onClick={() => doCopy(active.code, `snip-${client}`)} className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 font-mono text-[10px] font-extrabold uppercase text-neutral-950 transition-transform hover:scale-[1.04]">
                    {copied === `snip-${client}` ? <><Check className="h-3.5 w-3.5 text-emerald-600" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
                  </button>
                </div>
                <pre className="max-h-[380px] overflow-auto whitespace-pre p-3.5 font-mono text-[11px] leading-relaxed text-neutral-200 sm:text-xs">{active.code}</pre>
              </div>
            </div>
          </div>
        </section>

        {/* STEP 03 — CUSTOM ENDPOINTS */}
        <section className="cx-fade-up cx-glass rounded-3xl p-4 sm:p-7" style={{ animationDelay: '0.2s' }}>
          <div className="mb-4 flex items-center gap-3">
            <div style={DISPLAY} className="cx-gradient-text text-4xl font-extrabold sm:text-5xl">03</div>
            <div className="min-w-0">
              <h2 style={DISPLAY} className="text-lg font-bold text-white sm:text-xl">Apne custom configs add karo</h2>
              <p className="text-[11px] text-neutral-400 sm:text-xs">Apna vLLM, LiteLLM, RunPod, ya koi bhi OpenAI-compatible endpoint — key + model ke saath. Master key me embed hokar har jagah chalega.</p>
            </div>
          </div>

          {/* add form */}
          <div className="rounded-2xl border border-white/10 bg-black/40 p-3 sm:p-4">
            <div className="grid gap-2 md:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-neutral-400">Naam</span>
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder='Jaise "My RunPod vLLM"' maxLength={60} className="w-full rounded-xl border border-white/10 bg-neutral-900/80 px-3 py-2.5 text-xs text-white placeholder-neutral-600 outline-none focus:border-emerald-400/60" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-neutral-400">Base URL (https, /v1 samet)</span>
                <input value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} placeholder="https://my-proxy.com/v1" inputMode="url" className="w-full rounded-xl border border-white/10 bg-neutral-900/80 px-3 py-2.5 font-mono text-xs text-white placeholder-neutral-600 outline-none focus:border-emerald-400/60" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-neutral-400">API key</span>
                <input value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value })} placeholder="Is endpoint ki key" type="password" className="w-full rounded-xl border border-white/10 bg-neutral-900/80 px-3 py-2.5 font-mono text-xs text-white placeholder-neutral-600 outline-none focus:border-emerald-400/60" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-neutral-400">Model id (is endpoint pe kya chalega)</span>
                <input value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} placeholder="meta-llama/Llama-3.3-70B-Instruct" className="w-full rounded-xl border border-white/10 bg-neutral-900/80 px-3 py-2.5 font-mono text-xs text-white placeholder-neutral-600 outline-none focus:border-emerald-400/60" />
              </label>
            </div>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <select value={draft.tag || 'auto'} onChange={(e) => setDraft({ ...draft, tag: e.target.value })} title="Optional provider tag — routing hint ke liye" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-neutral-900/80 px-3 py-2.5 text-xs text-neutral-200 outline-none focus:border-emerald-400/60">
                <option value="auto">Provider tag: auto (zaroori nahi)</option>
                {UPSTREAM_IDS.map((u) => (<option key={u} value={u}>{UPSTREAM_NAMES[u]}</option>))}
              </select>
              <button type="button" onClick={handleAddEndpoint} className="cx-glow-btn inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-400 via-purple-400 to-cyan-400 px-6 py-2.5 text-xs font-extrabold uppercase tracking-wider text-neutral-950">
                <Plus className="h-4 w-4" /> Add endpoint
              </button>
            </div>
            {ceError && <div className="mt-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5 text-[11px] text-rose-200">{ceError}</div>}
            <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">Add karne ke baad <strong className="text-neutral-300">TEST</strong> dabao — green aaye to master key <strong className="text-neutral-300">Regenerate</strong> karo, endpoint andar aa jayega aur Tester + sab CLIs me chalega.</p>
          </div>

          {/* cards */}
          {customs.length === 0 ? (
            <div className="mt-3 rounded-2xl border border-dashed border-white/15 bg-black/20 p-6 text-center">
              <Cloud className="mx-auto h-6 w-6 text-neutral-600" />
              <p className="mt-2 text-xs text-neutral-400">Abhi koi custom endpoint nahi — upar form se pehla add karo. Apna proxy, apne rules.</p>
            </div>
          ) : (
            <div className="mt-3 grid gap-2.5 md:grid-cols-2">
              {customs.map((ep, idx) => (
                <div key={ep.id} className={`cx-card-hover cx-fade-up rounded-2xl border p-3.5 sm:p-4 ${ep.enabled ? 'border-white/10 bg-black/40' : 'border-white/5 bg-black/20 opacity-60'}`} style={{ animationDelay: `${idx * 0.05}s` }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 flex-shrink-0 rounded-full ${!ep.lastTest ? 'bg-neutral-600' : ep.lastTest.ok ? 'bg-emerald-400' : 'bg-rose-500'}`} />
                        <h3 className="truncate text-sm font-bold text-white">{ep.name}</h3>
                      </div>
                      <code className="mt-1 block truncate font-mono text-[10px] text-cyan-300/90">{ep.baseUrl}</code>
                      <code className="mt-0.5 block truncate font-mono text-[10px] text-neutral-400">model: <span className="text-neutral-200">{ep.model}</span> · key: {maskEndpointKey(ep.key)}{ep.tag ? ` · ${UPSTREAM_NAMES[ep.tag] || ep.tag}` : ''}</code>
                    </div>
                    <button type="button" title={ep.enabled ? 'Disable (master se bahar)' : 'Enable'} onClick={() => { updateCustomEndpoint(ep.id, { enabled: !ep.enabled }); setCeTick((t) => t + 1); }} className={`flex-shrink-0 rounded-lg border p-2 transition-colors ${ep.enabled ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20' : 'border-white/10 bg-white/5 text-neutral-500 hover:text-neutral-300'}`}>
                      <Power className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {ep.lastTest && (
                    <div className={`mt-2 flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[10px] ${ep.lastTest.ok ? 'border-emerald-400/25 bg-emerald-400/5 text-emerald-200' : 'border-rose-500/25 bg-rose-500/5 text-rose-200'}`}>
                      {ep.lastTest.ok ? <CircleCheck className="h-3.5 w-3.5 flex-shrink-0" /> : <CircleX className="h-3.5 w-3.5 flex-shrink-0" />}
                      <span className="truncate">{ep.lastTest.ok ? `LIVE ✓ ${ep.lastTest.latencyMs}ms` : `FAIL — ${(ep.lastTest.error || '').slice(0, 120)}`}</span>
                    </div>
                  )}
                  <div className="mt-2.5 flex items-center gap-1.5">
                    <button type="button" disabled={testingId === ep.id} onClick={() => handleTestEndpoint(ep)} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white px-3 py-2 font-mono text-[11px] font-extrabold uppercase text-neutral-950 transition-transform hover:scale-[1.02] disabled:opacity-50">
                      {testingId === ep.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />} {testingId === ep.id ? 'Testing...' : 'Test'}
                    </button>
                    <button type="button" onClick={() => { deleteCustomEndpoint(ep.id); setCeTick((t) => t + 1); notify('warn', `Endpoint hataya: ${ep.name}`, 'Master key Regenerate karo taaki bahar ho jaye.'); }} title="Delete endpoint" className="rounded-lg border border-white/10 bg-white/5 p-2 text-neutral-400 transition-colors hover:border-rose-500/40 hover:text-rose-300">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* STEP 04 — SELF HOST (WorkerExporter, compact) */}
        <section className="cx-fade-up cx-glass rounded-3xl p-4 sm:p-7" style={{ animationDelay: '0.24s' }}>
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
              <div style={DISPLAY} className="cx-gradient-text text-4xl font-extrabold sm:text-5xl">04</div>
              <div className="min-w-0 flex-1">
                <h2 style={DISPLAY} className="flex items-center gap-2 text-lg font-bold text-white sm:text-xl">
                  <Rocket className="h-4 w-4 text-fuchsia-300" /> Self-host: Cloudflare Worker + config
                </h2>
                <p className="text-[11px] text-neutral-400 sm:text-xs">Advanced — poora router apne Cloudflare Worker pe deploy karo, ya config JSON le jao. (Click karke kholo)</p>
              </div>
              <ChevronDown className="h-5 w-5 flex-shrink-0 text-neutral-400 transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-4 border-t border-white/10 pt-4">
              <WorkerExporter
                activeProvider={activeProvider}
                providers={providers}
                endpoints={endpoints}
                routingPolicy={routingPolicy}
                fallbackChain={fallbackChain}
                onImportConfig={onImportConfig}
                userGeminiKey={userGeminiKey}
                compact
              />
            </div>
          </details>
        </section>

        {/* footer strip */}
        <div className="cx-fade-up flex flex-col items-center gap-2 text-center" style={{ animationDelay: '0.28s' }}>
          <div className="inline-flex items-center gap-2 text-[11px] text-neutral-400">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" />
            Master key AES-256-GCM encrypted · raw provider keys device se bahar kabhi nahi jaati
            <ArrowRight className="h-3.5 w-3.5" />
          </div>
        </div>
      </div>
    </div>
  );
};
