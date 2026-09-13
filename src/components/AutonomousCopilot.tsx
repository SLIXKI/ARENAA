import React, { useState, useEffect, useRef } from 'react';
import { 
  Bot, 
  Send, 
  Mic, 
  MicOff, 
  Volume2, 
  VolumeX, 
  Maximize2, 
  Minimize2, 
  X, 
  RotateCcw, 
  CheckCircle2, 
  Zap, 
  Activity, 
  Cpu, 
  Radio, 
  Sliders, 
  Terminal,
  ArrowRight,
  Shield,
  Key,
  RefreshCw,
  Code2
} from 'lucide-react';
import { Provider, Endpoint, RoutingPolicy } from '../types/router';
import { CopyButton } from './CopyButton';
import { stripActionTags, splitCodeSegments, findUrls } from '../utils/copy';
import { getProviderKeys, getProviderKeyEntries, effectiveUpstream, UPSTREAM_IDS } from '../utils/providerKeys';
import { loadLiveCatalog, getModelStatus } from '../utils/catalog';
import { notify } from '../utils/notify';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  modelUsed?: string;
  executedActions?: string[];
}

// URL auto-link with per-URL copy
const RichText: React.FC<{ text: string }> = ({ text }) => {
  if (findUrls(text).length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  const re = /https?:\/\/[^\s)>\]`'"]+/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={k++}>{text.slice(last, m.index)}</span>);
    const url = m[0];
    parts.push(
      <span key={k++} className="inline-flex items-center gap-1 break-all align-baseline">
        <a href={url} target="_blank" rel="noreferrer" className="text-emerald-300 underline">
          {url}
        </a>
        <CopyButton text={url} label="" title="Copy URL" />
      </span>
    );
    last = m.index + url.length;
  }
  if (last < text.length) parts.push(<span key={k++}>{text.slice(last)}</span>);
  return <>{parts}</>;
};

// Message body: ``` code blocks get their own copy button, rest is linkified text
const MessageBody: React.FC<{ content: string }> = ({ content }) => {
  const segs = splitCodeSegments(stripActionTags(content));
  return (
    <div className="whitespace-pre-wrap font-sans break-words space-y-2">
      {segs.map((s, i) =>
        s.type === 'code' ? (
          <div key={i} className="border border-neutral-700 bg-neutral-950">
            <div className="flex items-center justify-between px-2 py-1 border-b border-neutral-800 bg-neutral-900">
              <span className="text-[10px] font-mono text-emerald-400 uppercase">{s.lang}</span>
              <CopyButton text={s.body} label="COPY CODE" title="Copy code block" />
            </div>
            <pre className="p-2 text-[11px] font-mono overflow-x-auto whitespace-pre">{s.body}</pre>
          </div>
        ) : (
          <div key={i}>
            <RichText text={s.body} />
          </div>
        )
      )}
    </div>
  );
};

interface AutonomousCopilotProps {
  isOpen: boolean;
  onClose: () => void;
  // Router state
  providers: Provider[];
  activeProvider: Provider;
  endpoints: Endpoint[];
  routingPolicy: RoutingPolicy;
  fallbackChain: string[];
  // Router actions for autonomous site management
  onSelectProvider: (providerId: string) => void;
  onSelectPolicy: (policy: RoutingPolicy) => void;
  onRunHealthSweep: () => void;
  onSelectTab: (tab: 'dashboard' | 'tester' | 'quota' | 'telemetry' | 'export' | 'monitor') => void;
  onSetApiKey?: (providerId: string, apiKey: string) => void;
  onAddProvider?: (provider: Provider) => void;
  onSaveEndpoint?: (endpoint: Endpoint) => void;
  onToggleEndpoint?: (id: string) => void;
  onDeleteEndpoint?: (id: string) => void;
  onSetFallbackChain?: (chain: string[]) => void;
  onResetUsage?: (providerId?: string) => void;
  onRunEdgeTest?: (prompt?: string) => void;
  onGenerateNewProxyKey?: () => void;
  // Auth state
  operatorUsername: string;
  userGeminiKey: string;
  onOpenLogin: () => void;
}

export const AutonomousCopilot: React.FC<AutonomousCopilotProps> = ({
  isOpen,
  onClose,
  providers,
  activeProvider,
  endpoints,
  routingPolicy,
  fallbackChain,
  onSelectProvider,
  onSelectPolicy,
  onRunHealthSweep,
  onSelectTab,
  onSetApiKey,
  onAddProvider,
  onSaveEndpoint,
  onToggleEndpoint,
  onDeleteEndpoint,
  onSetFallbackChain,
  onResetUsage,
  onRunEdgeTest,
  onGenerateNewProxyKey,
  operatorUsername,
  userGeminiKey,
  onOpenLogin,
}) => {
  const [messages, setMessages] = useState<Message[]>(() => {
    return [
      {
        id: 'msg_welcome',
        role: 'assistant',
        content: `Namaste! Main aapka Autonomous Edge AI Operator hoon.

⚡ Kya-kya karta hoon:
• Provider keys save (Gemini, Groq, OpenRouter, Cerebras — unlimited keys)
• Endpoint URL / curl / python snippets dena (copy button ke saath)
• Failover chain, routing policy, edge test, quota reset

Short me jawab dunga — detail chahiye to bol dena. Hindi/Hinglish/English sab chalega!`,
        timestamp: Date.now(),
        modelUsed: 'gemini-3.5-flash',
      },
    ];
  });

  const [inputText, setInputText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [modelType, setModelType] = useState<'general' | 'fast' | 'complex'>('general');
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [isLiveActive, setIsLiveActive] = useState(false);
  const [liveStatus, setLiveStatus] = useState<string>('idle');
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDictating, setIsDictating] = useState(false);
  const recognitionRef = useRef<any>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const liveWsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const micContextRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  const [isSpeaking, setIsSpeaking] = useState(false);

  // Auto scroll to bottom
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  // Clean up Live API on unmount or close
  useEffect(() => {
    return () => {
      stopLiveSession();
    };
  }, []);

  // Parse and execute actions from AI response text with 100% full administrative control
  const executeAiActions = (text: string): string[] => {
    const executed: string[] = [];

    // 1. [ACTION:SET_API_KEY:prov-id:apiKey] (id me space allowed: "Edge Router")
    const apiKeyMatch = text.match(/\[ACTION:SET_API_KEY:([a-zA-Z0-9_\- ]+):([^\]\s]+)\]/);
    if (apiKeyMatch && apiKeyMatch[1] && apiKeyMatch[2]) {
      const provId = apiKeyMatch[1].trim();
      const keyVal = apiKeyMatch[2];
      if (onSetApiKey) {
        onSetApiKey(provId, keyVal);
        const prov = providers.find((p) => p.id === provId);
        executed.push(`Configured & saved API Key for ${prov?.name || provId}`);
      }
    }

    // 2. [ACTION:SET_GEMINI_KEY:apiKey]
    const geminiKeyMatch = text.match(/\[ACTION:SET_GEMINI_KEY:([^\]\s]+)\]/);
    if (geminiKeyMatch && geminiKeyMatch[1]) {
      const keyVal = geminiKeyMatch[1];
      if (onSetApiKey) {
        onSetApiKey('Edge Router', keyVal);
      }
      localStorage.setItem('er_gemini_key', keyVal);
      executed.push('Saved & activated Gemini API Key for Edge Router & Copilot');
    }

    // 3. [ACTION:SWITCH_PROVIDER:Edge Router]
    const providerMatch = text.match(/\[ACTION:SWITCH_PROVIDER:([a-zA-Z0-9_\- ]+)\]/);
    if (providerMatch && providerMatch[1]) {
      const targetProvId = providerMatch[1].trim();
      const found = providers.find((p) => p.id === targetProvId);
      if (found) {
        onSelectProvider(targetProvId);
        executed.push(`Switched active provider to ${found.name}`);
      }
    }

    // 4. [ACTION:SET_FALLBACK_CHAIN:prov-cerebras,prov-groq,prov-gemini]
    const fallbackMatch = text.match(/\[ACTION:SET_FALLBACK_CHAIN:([^\]]+)\]/);
    if (fallbackMatch && fallbackMatch[1]) {
      const chain = fallbackMatch[1].split(',').map((s) => s.trim()).filter(Boolean);
      if (onSetFallbackChain && chain.length > 0) {
        onSetFallbackChain(chain);
        executed.push(`Updated multi-provider failover chain: ${chain.join(' -> ')}`);
      }
    }

    // 5. [ACTION:ADD_PROVIDER:Name:BaseUrl:Models:Category]
    const addProvMatch = text.match(/\[ACTION:ADD_PROVIDER:([^:]+):([^:]+):([^:]+)(?::([^\]]+))?\]/);
    if (addProvMatch && addProvMatch[1] && addProvMatch[2]) {
      const name = addProvMatch[1].trim();
      const baseUrl = addProvMatch[2].trim();
      const models = (addProvMatch[3] || 'default-model').split(',').map((m) => m.trim());
      const category = (addProvMatch[4] || 'LLM & Multimodal').trim() as any;
      const newProv: Provider = {
        id: `prov-custom-${Date.now().toString(36)}`,
        name,
        slug: name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        category,
        defaultBaseUrl: baseUrl,
        models: models.length > 0 ? models : ['default-model'],
        isCustom: true,
      };
      if (onAddProvider) {
        onAddProvider(newProv);
        onSelectProvider(newProv.id);
        executed.push(`Created & added custom AI Provider: ${name}`);
      }
    }

    // 6. [ACTION:ADD_ENDPOINT:Name:BaseUrl:Region:ProviderId:Weight]
    const addEpMatch = text.match(/\[ACTION:ADD_ENDPOINT:([^:]+):([^:]+):([^:]+):([^:]+)(?::([0-9]+))?\]/);
    if (addEpMatch && addEpMatch[1] && addEpMatch[2]) {
      const name = addEpMatch[1].trim();
      const baseUrl = addEpMatch[2].trim();
      const region = (addEpMatch[3] || 'ap-south-1').trim() as any;
      const provId = addEpMatch[4].trim();
      const weight = parseInt(addEpMatch[5] || '100', 10);
      const newEp: Endpoint = {
        id: `ep-node-${Date.now().toString(36)}`,
        providerId: provId,
        name,
        region,
        regionLabel: region.toUpperCase(),
        apiKey: '',
        baseUrl,
        weight: isNaN(weight) ? 100 : weight,
        priorityTier: 1,
        status: 'healthy',
        latencyMs: 18,
        uptimePercentage: 99.9,
        rateLimitRpm: 1200,
        rateLimitRemaining: 1200,
        totalRouted: 0,
        errorsCount: 0,
        enabled: true,
        lastChecked: Date.now(),
      };
      if (onSaveEndpoint) {
        onSaveEndpoint(newEp);
        executed.push(`Deployed new Edge Node: ${name} (${region})`);
      }
    }

    // 7. [ACTION:TOGGLE_ENDPOINT:ep-id]
    const toggleMatch = text.match(/\[ACTION:TOGGLE_ENDPOINT:([a-zA-Z0-9_-]+)\]/);
    if (toggleMatch && toggleMatch[1] && onToggleEndpoint) {
      onToggleEndpoint(toggleMatch[1]);
      executed.push(`Toggled endpoint enabled state: ${toggleMatch[1]}`);
    }

    // 8. [ACTION:DELETE_ENDPOINT:ep-id]
    const delMatch = text.match(/\[ACTION:DELETE_ENDPOINT:([a-zA-Z0-9_-]+)\]/);
    if (delMatch && delMatch[1] && onDeleteEndpoint) {
      onDeleteEndpoint(delMatch[1]);
      executed.push(`Removed edge node endpoint: ${delMatch[1]}`);
    }

    // 9. [ACTION:RESET_QUOTA]
    if (text.includes('[ACTION:RESET_QUOTA]') && onResetUsage) {
      onResetUsage();
      executed.push('Reset daily request & token usage counters across all providers');
    }

    // 10. [ACTION:RUN_EDGE_TEST:optional prompt]
    const testMatch = text.match(/\[ACTION:RUN_EDGE_TEST(?::([^\]]+))?\]/);
    if (testMatch) {
      const p = testMatch[1] ? testMatch[1].trim() : undefined;
      if (onRunEdgeTest) {
        onRunEdgeTest(p);
      }
      onSelectTab('tester');
      executed.push(`Dispatched live edge test execution${p ? `: "${p}"` : ''}`);
    }

    // 11. [ACTION:RUN_PING_SWEEP]
    if (text.includes('[ACTION:RUN_PING_SWEEP]')) {
      onRunHealthSweep();
      executed.push('Triggered global latency sweep across all edge nodes');
    }

    // 12. [ACTION:CHANGE_POLICY:lowest-latency]
    const policyMatch = text.match(/\[ACTION:CHANGE_POLICY:([a-zA-Z0-9_-]+)\]/);
    if (policyMatch && policyMatch[1]) {
      const p = policyMatch[1] as RoutingPolicy;
      onSelectPolicy(p);
      executed.push(`Changed routing policy to ${p}`);
    }

    // 13. [ACTION:SWITCH_TAB:dashboard]
    const tabMatch = text.match(/\[ACTION:SWITCH_TAB:([a-zA-Z0-9_-]+)\]/);
    if (tabMatch && tabMatch[1]) {
      const t = tabMatch[1] as any;
      if (['dashboard', 'tester', 'quota', 'telemetry', 'export', 'monitor'].includes(t)) {
        onSelectTab(t);
        executed.push(`Navigated to ${t} view`);
      }
    }

    // 14. [ACTION:GENERATE_PROXY_KEY]
    if (text.includes('[ACTION:GENERATE_PROXY_KEY]')) {
      if (onGenerateNewProxyKey) {
        onGenerateNewProxyKey();
        executed.push('Generated & saved new Edge Proxy API Key in local edge cache');
      }
      onSelectTab('export');
    }

    // 15. [ACTION:AUTO_OPTIMIZE]
    if (text.includes('[ACTION:AUTO_OPTIMIZE]')) {
      onSelectPolicy('lowest-latency');
      onRunHealthSweep();
      executed.push('Auto-optimization executed: Lowest-latency policy & global edge sweep active');
    }

    return executed;
  };

  // Play audio TTS with crystal-clear pronunciation and language matching (No double voice)
  const playTtsAudio = async (textToSpeak: string) => {
    try {
      // Immediately cancel any currently playing audio or speech synthesis to prevent echo/double voice
      if (currentAudioRef.current) {
        try {
          currentAudioRef.current.pause();
          currentAudioRef.current.currentTime = 0;
        } catch (_) {}
        currentAudioRef.current = null;
      }
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }

      // Clean action tags, markdown bullets, symbols, code blocks for pristine voice clarity
      const clean = textToSpeak
        .replace(/\[ACTION:[^\]]+\]/g, '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/[*#_~]/g, '')
        .replace(/•/g, '')
        .replace(/\n+/g, ' ')
        .trim();

      if (!clean) {
        setIsSpeaking(false);
        return;
      }

      setIsSpeaking(true);

      // Check if text is predominantly Hindi/Devanagari
      const hasHindiCharacters = /[\u0900-\u097F]/.test(clean);

      // 1. Try high-clarity server Gemini TTS (gemini-3.1-flash-tts-preview)
      let handledByServer = false;
      try {
        const res = await fetch('/api/copilot/tts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(userGeminiKey ? { 'x-gemini-key': userGeminiKey } : {}),
          },
          body: JSON.stringify({
            text: clean.slice(0, 450),
            userApiKey: userGeminiKey,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.audio) {
            const audioBlob = new Blob([
              Uint8Array.from(atob(data.audio), (c) => c.charCodeAt(0)),
            ], { type: 'audio/mp3' });
            const audioUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(audioUrl);
            currentAudioRef.current = audio;
            audio.onended = () => {
              setIsSpeaking(false);
              currentAudioRef.current = null;
            };
            audio.onerror = () => {
              setIsSpeaking(false);
              currentAudioRef.current = null;
            };
            await audio.play();
            handledByServer = true;
            return;
          }
        }
      } catch (err) {
        console.warn('Server TTS failed, using fallback:', err);
      }

      if (handledByServer) return;

      // 2. High-clarity native browser SpeechSynthesis fallback (only if server did not play)
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(clean.slice(0, 300));
        
        // Match user language: Hindi or English
        utterance.lang = hasHindiCharacters ? 'hi-IN' : 'en-IN';
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        
        // Find best local voice matching language
        const voices = window.speechSynthesis.getVoices();
        const targetVoice = voices.find(v => v.lang.startsWith(hasHindiCharacters ? 'hi' : 'en')) || voices[0];
        if (targetVoice) {
          utterance.voice = targetVoice;
        }

        utterance.onend = () => setIsSpeaking(false);
        utterance.onerror = () => setIsSpeaking(false);
        window.speechSynthesis.speak(utterance);
      } else {
        setIsSpeaking(false);
      }
    } catch (err) {
      console.error('TTS playback error:', err);
      setIsSpeaking(false);
    }
  };

  // Send message to Gemini server
  const handleSendMessage = async (customPrompt?: string) => {
    const promptToSend = (customPrompt || inputText).trim();
    if (!promptToSend || isGenerating) return;

    const userMessage: Message = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: promptToSend,
      timestamp: Date.now(),
    };

    const newHistory = [...messages, userMessage];
    setMessages(newHistory);
    setInputText('');
    setIsGenerating(true);

    const activeEndpoints = endpoints.filter((e) => e.providerId === activeProvider.id && e.enabled).length;
    const avgLatency = Math.round(
      endpoints.reduce((acc, ep) => acc + ep.latencyMs, 0) / (endpoints.length || 1)
    );

    try {
      const response = await fetch('/api/copilot/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(userGeminiKey ? { 'x-gemini-key': userGeminiKey } : {}),
        },
        body: JSON.stringify({
          messages: newHistory.map((m) => ({ role: m.role, content: m.content })),
          modelType,
          userApiKey: userGeminiKey,
          currentRouterState: {
            activeProviderName: activeProvider.name,
            activeProviderId: activeProvider.id,
            routingPolicy,
            fallbackChain,
            totalEndpoints: endpoints.length,
            activeEndpoints,
            avgLatency,
            siteBaseUrl: typeof window !== 'undefined' ? `${window.location.origin}/api/v1` : '',
            providerCatalog: providers.map((p) => ({
              id: p.id,
              baseUrl: p.defaultBaseUrl,
              models: p.models,
              hasKey: getProviderKeys(p.id).length > 0,
            })),
            upstreamKeyStatus: (() => {
              try {
                const all: string[] = [];
                (providers || []).forEach((x) => {
                  getProviderKeyEntries(x.id).forEach((e) => {
                    if (e.s === 'active') all.push(effectiveUpstream(e));
                  });
                });
                return UPSTREAM_IDS.map((up) => ({ upstream: up, hasKey: all.includes(up) }));
              } catch {
                return [];
              }
            })(),
            activeModels: (() => {
              try {
                const live = loadLiveCatalog();
                const source: string[] = live && live.models.length > 0
                  ? [...new Set(live.models.map((m) => m.id))]
                  : (providers || []).flatMap((p) => p.models || []);
                const failed = getModelStatus();
                return source.filter((id) => failed[id]?.state !== "failed").slice(0, 40);
              } catch {
                return [];
              }
            })(),
            providers: providers.map((p) => ({
              id: p.id,
              name: p.name,
              category: p.category,
              models: p.models,
            })),
            endpointsSummary: endpoints.map((e) => ({
              id: e.id,
              providerId: e.providerId,
              name: e.name,
              region: e.region,
              status: e.status,
              enabled: e.enabled,
              latencyMs: e.latencyMs,
            })),
          },
        }),
      });

      // Server crash page (HTML/text) aaye to JSON parse na phate — pehle text padho
      const rawText = await response.text();
      let data: any = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        throw new Error(
          response.ok
            ? 'Server se galat jawab aaya. Dobara try karo.'
            : `Server error (${response.status}) — API deploy check karo, dobara try karo.`
        );
      }
      if (!response.ok) {
        throw new Error(data?.error?.message || data?.error || 'Failed to communicate with AI server');
      }

      const replyText = data.text || 'Action acknowledged.';
      const executed = executeAiActions(replyText);
      if (executed.length > 0) {
        notify('agent', `Copilot ne ${executed.length} action kiya`, executed.slice(0, 3).join(' • '));
      }

      const botMessage: Message = {
        id: `msg_bot_${Date.now()}`,
        role: 'assistant',
        content: replyText,
        timestamp: Date.now(),
        modelUsed: data.modelUsed || 'gemini-3.5-flash',
        executedActions: executed,
      };

      setMessages((prev) => [...prev, botMessage]);

      if (autoSpeak) {
        playTtsAudio(replyText);
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `msg_err_${Date.now()}`,
          role: 'assistant',
          content: `⚠️ Error: ${err.message || 'Could not reach Gemini service'}. Please check your Gemini API key in Operator Login.`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setIsGenerating(false);
    }
  };

  // Real-time Voice Live API (gemini-3.1-flash-live-preview)
  const startLiveSession = async () => {
    try {
      // Cancel any regular TTS before starting Live Voice
      if (currentAudioRef.current) {
        try {
          currentAudioRef.current.pause();
          currentAudioRef.current.currentTime = 0;
        } catch (_) {}
        currentAudioRef.current = null;
      }
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }

      setLiveStatus('connecting');
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const queryParams = new URLSearchParams();
      if (userGeminiKey) queryParams.set('key', userGeminiKey);
      queryParams.set('activeProvider', activeProvider);
      queryParams.set('policy', routingPolicy);
      queryParams.set('nodeCount', endpoints.length.toString());
      if (fallbackChain && fallbackChain.length > 0) {
        queryParams.set('fallback', fallbackChain.join(' -> '));
      }

      const wsUrl = `${protocol}//${window.location.host}/api/copilot/live?${queryParams.toString()}`;

      const ws = new WebSocket(wsUrl);
      liveWsRef.current = ws;

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioContextRef.current = audioCtx;
      nextPlayTimeRef.current = audioCtx.currentTime;
      activeSourcesRef.current = [];

      ws.onopen = async () => {
        setIsLiveActive(true);
        setLiveStatus('listening');

        // Capture microphone at 16kHz
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStreamRef.current = stream;

        const micCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        micContextRef.current = micCtx;
        const source = micCtx.createMediaStreamSource(stream);
        const processor = micCtx.createScriptProcessor(4096, 1, 1);

        processor.onaudioprocess = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const inputData = e.inputBuffer.getChannelData(0);
          // Convert float32 to 16-bit PCM little-endian
          const pcm16 = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
          const uint8 = new Uint8Array(pcm16.buffer);
          let binary = '';
          for (let i = 0; i < uint8.byteLength; i++) {
            binary += String.fromCharCode(uint8[i]);
          }
          const base64 = btoa(binary);
          ws.send(JSON.stringify({ audio: base64 }));
        };

        // CRITICAL FIX FOR DOUBLE VOICE / ECHO:
        // Mute mic output to speakers so user does NOT hear their own voice loopback
        const muteGain = micCtx.createGain();
        muteGain.gain.value = 0;
        source.connect(processor);
        processor.connect(muteGain);
        muteGain.connect(micCtx.destination);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          // Handle interruption (stop currently playing speech if user speaks or AI was interrupted)
          if (msg.interrupted) {
            activeSourcesRef.current.forEach((s) => {
              try { s.stop(); } catch (_) {}
            });
            activeSourcesRef.current = [];
            if (audioContextRef.current) {
              nextPlayTimeRef.current = audioContextRef.current.currentTime;
            }
            setLiveStatus('listening');
            return;
          }

          if (msg.audio && audioContextRef.current) {
            const ctx = audioContextRef.current;

            // Decode PCM 24kHz audio from Gemini Live
            const binary = atob(msg.audio);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
              bytes[i] = binary.charCodeAt(i);
            }
            const pcm16 = new Int16Array(bytes.buffer);
            const float32 = new Float32Array(pcm16.length);
            for (let i = 0; i < pcm16.length; i++) {
              float32[i] = pcm16[i] / 32768.0;
            }

            const buffer = ctx.createBuffer(1, float32.length, 24000);
            buffer.copyToChannel(float32, 0);

            // CRITICAL FIX FOR DOUBLE VOICE / CHORUS:
            // Schedule audio chunks sequentially on timeline so they NEVER overlap!
            const now = ctx.currentTime;
            if (nextPlayTimeRef.current < now) {
              nextPlayTimeRef.current = now;
            }

            const srcNode = ctx.createBufferSource();
            srcNode.buffer = buffer;
            srcNode.connect(ctx.destination);
            srcNode.start(nextPlayTimeRef.current);
            nextPlayTimeRef.current += buffer.duration;

            activeSourcesRef.current.push(srcNode);
            setLiveStatus('speaking');

            srcNode.onended = () => {
              activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== srcNode);
              if (activeSourcesRef.current.length === 0) {
                setLiveStatus('listening');
              }
            };
          }

          if (msg.text) {
            const executed = executeAiActions(msg.text);
            if (executed.length > 0) {
              setMessages((prev) => [
                ...prev,
                {
                  id: `msg_live_action_${Date.now()}`,
                  role: 'assistant',
                  content: msg.text,
                  timestamp: Date.now(),
                  modelUsed: 'gemini-3.1-flash-live-preview',
                  executedActions: executed,
                },
              ]);
            }
          }
        } catch (e) {
          console.error('Error handling live audio chunk:', e);
        }
      };

      ws.onerror = (err) => {
        console.error('WebSocket live error:', err);
        setLiveStatus('error');
        stopLiveSession();
      };

      ws.onclose = () => {
        setIsLiveActive(false);
        setLiveStatus('idle');
      };
    } catch (err: any) {
      console.error('Failed to start Live API session:', err);
      setLiveStatus('error');
      setIsLiveActive(false);
    }
  };

  const stopLiveSession = () => {
    if (liveWsRef.current) {
      try {
        liveWsRef.current.close();
      } catch (_) {}
      liveWsRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
    if (micContextRef.current) {
      try {
        micContextRef.current.close();
      } catch (_) {}
      micContextRef.current = null;
    }
    activeSourcesRef.current.forEach((s) => {
      try { s.stop(); } catch (_) {}
    });
    activeSourcesRef.current = [];
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch (_) {}
      audioContextRef.current = null;
    }
    nextPlayTimeRef.current = 0;
    setIsLiveActive(false);
    setLiveStatus('idle');
  };

  // Browser Speech-to-Text Dictation for quick voice input in the text box
  const toggleVoiceDictation = () => {
    if (isDictating) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (_) {}
      }
      setIsDictating(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Speech Recognition is not supported in this browser. Please use Google Chrome or Edge, or use the "START VOICE (LIVE API)" button above.');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'hi-IN, en-US';

      recognition.onstart = () => {
        setIsDictating(true);
      };

      recognition.onresult = (event: any) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        if (transcript) {
          setInputText(transcript);
        }
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsDictating(false);
      };

      recognition.onend = () => {
        setIsDictating(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.error('Failed to start speech recognition:', err);
      setIsDictating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className={`fixed z-50 transition-all duration-300 ${
        isExpanded
          ? 'inset-2 sm:inset-6 bg-neutral-950 border border-neutral-700 shadow-2xl'
          : 'bottom-2 sm:bottom-4 right-2 sm:right-4 w-[95vw] sm:w-[500px] md:w-[540px] h-[85vh] max-h-[720px] bg-neutral-950 border border-neutral-700 shadow-2xl'
      } flex flex-col font-mono text-neutral-100 overflow-hidden`}
    >
      {/* Top Header */}
      <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 sm:py-3 bg-neutral-900 border-b border-neutral-800 flex-shrink-0">
        <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
          <div className="p-1.5 bg-neutral-100 text-neutral-950 flex-shrink-0 shadow-sm">
            <Bot className="w-4 h-4" />
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-bold text-xs sm:text-sm text-white tracking-tight uppercase">
                AUTONOMOUS EDGE COPILOT
              </span>
              <span className="text-[9px] px-1.5 py-0.2 bg-emerald-950 text-emerald-400 border border-emerald-800/80 font-bold">
                OPERATOR ACTIVE
              </span>
            </div>
            <span className="text-[10px] text-neutral-400 font-sans truncate">
              {operatorUsername ? `Logged in: ${operatorUsername}` : 'Guest Operator'} • Live Action Controller
            </span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1 text-neutral-400">
          {/* TTS Toggle */}
          <button
            onClick={() => setAutoSpeak(!autoSpeak)}
            title={autoSpeak ? "Auto-speak answers: ON" : "Auto-speak answers: OFF"}
            className={`p-1.5 hover:text-white transition-colors ${autoSpeak ? 'text-emerald-400 bg-neutral-800' : ''}`}
          >
            {autoSpeak ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          </button>

          {/* Expand / Minimize */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            title={isExpanded ? "Collapse view" : "Expand view"}
            className="p-1.5 hover:text-white transition-colors hidden sm:block"
          >
            {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>

          {/* Close */}
          <button
            onClick={onClose}
            title="Close Copilot"
            className="p-1.5 hover:text-white hover:bg-neutral-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Model & Voice Bar */}
      <div className="px-3 sm:px-4 py-2 bg-neutral-925 border-b border-neutral-800/80 flex flex-wrap items-center justify-between gap-2 text-xs flex-shrink-0">
        {/* Model Selector */}
        <div className="flex items-center gap-1.5">
          <Cpu className="w-3.5 h-3.5 text-neutral-500" />
          <span className="text-[10px] text-neutral-400 uppercase">Model:</span>
          <select
            value={modelType}
            onChange={(e) => setModelType(e.target.value as any)}
            className="bg-neutral-900 border border-neutral-750 px-2 py-0.5 text-[11px] text-neutral-200 font-mono focus:border-emerald-500 focus:outline-none"
          >
            <option value="general">gemini-3.5-flash (General)</option>
            <option value="fast">gemini-3.1-flash-lite (Fast)</option>
            <option value="complex">gemini-3.1-pro-preview (Reasoning)</option>
          </select>
        </div>

        {/* Key Settings Button */}
        <div className="flex items-center gap-2">
          <button
            onClick={onOpenLogin}
            title="Configure Operator & Gemini Key"
            className="p-1 text-neutral-400 hover:text-white hover:bg-neutral-800 border border-neutral-800 transition-colors"
          >
            <Key className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Voice Status Alert if Live */}
      {isLiveActive && (
        <div className="bg-emerald-950/60 border-b border-emerald-800/80 px-4 py-1.5 flex items-center justify-between text-[11px] text-emerald-300 animate-in fade-in">
          <div className="flex items-center gap-2">
            <Radio className="w-3.5 h-3.5 animate-spin text-emerald-400" />
            <span>Live Voice Audio Active (gemini-3.1-flash-live-preview) — Speak into your mic!</span>
          </div>
          <span className="text-[10px] font-mono text-emerald-400 font-bold">{liveStatus.toUpperCase()}</span>
        </div>
      )}

      {/* Messages Thread (Scrollable) */}
      <div className="flex-1 p-3 sm:p-4 overflow-y-auto space-y-3.5 text-xs">
        {messages.map((m) => {
          const isUser = m.role === 'user';
          return (
            <div
              key={m.id}
              className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} space-y-1`}
            >
              <div className="flex items-center gap-1.5 text-[10px] text-neutral-500 uppercase px-1">
                <span>{isUser ? operatorUsername || 'Operator' : 'Autonomous AI'}</span>
                <span>•</span>
                <span>{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                {m.modelUsed && (
                  <>
                    <span>•</span>
                    <span className="text-emerald-500">{m.modelUsed}</span>
                  </>
                )}
                <span>•</span>
                <CopyButton text={stripActionTags(m.content)} label="COPY" title="Copy full message" />
              </div>

              <div
                className={`max-w-[90%] p-3 text-xs leading-relaxed ${
                  isUser
                    ? 'bg-neutral-800 text-white border border-neutral-700'
                    : 'bg-neutral-900 text-neutral-200 border border-neutral-800'
                }`}
              >
                <MessageBody content={m.content} />

                {/* Speak this message button for assistant */}
                {!isUser && (
                  <div className="mt-2 pt-2 border-t border-neutral-800/80 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => playTtsAudio(m.content)}
                      className="flex items-center gap-1 text-[10px] text-neutral-400 hover:text-emerald-400 font-mono transition-colors"
                      title="Clear Voice Playback in matched language"
                    >
                      <Volume2 className="w-3 h-3 text-emerald-400" />
                      <span>{isSpeaking ? 'Playing Voice...' : 'Listen Voice (Clear Audio)'}</span>
                    </button>
                    <span className="text-[9px] text-neutral-500 font-sans">Auto-matches language</span>
                  </div>
                )}

                {/* Executed Action Receipts */}
                {m.executedActions && m.executedActions.length > 0 && (
                  <div className="mt-2.5 pt-2 border-t border-neutral-800 space-y-1 font-mono text-[11px]">
                    <div className="text-emerald-400 font-bold flex items-center gap-1">
                      <Zap className="w-3 h-3" />
                      <span>AUTONOMOUS ACTIONS EXECUTED:</span>
                    </div>
                    {m.executedActions.map((act, idx) => (
                      <div key={idx} className="flex items-center gap-1.5 text-neutral-300 bg-neutral-950 p-1.5 border border-neutral-850">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                        <span>{act}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {isGenerating && (
          <div className="flex items-center gap-2 text-neutral-400 text-xs p-2">
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
            <span className="animate-pulse">Copilot executing autonomous site analysis...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Autonomous Action Prompts */}
      <div className="px-3 sm:px-4 py-2 border-t border-neutral-800 bg-neutral-925 flex-shrink-0 space-y-1.5">
        <div className="flex items-center justify-between text-[10px] text-neutral-500 uppercase">
          <span>1-Click Autonomous Commands:</span>
          <span>Click to execute</span>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          <button
            onClick={() => handleSendMessage('Tum kahan ho, kisme chal rahe ho aur kya-kya kar sakte ho?')}
            className="flex-shrink-0 px-2 py-1 bg-emerald-950/60 hover:bg-emerald-900 border border-emerald-700 text-emerald-300 hover:text-white text-[10px] flex items-center gap-1 transition-colors"
          >
            <Bot className="w-3 h-3 text-emerald-400" />
            <span>Tum kahan ho & kya kar sakte ho?</span>
          </button>
          <button
            onClick={() => handleSendMessage('Puri site chala do aur lowest latency par optimize kar do')}
            className="flex-shrink-0 px-2 py-1 bg-neutral-900 hover:bg-neutral-800 border border-neutral-750 text-neutral-300 hover:text-white text-[10px] flex items-center gap-1 transition-colors"
          >
            <Zap className="w-3 h-3 text-emerald-400" />
            <span>Puri site chala do (Auto-Optimize)</span>
          </button>
          <button
            onClick={() => handleSendMessage('Mera endpoint URL aur curl command do')}
            className="flex-shrink-0 px-2 py-1 bg-neutral-900 hover:bg-neutral-800 border border-neutral-750 text-neutral-300 hover:text-white text-[10px] flex items-center gap-1 transition-colors"
          >
            <Terminal className="w-3 h-3 text-emerald-400" />
            <span>Endpoint + curl command</span>
          </button>
          <button
            onClick={() => handleSendMessage('Python me OpenAI client se connect karne ka snippet do')}
            className="flex-shrink-0 px-2 py-1 bg-neutral-900 hover:bg-neutral-800 border border-neutral-750 text-neutral-300 hover:text-white text-[10px] flex items-center gap-1 transition-colors"
          >
            <Code2 className="w-3 h-3 text-emerald-400" />
            <span>Python snippet</span>
          </button>
          <button
            onClick={() => handleSendMessage('Failover chain Gemini -> Groq -> OpenRouter -> Cerebras set kar do')}
            className="flex-shrink-0 px-2 py-1 bg-neutral-900 hover:bg-neutral-800 border border-neutral-750 text-neutral-300 hover:text-white text-[10px] flex items-center gap-1 transition-colors"
          >
            <Shield className="w-3 h-3 text-emerald-400" />
            <span>Set Failover Chain</span>
          </button>
          <button
            onClick={() => handleSendMessage('Ek instant test inference dispatch chalao aur latency check karo')}
            className="flex-shrink-0 px-2 py-1 bg-neutral-900 hover:bg-neutral-800 border border-neutral-750 text-neutral-300 hover:text-white text-[10px] flex items-center gap-1 transition-colors"
          >
            <Terminal className="w-3 h-3 text-emerald-400" />
            <span>Run Edge Test</span>
          </button>
          <button
            onClick={() => handleSendMessage('Run live ping sweep on all edge nodes')}
            className="flex-shrink-0 px-2 py-1 bg-neutral-900 hover:bg-neutral-800 border border-neutral-750 text-neutral-300 hover:text-white text-[10px] flex items-center gap-1 transition-colors"
          >
            <Activity className="w-3 h-3 text-emerald-400" />
            <span>Sweep Node Ping</span>
          </button>
          <button
            onClick={() => handleSendMessage('Daily quota aur token counters ko reset kar do')}
            className="flex-shrink-0 px-2 py-1 bg-neutral-900 hover:bg-neutral-800 border border-neutral-750 text-neutral-300 hover:text-white text-[10px] flex items-center gap-1 transition-colors"
          >
            <RefreshCw className="w-3 h-3 text-emerald-400" />
            <span>Reset Quota</span>
          </button>
          <button
            onClick={() => handleSendMessage('Generate a new Edge Proxy API key')}
            className="flex-shrink-0 px-2 py-1 bg-neutral-900 hover:bg-neutral-800 border border-neutral-750 text-neutral-300 hover:text-white text-[10px] flex items-center gap-1 transition-colors"
          >
            <Key className="w-3 h-3 text-emerald-400" />
            <span>Generate Proxy Key</span>
          </button>
        </div>
      </div>

      {/* Input Box */}
      <div className="p-3 sm:p-4 bg-neutral-900 border-t border-neutral-800 flex-shrink-0 space-y-1.5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="flex items-center gap-1.5 sm:gap-2"
        >
          {/* AI Voice (Gemini Live Mode) Mic Button */}
          <button
            type="button"
            onClick={isLiveActive ? stopLiveSession : startLiveSession}
            title={
              isLiveActive
                ? "Stop AI Live Voice Mode"
                : "Click to start AI Live Voice Conversation (Gemini Live)"
            }
            className={`p-2 border transition-all flex items-center justify-center flex-shrink-0 ${
              isLiveActive
                ? 'bg-rose-950 text-rose-300 border-rose-600 animate-pulse shadow-lg shadow-rose-950/50'
                : 'bg-neutral-950 hover:bg-emerald-950 hover:border-emerald-700 text-neutral-300 hover:text-emerald-400 border-neutral-750'
            }`}
          >
            {isLiveActive ? (
              <MicOff className="w-4 h-4 text-rose-400" />
            ) : (
              <Mic className="w-4 h-4 text-emerald-400" />
            )}
          </button>

          {/* Text Input */}
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={
              isLiveActive
                ? `🎙️ Live AI Voice Active (${liveStatus.toUpperCase()}) — Bolte rahiye ya yahan type karein...`
                : "Type or click Mic to start AI Voice ('Puri site chala do')..."
            }
            className={`flex-1 bg-neutral-950 border px-3 py-2 text-xs text-neutral-100 placeholder-neutral-500 focus:outline-none transition-colors ${
              isLiveActive ? 'border-emerald-500 bg-emerald-950/20' : 'border-neutral-750 focus:border-emerald-500'
            }`}
          />

          {/* Send Button */}
          <button
            type="submit"
            disabled={!inputText.trim() || isGenerating}
            className="px-3 sm:px-3.5 py-2 bg-neutral-100 hover:bg-white disabled:opacity-40 text-neutral-950 font-bold text-xs uppercase flex items-center gap-1 transition-colors flex-shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">SEND</span>
          </button>
        </form>

        <div className="flex items-center justify-between text-[10px] text-neutral-400 font-sans">
          <span>
            {isLiveActive ? (
              <span className="text-emerald-400 font-semibold flex items-center gap-1.5 animate-pulse">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                AI Voice Active: Speak directly into your mic in Hindi or English!
              </span>
            ) : (
              <span>
                Click <strong>🎙️ Mic</strong> to start instant AI Live Voice, or type below
              </span>
            )}
          </span>
          <span className="text-neutral-500">Press Enter to send</span>
        </div>
      </div>
    </div>
  );
};
