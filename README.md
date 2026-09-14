# Edge AI Router

**One key. Every AI provider.**

A bring-your-own-key gateway that puts **27 AI providers** behind a single
OpenAI-compatible URL and a single Anthropic-compatible URL — with automatic
key rotation, live health monitoring, and a zero-database control panel.

Your provider keys never leave your browser. They are packed into one encrypted
`er1…` token that you paste into Claude Code, Cursor, Cline, Zed, Aider, your own
app — anything that speaks OpenAI or Anthropic.

```bash
export ANTHROPIC_BASE_URL="https://<your-host>/api/anthropic"
export ANTHROPIC_API_KEY="er1.xxxxxxxxxxxxxxxx"
export ANTHROPIC_MODEL="gemini-flash-latest"
claude          # <- Claude Code, running on a Gemini key
```

---

## Why

Every provider has a different API, a different key format, different rate limits
and a different model naming scheme. Wiring an editor or agent to more than one of
them means either a subscription per provider, or maintaining glue code yourself.

Edge AI Router is that glue, once:

| | |
|---|---|
| **One URL** | `POST /api/v1/chat/completions` (OpenAI) and `POST /api/anthropic/v1/messages` (Anthropic) |
| **Auto-routing** | The model name picks the provider; the key prefix picks the account |
| **Failover** | A 429 or dead key rotates to the next one mid-request, transparently |
| **Streaming** | Real SSE on both gateways, including Anthropic → OpenAI chunk translation |
| **Tools & vision** | `tool_calls`, `tool_choice`, multimodal content and images pass through |
| **No backend state** | No database, no accounts service. Keys are encrypted into the token you hold |
| **Self-hostable** | Vercel, or `npm run dev` / `npm start` anywhere Node 18+ runs |

---

## Supported providers (27)

Gemini · Groq · OpenRouter · Cerebras · OpenAI · Anthropic · DeepSeek · Mistral ·
xAI · Perplexity · Together · Fireworks · SiliconFlow · Novita · Hyperbolic ·
Chutes · GLHF · Cohere · Zhipu GLM · Alibaba Qwen · Moonshot/Kimi · GitHub Models ·
HuggingFace · SambaNova · Nebius · DeepInfra · **Pollinations (free, no signup)**

Plus **your own endpoints**: any OpenAI-compatible server (vLLM, LM Studio,
Ollama, LiteLLM, RunPod, your own proxy) can be registered as a first-class
provider with its own model affinity.

> New here and don't have keys yet? The setup wizard has a **Start free** button
> that adds a Pollinations key — no signup, no billing — so you can send your
> first request immediately.

---

## Quick start

### Use the hosted gateway

1. Open the app and create an operator login (a Gemini key is required for the
   in-app Copilot; the gateways themselves are strictly BYO-key).
2. The **setup wizard** walks you through adding and verifying a key.
3. Open **CONNECT** → generate your master key → copy the config for your client.

### Run it locally

```bash
npm install
npm run dev          # http://localhost:3000  (Express + Vite + WebSocket live voice)
```

### Deploy to Vercel

