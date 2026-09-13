// Custom Endpoints — user's OWN OpenAI-compatible configs (own proxy, vLLM, LM Studio
// tunnel, Ollama cloud, LiteLLM...). Stored locally, embedded into the master key on
// generate ({k,u,b,m}), honored by every gateway with model-affinity routing.
export interface CustomEndpointTest {
  ok: boolean;
  latencyMs: number;
  at: number;
  error?: string;
}

export interface CustomEndpoint {
  id: string; // ce_xxxx
  name: string; // "My RunPod vLLM"
  baseUrl: string; // https://xxx/v1 (no trailing slash)
  key: string; // api key for that endpoint
  model: string; // model id to request on that endpoint
  tag: string; // upstream tag hint (prov-*) or '' for auto
  enabled: boolean;
  createdAt: number;
  lastTest?: CustomEndpointTest;
}

const LS_KEY = 'er_custom_endpoints_v1';

function uid(): string {
  try {
    const a = new Uint8Array(4);
    crypto.getRandomValues(a);
    return 'ce_' + Array.from(a).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return 'ce_' + Math.random().toString(36).slice(2, 10);
  }
}

export function listCustomEndpoints(): CustomEndpoint[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((e) => e && typeof e.id === 'string' && typeof e.baseUrl === 'string');
  } catch {
    return [];
  }
}

function persist(list: CustomEndpoint[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch { /* quota — ignore */ }
}

export function validateCustomEndpoint(draft: { name: string; baseUrl: string; key: string; model: string }): string {
  if (!draft.name.trim()) return 'Endpoint ko ek naam do (jaise "My vLLM").';
  const b = draft.baseUrl.trim().replace(/\/+$/, '');
  if (!b) return 'Base URL dalo (jaise https://my-proxy.com/v1).';
  try {
    const u = new URL(b);
    if (u.protocol !== 'https:') return 'Base URL https hona chahiye (http/localhost allowed nahi).';
    const host = u.hostname.toLowerCase();
    if (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
      return 'Public hostname chahiye — localhost/private yaha nahi chalega.';
    }
    if (/^(10\.|127\.|192\.168\.|169\.254\.|0\.0\.0\.0)/.test(host)) return 'Private IP allowed nahi hai.';
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return 'Private IP allowed nahi hai.';
  } catch {
    return 'Base URL galat hai — poora https URL dalo.';
  }
  if (!draft.key.trim() || draft.key.trim().length < 4) return 'Is endpoint ki API key dalo.';
  if (!draft.model.trim()) return 'Model id dalo (jo model is endpoint pe chalega).';
  return '';
}

export function addCustomEndpoint(draft: { name: string; baseUrl: string; key: string; model: string; tag: string }): CustomEndpoint {
  const list = listCustomEndpoints();
  const ep: CustomEndpoint = {
    id: uid(),
    name: draft.name.trim().slice(0, 60),
    baseUrl: draft.baseUrl.trim().replace(/\/+$/, '').slice(0, 200),
    key: draft.key.trim(),
    model: draft.model.trim().slice(0, 120),
    tag: draft.tag || '',
    enabled: true,
    createdAt: Date.now(),
  };
  list.push(ep);
  persist(list);
  return ep;
}

export function updateCustomEndpoint(id: string, patch: Partial<CustomEndpoint>): boolean {
  const list = listCustomEndpoints();
  const i = list.findIndex((e) => e.id === id);
  if (i === -1) return false;
  list[i] = { ...list[i], ...patch, id: list[i].id };
  persist(list);
  return true;
}

export function deleteCustomEndpoint(id: string) {
  persist(listCustomEndpoints().filter((e) => e.id !== id));
}

export function setCustomEndpointTest(id: string, t: CustomEndpointTest) {
  updateCustomEndpoint(id, { lastTest: t });
}

// Signature for stale-master detection (endpoints+keys change => regenerate).
export function customEndpointsSig(): string {
  const list = listCustomEndpoints()
    .filter((e) => e.enabled)
    .map((e) => `${e.baseUrl}|${e.key.slice(0, 12)}|${e.model}|${e.tag}`)
    .sort()
    .join('~');
  let h = 0x811c9dc5;
  for (let i = 0; i < list.length; i++) { h ^= list.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `c${h.toString(36)}:${list.length}`;
}

// Master-key pool entries for enabled customs: single "custom" pool, each entry
// carries its own base (b) + model affinity (m) + optional upstream tag (u).
export function customPoolEntries(): { k: string; g: string; u?: string; b: string; m: string }[] {
  return listCustomEndpoints()
    .filter((e) => e.enabled && e.key.trim().length >= 4 && e.baseUrl && e.model)
    .map((e) => ({
      k: e.key.trim(),
      g: '',
      ...(e.tag ? { u: e.tag } : {}),
      b: e.baseUrl,
      m: e.model,
    }));
}

export function maskEndpointKey(k: string): string {
  if (!k) return '';
  if (k.length <= 10) return '••••••';
  return `${k.slice(0, 4)}••••${k.slice(-3)}`;
}
