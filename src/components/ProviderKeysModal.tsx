import React, { useState } from 'react';
import { Key, X, Plus, Trash2, Eye, EyeOff, RotateCcw, Mail } from 'lucide-react';
import type { Provider } from '../types/router';
import {
  getProviderKeyEntries,
  getProviderKeys,
  addProviderKey,
  removeProviderKey,
  reviveProviderKey,
  setKeyUpstream,
  maskKey,
  detectKeyUpstream,
  effectiveUpstream,
  UPSTREAM_NAMES,
  UPSTREAM_IDS,
  MAX_KEYS_PER_PROVIDER,
} from '../utils/providerKeys';
import { displayStatus } from '../utils/keyHealth';
import { notify } from '../utils/notify';

interface ProviderKeysModalProps {
  isOpen: boolean;
  onClose: () => void;
  providers: Provider[];
  onChanged: () => void;
}

const DOT: Record<string, string> = {
  working: 'bg-emerald-400',
  cooldown: 'bg-amber-400 animate-pulse',
  dead: 'bg-rose-500',
  untested: 'bg-neutral-600',
};

export const ProviderKeysModal: React.FC<ProviderKeysModalProps> = ({
  isOpen,
  onClose,
  providers,
  onChanged,
}) => {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [gmailDrafts, setGmailDrafts] = useState<Record<string, string>>({});
  const [upstreamDrafts, setUpstreamDrafts] = useState<Record<string, string>>({});
  const [showMap, setShowMap] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tick, setTick] = useState(0);

  if (!isOpen) return null;

  const refresh = () => {
    setTick((t) => t + 1);
    onChanged();
  };

  const handleAdd = (providerId: string, providerName: string) => {
    const draft = drafts[providerId] || '';
    const auto = detectKeyUpstream(draft);
    const picked = upstreamDrafts[providerId] || '';
    // Explicit tag only when user picked one (or auto failed and they picked)
    const tag = picked && picked !== 'auto' ? picked : '';
    const res = addProviderKey(providerId, draft, gmailDrafts[providerId] || '', tag);
    if (!res.ok) {
      setErrors((e) => ({ ...e, [providerId]: res.error || 'Add fail' }));
      return;
    }
    setErrors((e) => ({ ...e, [providerId]: '' }));
    setDrafts((d) => ({ ...d, [providerId]: '' }));
    setGmailDrafts((d) => ({ ...d, [providerId]: '' }));
    setUpstreamDrafts((d) => ({ ...d, [providerId]: '' }));
    const effName = UPSTREAM_NAMES[tag || auto] || '?';
    notify('success', `Key added: ${providerName} [${effName}]`, `Ab pool me ${getProviderKeys(providerId).length} key(s). 429 pe auto-rotate + MONITOR me live health.`);
    refresh();
  };

  const handleRemove = (providerId: string, providerName: string, index: number) => {
    removeProviderKey(providerId, index);
    notify('warn', `Key removed: ${providerName}`, `Bachi keys: ${getProviderKeys(providerId).length}.`);
    refresh();
  };

  const handleRevive = (providerId: string, providerName: string, index: number) => {
    if (reviveProviderKey(providerId, index)) {
      notify('success', `Key revived: ${providerName} #${index + 1}`, 'Wapas rotation me.');
      refresh();
    }
  };

  const handleTagChange = (providerId: string, index: number, up: string) => {
    if (setKeyUpstream(providerId, index, up === 'auto' ? '' : up)) {
      notify('info', `Key #${index + 1} provider tag`, up === 'auto' || !up ? 'Auto-detect pe wapas.' : `${UPSTREAM_NAMES[up]} tag lag gaya — routing + sync ab exact.`);
      refresh();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-neutral-900 border border-neutral-700 shadow-2xl p-4 sm:p-6 space-y-4 font-mono text-neutral-100 max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true">
        <div className="flex items-start justify-between border-b border-neutral-800 pb-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4 text-emerald-400" />
              <span className="text-[10px] text-neutral-400 uppercase tracking-widest">18 PROVIDERS • {MAX_KEYS_PER_PROVIDER} KEYS EACH • SMART ROTATION</span>
            </div>
            <h2 className="text-lg font-bold uppercase text-white">Provider Keys</h2>
            <p className="text-[11px] text-neutral-400 font-sans">
              Kisi bhi provider ki jitni chaaho keys dalo — Gemini, Groq, OpenRouter, Cerebras, OpenAI, Anthropic, DeepSeek, Mistral, xAI, Perplexity, Together, Fireworks, SiliconFlow, Novita, Hyperbolic, Chutes, GLHF, Cohere.
              Prefix se auto-pehchan; `sk-...` jaisi ambiguous keys pe provider tag select karo. 429/exhausted pe automatic next key — MONITOR tab me live health dekho.
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-neutral-400 hover:text-white hover:bg-neutral-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div key={tick} className="space-y-3">
          {providers.map((p) => {
            const entries = getProviderKeyEntries(p.id);
            const deadCount = entries.filter((e) => e.s === 'dead').length;
            const draftVal = drafts[p.id] || '';
            const draftAuto = draftVal.trim() ? detectKeyUpstream(draftVal) : '';
            return (
              <div key={p.id} className="border border-neutral-800 bg-neutral-950 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white truncate">{p.name}</div>
                    <div className="text-[10px] text-neutral-500 truncate">{p.defaultBaseUrl}</div>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 border flex-shrink-0 ${entries.length > 0 ? 'bg-emerald-950 text-emerald-400 border-emerald-800' : 'bg-neutral-900 text-neutral-400 border-neutral-700'}`}>
                    {entries.length}/{MAX_KEYS_PER_PROVIDER} KEY{entries.length === 1 ? '' : 'S'}{deadCount > 0 ? ` (${deadCount} DEAD)` : ''}
                  </span>
                </div>

                {entries.map((e, i) => {
                  const eff = effectiveUpstream(e);
                  const auto = detectKeyUpstream(e.k);
                  const st = displayStatus(e.k, e.s === 'dead');
                  return (
                    <div key={`${p.id}-${i}`} className={`flex items-center justify-between gap-2 px-2 py-1.5 border ${e.s === 'dead' ? 'bg-rose-950/40 border-rose-800/60' : 'bg-neutral-900 border-neutral-800'}`}>
                      <div className="min-w-0 flex-1">
                        <code className="text-[11px] text-neutral-300 truncate flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${DOT[st]}`} title={`Health: ${st}`} />
                          <span className="truncate">#{i + 1} [{UPSTREAM_NAMES[eff] || '?'}]{e.u ? '*' : ''} {showMap[`${p.id}:${i}`] ? e.k : maskKey(e.k)}</span>
                        </code>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          {e.g && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] text-sky-300 truncate">
                              <Mail className="w-2.5 h-2.5 flex-shrink-0" />
                              <span className="truncate">{e.g}</span>
                            </span>
                          )}
                          {e.s === 'dead' && (
                            <span className="text-[9px] px-1 bg-rose-950 text-rose-300 border border-rose-800/60 font-bold">DEAD — kaam nahi kar rahi</span>
                          )}
                          {st === 'cooldown' && (
                            <span className="text-[9px] px-1 bg-amber-950 text-amber-300 border border-amber-800/60 font-bold">429 COOLDOWN — auto-skip</span>
                          )}
                          {(auto === 'unknown' || e.u) && e.s !== 'dead' && (
                            <select
                              value={e.u || 'auto'}
                              onChange={(ev) => handleTagChange(p.id, i, ev.target.value)}
                              title="Is key ka provider tag (ambiguous keys ke liye zaroori)"
                              className="text-[10px] bg-neutral-950 border border-neutral-700 text-neutral-200 px-1 py-0.5 focus:border-emerald-500 focus:outline-none"
                            >
                              <option value="auto">Auto{auto !== 'unknown' ? `: ${UPSTREAM_NAMES[auto]}` : ' (?)'}</option>
                              {UPSTREAM_IDS.map((u) => (
                                <option key={u} value={u}>{UPSTREAM_NAMES[u]}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {e.s === 'dead' && (
                          <button
                            type="button"
                            onClick={() => handleRevive(p.id, p.name, i)}
                            title="Wapas live karo"
                            className="p-1 text-emerald-400 hover:text-emerald-300"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setShowMap((s) => ({ ...s, [`${p.id}:${i}`]: !s[`${p.id}:${i}`] }))}
                          title={showMap[`${p.id}:${i}`] ? 'Hide' : 'Show'}
                          className="p-1 text-neutral-400 hover:text-white"
                        >
                          {showMap[`${p.id}:${i}`] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemove(p.id, p.name, i)}
                          title="Delete key"
                          className="p-1 text-neutral-400 hover:text-rose-300"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}

                {errors[p.id] && (
                  <div className="text-[11px] text-rose-300 bg-rose-950/60 border border-rose-800/60 px-2 py-1">{errors[p.id]}</div>
                )}

                <div className="flex flex-col gap-1.5">
                  <div className="flex flex-col sm:flex-row gap-1.5">
                    <div className="flex-1 min-w-0 relative">
                      <input
                        type="password"
                        value={drafts[p.id] || ''}
                        onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                        placeholder="Kisi bhi provider ki key paste karo..."
                        className="w-full bg-neutral-900 border border-neutral-700 px-2.5 py-1.5 pr-20 text-xs text-neutral-100 placeholder-neutral-600 focus:border-emerald-500 focus:outline-none"
                      />
                      {draftAuto && (
                        <span className={`absolute right-2 top-1/2 -translate-y-1/2 text-[9px] px-1.5 py-0.5 border font-bold ${draftAuto === 'unknown' ? 'bg-amber-950 text-amber-300 border-amber-800' : 'bg-emerald-950 text-emerald-300 border-emerald-800'}`}>
                          {draftAuto === 'unknown' ? '? TAG SELECT KARO' : `✓ ${UPSTREAM_NAMES[draftAuto]}`}
                        </span>
                      )}
                    </div>
                    <input
                      type="text"
                      value={gmailDrafts[p.id] || ''}
                      onChange={(e) => setGmailDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                      placeholder="Gmail tag (optional)"
                      className="flex-1 min-w-0 bg-neutral-900 border border-neutral-700 px-2.5 py-1.5 text-xs text-neutral-100 placeholder-neutral-600 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div className="flex flex-col sm:flex-row gap-1.5">
                    <select
                      value={upstreamDrafts[p.id] || 'auto'}
                      onChange={(e) => setUpstreamDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                      title="Provider tag — auto-detect fail ho to yaha select karo (DeepSeek/Together/Mistral sk-... keys ke liye)"
                      className="flex-1 min-w-0 bg-neutral-900 border border-neutral-700 px-2.5 py-1.5 text-xs text-neutral-100 focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="auto">Provider: Auto-detect{draftAuto && draftAuto !== 'unknown' ? ` (${UPSTREAM_NAMES[draftAuto]})` : ''}</option>
                      {UPSTREAM_IDS.map((u) => (
                        <option key={u} value={u}>{UPSTREAM_NAMES[u]}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => handleAdd(p.id, p.name)}
                      className="flex items-center justify-center gap-1 px-4 py-1.5 bg-neutral-100 hover:bg-white text-neutral-950 text-xs font-bold uppercase flex-shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add key</span>
                    </button>
                  </div>
                  {draftAuto === 'unknown' && draftVal.trim().length >= 10 && (
                    <div className="text-[10px] text-amber-300 font-sans">
                      Ye key prefix se pehchani nahi gayi — upar dropdown se iska provider select karo taaki routing + sync + monitor exact rahe.
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
