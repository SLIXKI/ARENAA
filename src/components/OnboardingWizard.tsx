import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles, KeyRound, ShieldCheck, Zap, ArrowRight, ArrowLeft, Check, X,
  Loader2, Rocket, Plug, Terminal, Radar, AlertTriangle, PartyPopper, Globe,
} from 'lucide-react';
import {
  detectKeyUpstream, UPSTREAM_NAMES, UPSTREAM_IDS, isKnownUpstream, maskKey,
} from '../utils/providerKeys';

export interface OnboardingKeyResult {
  key: string;
  upstream: string;
  label: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
}

interface OnboardingWizardProps {
  /** Persist a key. Returns { ok, error } so the wizard can explain failures. */
  onAddKey: (key: string, upstreamTag?: string) => { ok: boolean; error?: string };
  /** Inject the free, no-signup Pollinations key. */
  onAddFreeTier: () => { ok: boolean; error?: string };
  onComplete: () => void;
  onSkip: () => void;
  existingKeyCount: number;
}

const STEPS = ['Welcome', 'Add a key', 'Verify', 'Ready'] as const;

/** Extract a key from pasted noise (env lines, curl commands, quotes). */
function extractKey(raw: string): string {
  if (!raw) return '';
  const cleaned = raw.trim();
  const patterns = [
    /(?:api[_-]?key|token|key)\s*[:=]\s*["']?([A-Za-z0-9_\-\.]{16,})["']?/i,
    /(?:Bearer|x-api-key)\s+([A-Za-z0-9_\-\.]{16,})/i,
    /(["'])([A-Za-z0-9_\-\.]{16,})\1/,
    /\b([A-Za-z0-9_\-\.]{20,})\b/,
  ];
  for (const re of patterns) {
    const m = cleaned.match(re);
    if (m) return (m[2] || m[1] || '').replace(/[\s'"`]+/g, '');
  }
  return cleaned.replace(/[\s'"`]+/g, '');
}

/**
 * First-run experience.
 *
 * A brand-new visitor used to land on a dense operator console full of simulated
 * telemetry with no keys, no idea what the product does, and no obvious first
 * action. This walks them from zero to a verified, working key in under a minute —
 * including a genuinely free path that needs no signup at all.
 */
export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({
  onAddKey, onAddFreeTier, onComplete, onSkip, existingKeyCount,
}) => {
  const [step, setStep] = useState(0);
  const [raw, setRaw] = useState('');
  const [error, setError] = useState('');
  const [added, setAdded] = useState<{ key: string; upstream: string; label: string }[]>([]);
  const [tagOverride, setTagOverride] = useState('');
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState<OnboardingKeyResult[]>([]);
  const [freeBusy, setFreeBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === 1) inputRef.current?.focus();
  }, [step]);

  const detected = useMemo(() => {
    const k = extractKey(raw);
    if (k.length < 10) return null;
    const id = detectKeyUpstream(k);
    return { key: k, id, label: isKnownUpstream(id) ? UPSTREAM_NAMES[id] || id : null };
  }, [raw]);

  const effectiveUpstream = tagOverride || detected?.id || '';

  const handleAdd = useCallback(() => {
    setError('');
    if (!detected) { setError('Paste a full API key — it looks too short.'); return; }
    const res = onAddKey(detected.key, effectiveUpstream && isKnownUpstream(effectiveUpstream) ? effectiveUpstream : undefined);
    if (!res.ok) { setError(res.error || 'Could not save that key.'); return; }
    setAdded((prev) => [
      ...prev.filter((a) => a.key !== detected.key),
      { key: detected.key, upstream: effectiveUpstream, label: detected.label || UPSTREAM_NAMES[effectiveUpstream] || 'Provider' },
    ]);
    setRaw(''); setTagOverride('');
  }, [detected, effectiveUpstream, onAddKey]);

  const handleFree = useCallback(async () => {
    setFreeBusy(true); setError('');
    const res = onAddFreeTier();
    setFreeBusy(false);
    if (!res.ok) { setError(res.error || 'Could not add the free key.'); return; }
    setAdded((prev) => [...prev.filter((a) => a.upstream !== 'prov-pollinations'), {
      key: 'pollinations-free-tier', upstream: 'prov-pollinations', label: 'Pollinations (free)',
    }]);
    setStep(2);
  }, [onAddFreeTier]);

  const handleVerify = useCallback(async () => {
    const targets = added.length > 0 ? added : [];
    if (targets.length === 0) { setStep(3); return; }
    setTesting(true);
    setResults([]);
    const out: OnboardingKeyResult[] = [];
    for (const t of targets) {
      const started = performance.now();
      let ok = false; let err = '';
      try {
        const r = await fetch('/api/keys/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: t.key, upstream: isKnownUpstream(t.upstream) ? t.upstream : '' }),
        });
        const j = await r.json().catch(() => null);
        ok = !!j?.ok;
        err = ok ? '' : String(j?.error || `HTTP ${r.status}`);
      } catch (e: any) {
        err = e?.message || 'network error';
      }
      out.push({ key: t.key, upstream: t.upstream, label: t.label, ok, latencyMs: Math.round(performance.now() - started), error: err });
      setResults([...out]);
      // Sequential with a small gap: keeps results appearing progressively as each
      // key resolves, and avoids opening dozens of simultaneous sockets to the same
      // upstream at once. This gateway does not rate-limit you - the gap is purely
      // for readable progress and politeness to the provider.
      await new Promise((r) => setTimeout(r, 350));
    }
    setTesting(false);
  }, [added]);

  const anyWorking = results.some((r) => r.ok);
  const totalKeys = existingKeyCount + added.length;

  return (
    <div className="fixed inset-0 z-[90] flex items-stretch justify-center overflow-y-auto bg-[#05070a]/92 backdrop-blur-md ui-modal-scroll sm:items-center sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Getting started"
        className="ui-modal-card ui-rise relative my-auto flex w-full max-w-2xl flex-col overflow-hidden rounded-none border border-white/10 bg-[#0b0e14] shadow-[0_40px_120px_-30px_rgba(0,0,0,0.95)] sm:rounded-[22px]"
      >
        {/* ambient wash */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="cx-aurora cx-drift-a h-64 w-64 bg-emerald-500/22 -left-16 -top-20" />
          <div className="cx-aurora cx-drift-b h-56 w-56 bg-cyan-500/18 -right-12 top-24" />
        </div>

        {/* header */}
        <div className="relative flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4 sm:px-7">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-500 text-[#04150e] shadow-[0_6px_20px_-6px_rgba(52,211,153,0.9)]">
              <Rocket className="h-4 w-4" strokeWidth={2.6} />
            </span>
            <div className="min-w-0">
              <p className="ui-eyebrow">Edge AI Router</p>
              <p className="truncate text-sm font-bold text-white">Get set up in under a minute</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onSkip}
            className="ui-btn ui-btn-ghost ui-btn-sm flex-none"
            aria-label="Skip setup"
          >
            <X className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Skip</span>
          </button>
        </div>

        {/* progress */}
        <div className="relative px-5 pt-4 sm:px-7">
          <ol className="flex items-center gap-1.5" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
            {STEPS.map((label, i) => (
              <li key={label} className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span
                  className={`ui-bar h-1.5 rounded-full transition-all duration-300 ${
                    i < step ? 'bg-emerald-400/70' : i === step ? 'ui-bar-grad' : 'bg-white/10'
                  }`}
                />
                <span className={`truncate text-[9.5px] font-bold uppercase tracking-[0.09em] ${i === step ? 'text-emerald-300' : 'text-neutral-600'}`}>
                  {label}
                </span>
              </li>
            ))}
          </ol>
        </div>

        {/* body */}
        <div className="relative flex-1 px-5 py-5 sm:px-7 sm:py-6">
          {/* ---------------- STEP 0 — welcome ---------------- */}
          {step === 0 && (
            <div className="ui-rise space-y-5">
              <div>
                <h2 className="ui-h1 text-white">
                  One key. <span className="ui-grad-text">Every AI provider.</span>
                </h2>
                <p className="mt-2.5 text-sm leading-relaxed text-neutral-400">
                  Edge AI Router puts <strong className="font-semibold text-neutral-200">27 AI providers</strong> behind a
                  single OpenAI-compatible URL and a single Anthropic-compatible URL. Your keys never leave your browser —
                  they are packed into one encrypted <code className="rounded bg-white/8 px-1.5 py-0.5 font-mono text-[12px] text-emerald-300">er1…</code> token
                  that you paste into Claude Code, Cursor, Cline or your own app.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  { Icon: Zap, t: 'Auto failover', d: 'A 429 or dead key rotates to the next one automatically.' },
                  { Icon: ShieldCheck, t: 'Keys stay local', d: 'No database, no server-side storage. Ever.' },
                  { Icon: Globe, t: '27 providers', d: 'Gemini, Groq, OpenAI, Anthropic, DeepSeek, xAI and more.' },
                ].map(({ Icon, t, d }) => (
                  <div key={t} className="ui-card p-3.5">
                    <Icon className="h-4 w-4 text-emerald-400" strokeWidth={2.2} />
                    <p className="mt-2 text-[13px] font-bold text-white">{t}</p>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-neutral-500">{d}</p>
                  </div>
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={handleFree}
                  disabled={freeBusy}
                  className="ui-card ui-card-hover group flex items-start gap-3 p-4 text-left disabled:opacity-60"
                >
                  <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-400/30">
                    {freeBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-bold text-white">Start free, right now</span>
                      <span className="ui-badge ui-badge-success">No signup</span>
                    </span>
                    <span className="mt-1 block text-[12px] leading-relaxed text-neutral-400">
                      Adds a free Pollinations key so you can send your first request immediately, then swap in your own keys later.
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="ui-card ui-card-hover group flex items-start gap-3 p-4 text-left"
                >
                  <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-cyan-400/15 text-cyan-300 ring-1 ring-cyan-400/30">
                    <KeyRound className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-bold text-white">I have API keys</span>
                      <span className="ui-badge ui-badge-info">Recommended</span>
                    </span>
                    <span className="mt-1 block text-[12px] leading-relaxed text-neutral-400">
                      Paste one or more provider keys. We detect the provider from the prefix and verify each one live.
                    </span>
                  </span>
                </button>
              </div>

              {existingKeyCount > 0 && (
                <p className="ui-hint flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  You already have {existingKeyCount} key{existingKeyCount === 1 ? '' : 's'} saved — you can skip this.
                </p>
              )}
            </div>
          )}

          {/* ---------------- STEP 1 — add keys ---------------- */}
          {step === 1 && (
            <div className="ui-rise space-y-4">
              <div>
                <h2 className="ui-h2 text-white">Paste a provider key</h2>
                <p className="mt-1.5 text-[13px] leading-relaxed text-neutral-400">
                  We detect the provider from the key prefix automatically. Keys are stored only in this browser.
                </p>
              </div>

              <div>
                <label className="ui-label" htmlFor="ob-key">API key</label>
                <div className="relative">
                  <input
                    id="ob-key"
                    ref={inputRef}
                    type="text"
                    inputMode="text"
                    autoComplete="off"
                    spellCheck={false}
                    className="ui-input pr-11 font-mono text-[13px]"
                    placeholder="AIza… · gsk_… · sk-or-… · sk-ant-… · sk-proj-…"
                    value={raw}
                    onChange={(e) => { setRaw(e.target.value); setError(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
                  />
                  {detected?.label && (
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
                      <span className="ui-badge ui-badge-success">{detected.label}</span>
                    </span>
                  )}
                </div>

                {detected && !detected.label && (
                  <div className="mt-2.5">
                    <label className="ui-label" htmlFor="ob-tag">
                      Which provider is this? <span className="normal-case tracking-normal text-neutral-500">(prefix was ambiguous)</span>
                    </label>
                    <select id="ob-tag" className="ui-select" value={tagOverride} onChange={(e) => setTagOverride(e.target.value)}>
                      <option value="">— select a provider —</option>
                      {UPSTREAM_IDS.map((id) => (
                        <option key={id} value={id}>{UPSTREAM_NAMES[id] || id}</option>
                      ))}
                    </select>
                  </div>
                )}

                {detected?.label && (
                  <p className="ui-hint mt-2 flex items-center gap-1.5">
                    <Check className="h-3.5 w-3.5 flex-none text-emerald-400" />
                    Detected <strong className="font-semibold text-emerald-300">{detected.label}</strong> — {maskKey(detected.key)}
                  </p>
                )}
                {error && (
                  <p className="mt-2 flex items-start gap-1.5 text-[12.5px] font-medium text-rose-300">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" /> {error}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <button type="button" className="ui-btn ui-btn-primary" onClick={handleAdd} disabled={!detected}>
                  <Check className="h-4 w-4" /> Add key
                </button>
                <button type="button" className="ui-btn ui-btn-ghost" onClick={handleFree} disabled={freeBusy}>
                  {freeBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Use the free key instead
                </button>
              </div>

              {added.length > 0 && (
                <div className="ui-inset divide-y divide-white/6">
                  <p className="ui-eyebrow px-3.5 pt-3">Added ({added.length})</p>
                  <ul className="max-h-44 overflow-y-auto px-1.5 py-1.5">
                    {added.map((a) => (
                      <li key={a.key} className="flex items-center gap-2.5 rounded-lg px-2 py-2">
                        <span className="ui-dot bg-emerald-400 text-emerald-400" />
                        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-neutral-300">{maskKey(a.key)}</span>
                        <span className="ui-badge flex-none">{a.label}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${a.label}`}
                          className="rounded-md p-1 text-neutral-500 transition-colors hover:bg-white/8 hover:text-rose-300"
                          onClick={() => setAdded((prev) => prev.filter((x) => x.key !== a.key))}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="ui-hint">
                Add as many as you like — up to 30 per provider. More keys means better rate-limit coverage and automatic rotation.
              </p>
            </div>
          )}

          {/* ---------------- STEP 2 — verify ---------------- */}
          {step === 2 && (
            <div className="ui-rise space-y-4">
              <div>
                <h2 className="ui-h2 text-white">Verify your keys</h2>
                <p className="mt-1.5 text-[13px] leading-relaxed text-neutral-400">
                  Sends a real 5-token request to each provider so you know it works before you connect an app.
                </p>
              </div>

              {added.length === 0 ? (
                <div className="ui-card p-5 text-center">
                  <p className="text-[13px] text-neutral-400">Nothing added yet — go back and paste a key, or use the free one.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {(results.length > 0 ? results : added.map((a) => ({ ...a, ok: false, latencyMs: 0 } as OnboardingKeyResult))).map((r, i) => {
                    const pending = testing && i >= results.length;
                    return (
                      <div key={r.key} className="ui-card flex items-center gap-3 p-3.5">
                        <span className={`flex h-8 w-8 flex-none items-center justify-center rounded-lg ${
                          pending ? 'bg-white/6 text-neutral-400'
                            : r.ok ? 'bg-emerald-400/15 text-emerald-300'
                            : results.length > i ? 'bg-rose-400/15 text-rose-300' : 'bg-white/6 text-neutral-500'
                        }`}>
                          {pending ? <Loader2 className="h-4 w-4 animate-spin" />
                            : r.ok ? <Check className="h-4 w-4" strokeWidth={3} />
                            : results.length > i ? <X className="h-4 w-4" strokeWidth={3} />
                            : <KeyRound className="h-4 w-4" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-semibold text-white">{r.label}</p>
                          <p className="truncate font-mono text-[11.5px] text-neutral-500">
                            {maskKey(r.key)}
                            {r.ok && r.latencyMs > 0 ? ` · ${r.latencyMs} ms` : ''}
                            {!r.ok && r.error ? ` · ${r.error}` : ''}
                          </p>
                        </div>
                        {r.ok && <span className="ui-badge ui-badge-success flex-none">Working</span>}
                        {!r.ok && results.length > i && !pending && <span className="ui-badge ui-badge-danger flex-none">Failed</span>}
                      </div>
                    );
                  })}
                </div>
              )}

              {!testing && results.length > 0 && !anyWorking && (
                <div className="ui-card border-amber-400/25 bg-amber-400/6 p-3.5">
                  <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-amber-200/90">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-amber-300" />
                    None of those keys responded. That is usually a typo, an expired key, or a provider that needs billing
                    enabled. You can continue anyway and fix it later from the <strong className="font-semibold">Keys</strong> tab.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ---------------- STEP 3 — ready ---------------- */}
          {step === 3 && (
            <div className="ui-rise space-y-5">
              <div className="flex items-start gap-3">
                <span className="cx-pulse-ring flex h-11 w-11 flex-none items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-cyan-500 text-[#04150e]">
                  <PartyPopper className="h-5 w-5" strokeWidth={2.4} />
                </span>
                <div className="min-w-0">
                  <h2 className="ui-h1 text-white">You're ready</h2>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-neutral-400">
                    {totalKeys > 0
                      ? `${totalKeys} key${totalKeys === 1 ? '' : 's'} saved. The gateway can now route to every provider those keys unlock.`
                      : 'You can add keys any time from the Keys button in the header.'}
                  </p>
                </div>
              </div>

              <div className="space-y-2.5">
                <p className="ui-eyebrow">What to do next</p>
                {[
                  { Icon: Plug, t: 'Connect an app', d: 'Generate your encrypted master key and copy a ready-made config for Claude Code, Cursor, Cline, Zed, Aider and 13 more.', tab: 'Connect tab' },
                  { Icon: Terminal, t: 'Send a test request', d: 'Try the gateway from the browser with any model and watch which provider and key served it.', tab: 'Tester tab' },
                  { Icon: Radar, t: 'Watch key health', d: 'See live WORKING / EXHAUSTED / DEAD status per key, with real measured latency.', tab: 'Keys tab' },
                ].map(({ Icon, t, d, tab }) => (
                  <div key={t} className="ui-card flex items-start gap-3 p-3.5">
                    <Icon className="mt-0.5 h-4 w-4 flex-none text-cyan-300" strokeWidth={2.2} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-bold text-white">{t}</p>
                      <p className="mt-0.5 text-[12px] leading-relaxed text-neutral-500">{d}</p>
                    </div>
                    <span className="ui-badge flex-none">{tab}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* footer */}
        <div className="relative flex items-center justify-between gap-3 border-t border-white/10 bg-black/25 px-5 py-3.5 sm:px-7">
          <button
            type="button"
            className="ui-btn ui-btn-ghost ui-btn-sm"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>

          <div className="flex items-center gap-2">
            {step === 1 && (
              <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" onClick={() => setStep(2)} disabled={added.length === 0}>
                Verify <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
            {step === 2 && (
              <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" onClick={testing ? undefined : handleVerify} disabled={testing}>
                {testing ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Testing…</> : <>Run verification <Zap className="h-3.5 w-3.5" /></>}
              </button>
            )}
            {step === 2 && results.length > 0 && !testing && (
              <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" onClick={() => setStep(3)}>
                Continue <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
            {(step === 0 || step === 3) && (
              <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" onClick={step === 3 ? onComplete : () => setStep(1)}>
                {step === 3 ? <>Open the console <ArrowRight className="h-3.5 w-3.5" /></> : <>Add a key <ArrowRight className="h-3.5 w-3.5" /></>}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