1. Import the repo. Build command `npm run build`, output directory `dist`.
2. **Set `MASTER_KEY_SECRET`** — this is required. See [Security](#security).
3. Optionally add `KV_REST_API_URL` + `KV_REST_API_TOKEN` (Vercel KV) to make
   master-key revocation authoritative.

> **Hobby plan note:** Vercel Hobby caps a project at **12 serverless functions**.
> This repo ships **11**. CI fails the build if a 12th is added.

---

## API

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/chat/completions` | OpenAI-compatible gateway. Supports `stream`, `tools`, `tool_choice`, multimodal content |
| `POST` | `/api/anthropic/v1/messages` | Anthropic-compatible gateway. Native `sk-ant-` passthrough, otherwise full translation with SSE |
| `GET` | `/api/v1/models` | OpenAI model list. With a master key, each model carries a real `available` flag |
| `POST` | `/api/keys/issue` | Mint an encrypted `er1…` master key from your key pool |
| `POST` | `/api/keys/status` | Validate a master key; returns counts and Gmail tags, **never the keys** |
| `POST` | `/api/keys/revoke` | Blocklist a master key id in Vercel KV |
| `POST` | `/api/keys/test` | Probe one key (or one custom endpoint) and measure real latency |
| `POST` | `/api/catalog/sync` | Live model catalog fan-out across 26 providers |
| `POST` | `/api/copilot/chat` | In-app AI operator |
| `POST` | `/api/copilot/tts` | Speech synthesis |
| `GET` | `/api/health` | Liveness. Also used by the app's real latency probe |
| `WS` | `/api/copilot/live` | Live voice (local server only — Vercel serverless has no WebSockets) |

Unknown `/api/*` paths return a JSON 404 listing the real routes (edge middleware).

### Authentication

Send your key in any of the standard places — `Authorization: Bearer …`,
`x-api-key` (what Claude Code uses), `x-gemini-key`, or `body.apiKeys[]`.
A raw provider key works directly; an `er1…` master key is decrypted and its
whole pool becomes available for rotation.

### Response metadata

Every gateway response carries the routing decision, so a client can see what
actually happened:

```jsonc
"edge_routing": {
  "provider": "Groq",
  "upstream_id": "prov-groq",
  "key_index": 2,
  "keys_tried": 3,
  "dead_key_prefixes": ["gsk_xyz"],       // quarantine these client-side
  "rate_limited_prefixes": ["gsk_abc"],   // cool these down, don't delete them
  "latency_ms": 812,
  "status": "200 OK"
}
```

Plus `X-Edge-Upstream`, `X-Edge-Key-Index`, `X-Edge-Keys-Tried` and
`X-Edge-Latency-Ms` headers.

---

## How routing works

Two independent axes, plus an override:

**1. Model → provider.** ~90 exact entries, then prefix heuristics
(`gemini-*` → Gemini, `gpt-*`/`o1-*`/`o3-*`/`chatgpt-*` → OpenAI, `claude-*` →
Anthropic, `deepseek-*` → DeepSeek, `grok*` → xAI, `sonar*` → Perplexity,
`glm-*` → Zhipu, `qwen*` → Qwen, `hf:*` → GLHF, `accounts/*` → Fireworks,
`*:free` → OpenRouter).

**2. Key → account.** By prefix: `AIza…`/`AQ.…` → Gemini, `gsk_` → Groq,
`sk-or-` → OpenRouter, `csk-` → Cerebras, `sk-proj-`/`sk-svcacct-` → OpenAI,
`sk-ant-` → Anthropic, `xai-` → xAI, `pplx-` → Perplexity, `fw_` → Fireworks,
`ghp_`/`github_pat_` → GitHub Models, `hf_` → HuggingFace, `pollinations-*` → free.

**3. Explicit tag wins.** Fourteen providers issue ambiguous `sk-…` keys
(DeepSeek, Together, Mistral, SiliconFlow, Novita, Hyperbolic, Chutes, Cohere,
Zhipu, Qwen, Moonshot, SambaNova, Nebius, DeepInfra). For those, set the provider
per key in the **Keys** panel and the tag overrides prefix detection everywhere —
routing, catalog sync, and the monitor.

**4. Custom endpoints always win.** A key whose model affinity matches the
requested model is tried before everything else, so your own infrastructure gets
first refusal.

### Rotation order

Keys are bucketed, then sorted within each bucket:

```
bucket -1  key's model affinity matches the request      (your custom endpoints)
bucket  0  key's provider matches the model's provider
bucket  1  key with an unknown prefix
bucket  2  everything else, in provider-priority order

within a bucket:
  not in cooldown  ->  fewest failures (429 weighted x3)  ->  least recently used  ->  pool order
```

A `429` cools a key down for 60 s. A `401`/`403` only quarantines a key as *dead*
when it failed against **its own** provider — a key rejected by a provider we
guessed at is merely deprioritised, because that is usually our mistake, not a
dead key. A `404` from a fallback provider is retryable, since it just means that
provider doesn't host the model.

---

## The control panel

| Tab | What it does |
|---|---|
| **Nodes** | Providers, endpoints, weights, tiers, routing policy, failover chain, live decision feed |
| **Tester** | Send a real request through the gateway and see which provider and which key served it |
| **Quota** | Daily token burn per provider, with next-fallback hints |
| **Metrics** | Latency, uptime and the routing decision stream |
| **Connect** | Generate your master key, verify it, and copy a ready-made config for 18 clients |
| **Keys** | Live per-key health: WORKING / EXHAUSTED / DEAD, real measured latency, test / revive / delete |

### Connect: 18 clients

Claude Code · OpenCode · Cline · Roo Code · Kilo Code · Continue · Cursor ·
Windsurf · Void · Zed · Neovim (avante) · Aider · Crush · Open WebUI · cURL ·
Python (`openai`) · Node.js (`openai`) · Vercel AI SDK.

Each one gets numbered steps and a copy-ready snippet with your base URL, master
key and chosen model already filled in. LibreChat, LobeChat, AnythingLLM,
SillyTavern and TypingMind follow the Open WebUI pattern.

### Key health is measured, not guessed

The **Keys** tab probes each key with a real 5-token request and stores the
result: status, round-trip latency, success / 429 / auth / other counters, and a
cooldown countdown. "Test all" runs sequentially with a deliberate 350–400 ms gap
so the monitor cannot itself cause the rate limits it is reporting.

Health records are keyed by `prefix:length:hash`, so raw keys are never used as
storage keys.

---

## Environment

See [`.env.example`](.env.example).

| Variable | Required | Purpose |
|---|---|---|
| `MASTER_KEY_SECRET` | **Yes, in production** | Encrypts `er1…` master keys. No fallback value exists |
| `GEMINI_API_KEY` | No | Server-side fallback for the in-app Copilot only |
| `APP_URL` | No | Canonical public URL, used for the `HTTP-Referer` attribution header |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | No | Makes master-key revocation authoritative |

---

## Security

**Read this before deploying.**

### `MASTER_KEY_SECRET` is mandatory

An `er1…` token is a self-contained encrypted blob holding a user's **raw provider
keys**. There is deliberately **no fallback secret** in the codebase: if
`MASTER_KEY_SECRET` is unset while `NODE_ENV=production` (or on Vercel), the key
endpoints refuse to run and return a 500 explaining why.

Generate one with `openssl rand -hex 32`. Minimum length is 16 characters.
Rotating it invalidates existing tokens.

In local development a stable, machine-local secret is generated automatically
into `.master-key-dev.secret` (mode `0600`, gitignored), so dev stays zero-config
without a published constant.

### Other protections

- **SSRF:** user-supplied base URLs must be `https`, must not be a private or
  reserved hostname, and are additionally **DNS-resolved** before use — a public
  domain pointing at `127.0.0.1` or `169.254.169.254` is rejected. Results are
  cached for 60 s; known-good providers skip the lookup entirely.
- **Revocation fails open.** If Vercel KV is missing or unreachable, a KV outage
  never blocks inference. Without KV, `revoke` wipes the local copy and reports
  `mode: "local-only"` — distributed copies keep working until they expire
  (90 days).
- **Keys are never logged**, and `/api/keys/status` returns counts and Gmail tags
  only, never key material.

### Known limitations

These are deliberate trade-offs, not oversights — but you should know them:

- **Auth is client-side.** Operator accounts and the raw key pool live in
  `localStorage`. Any XSS or shared-machine scenario exposes them. There are no
  server-side accounts and no multi-device sync.
- **Password hashes** are `sha256("er:<username>:<password>")` — salted by
  username only.
- **The Copilot mutates app state.** It emits `[ACTION:…]` tags that the UI
  executes (set keys, add providers, change policy). Treat anything that can
  influence model output as untrusted.
- **Token size.** A master key holding many keys can exceed client header limits.
  The issuer warns above 7,000 characters.

---

## Development

```bash
npm run dev        # Express + Vite + WebSocket live voice on :3000
npm run typecheck  # tsc --noEmit
npm test           # vitest (70 unit tests over routing, health, endpoints, telemetry)
npm run build      # SPA + bundled server
npm start          # run the built server
npm run ci         # typecheck + test + build, as CI runs it
```

CI runs on every push and PR, and additionally guards three deploy-critical
invariants: the 12-function Vercel Hobby budget, the absence of any published
fallback secret, and the initial JS bundle size.

### Architecture notes

- **No relative `.ts` cross-imports between `api/` functions.** Each serverless
  function must be self-contained with npm imports only. This came out of a long
  Vercel serverless-crash debugging session and is the reason routing tables are
  duplicated across functions. If you add a provider, update every copy.
- **`server.ts` mirrors the API routes** for local development, including the
  WebSocket live-voice path that Vercel serverless cannot host. Keep them in
  parity when you change gateway behaviour.
- **The frontend is code-split.** Tab panels are `React.lazy`; first paint only
  downloads the shell. Keep heavy components lazy.
- **Telemetry is real or it is zero.** Endpoint latency and uptime come from
  actual `/api/health` round-trips accumulated over time (`src/utils/probe.ts`).
  Unmeasured values render as `0`, never as a plausible-looking fabricated number.

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full file-by-file map.

---

## Design

Dark, technical, high-contrast — a control room, not a marketing page. All colours,
radii, elevation and motion live as CSS custom properties in
[`src/index.css`](src/index.css), so the whole app can be re-themed in one place.

Mobile is a first-class target: thumb-reachable bottom navigation with
`env(safe-area-inset-bottom)`, 44 px tap targets, 16 px inputs to stop iOS
zoom-on-focus, modals that become bottom sheets, and full
`prefers-reduced-motion` support.

---

## License

Apache-2.0 — see [LICENSE](LICENSE).
