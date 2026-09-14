# Architecture

A file-by-file map of Edge AI Router, plus the invariants that are easy to break.

```
Browser (React SPA)                     Vercel / Node
───────────────────                     ─────────────
localStorage                            11 serverless functions
  er_api_keys_Edge Router  ──┐            api/v1/chat/completions.ts
  er_custom_endpoints_v1   ──┼─► er1.…    api/anthropic/v1/messages.ts
  er_key_health_v1           │  token     api/v1/models.ts
  er_probe_history_v1        │            api/keys/{issue,status,revoke,test}.ts
  er_live_catalog            │            api/catalog/sync.ts
                             │            api/copilot/{chat,tts}.ts
                             │            api/health.ts
                             ▼            middleware.ts (edge, JSON 404)
                        ┌─────────┐
                        │ decrypt │──► provider 1..27  +  your own endpoints
                        └─────────┘
```

No database. No server-side session. The only server-side state is the optional
Vercel KV revocation list and per-instance in-memory rotation counters.

---

## Backend — `api/`

Every function is **self-contained**: no relative `.ts` cross-imports, npm
packages only. This is a hard constraint (see [Invariants](#invariants)).

| File | Lines | Responsibility |
|---|---|---|
| `v1/chat/completions.ts` | ~800 | The OpenAI-compatible gateway. 27-entry `UPSTREAMS` table, `MODEL_UPSTREAM` routing, `detectKeyUpstream`, `orderPool` rotation, `relayOpenAI`, `relayAnthropic`, streaming SSE, SSRF guard, master-key decrypt + revocation check |
| `anthropic/v1/messages.ts` | ~660 | The Anthropic-compatible gateway for Claude Code. Native `sk-ant-` passthrough; otherwise full bidirectional translation (system blocks, images, `tool_use`↔`tool_calls`, `tool_result`↔`role:"tool"`, `input_schema`↔`parameters`, `stop_reason`↔`finish_reason`, token usage) plus OpenAI-SSE → Anthropic-SSE re-synthesis |
| `v1/models.ts` | ~210 | OpenAI model list. Without a key: metadata only. With a raw key: `available` per model. With an `er1…` key: validates it (401 on invalid/expired) and reports availability from the embedded pool |
| `keys/issue.ts` | ~150 | Mints `er1…`. Caps 30 keys/provider, 120 total. Validates `u` tags against the known set and `b` base URLs against the SSRF guard. Warns above 7,000 chars |
| `keys/status.ts` | ~90 | Validates and reports counts + Gmail tags. Never returns key material |
| `keys/revoke.ts` | ~110 | Writes `er:revoked:<mid>` to Vercel KV via raw REST. Degrades to `mode:"local-only"` without KV |
| `keys/test.ts` | ~200 | Probes one key or one custom endpoint with a 5-token request. 25 s abort, `maxDuration: 30`. Returns `ok`/`upstream`/`model`/`latencyMs`/`prefix`/`error` |
| `catalog/sync.ts` | ~250 | Free-only live model catalog. 4 bespoke syncers (Gemini, Groq, OpenRouter, Cerebras) + a generic table driving 22 more, + static lists for Anthropic and Perplexity (no public `/models`). All in `Promise.all`, 8 s each, partial-OK |
| `copilot/chat.ts` | ~200 | The in-app AI operator and its ~180-line system prompt |
| `copilot/tts.ts` | ~60 | Speech synthesis |
| `health.ts` | ~10 | Liveness. Also the target of the frontend's real latency probe |

### Master key format

```
payload = { v:1, mid:<8 random bytes hex>, exp:<now+90d>, label, keys:<pools> }
token   = "er1." + base64url( iv(12) ‖ AES-256-GCM( deflate( JSON(payload) ) ) ‖ tag(16) )
secret  = sha256( MASTER_KEY_SECRET )            # no fallback in production
```

`keys` is a map of provider id → entries of `{ k, g?, u?, b?, m? }`:
`k` raw key · `g` Gmail tag · `u` explicit upstream tag · `b` custom base URL ·
`m` model affinity.

### Routing internals

`PoolItem = { key, hint, base?, aff? }` — `hint` is the resolved upstream id,
`base` a custom endpoint URL, `aff` its model affinity.

`orderPool(pool, target, wantedModel)` buckets then sorts:

```
-1  aff === wantedModel          (custom endpoint that owns this model)
 0  hint === target              (right provider)
 1  hint === "unknown"           (ambiguous prefix — worth a try)
 2  everything else, by UPSTREAM_PRIORITY

within a bucket: not-in-cooldown → fewest failures (429×3 + other)
                 → least recently used → original index
```

Counters are module-level `Map`s keyed by `sha256(key).slice(0,16)`:
`keyCooldownUntil`, `keyFail429`, `keyFailOther`, `keyLastUsed`.

**These are per warm instance.** On serverless each lambda has its own and cold
starts wipe them, so server-side rotation memory is best-effort. The durable
memory is the client-side `keyHealth` store.

### Streaming invariant

Response headers are written **only after the chosen upstream returns 200**.
That is what allows key rotation to work in streaming mode: a 429 on key #1 can
still fall through to key #2 before any byte reaches the client. Once streaming
has begun we are committed and cannot retry. Do not "optimise" this by writing
headers early.

### Failure accounting

| Upstream status | Effect |
|---|---|
| `429` | 60 s cooldown, `fail429++`, prefix → `rate_limited_prefixes` |
| `401`/`403` **and** the key failed against its own provider or its own custom endpoint | prefix → `dead_key_prefixes` (client quarantines it) |
| `401`/`403` against a *guessed* provider | `failOther++` only — deprioritised, not killed |
| `400`/`404` from a fallback provider | retryable — that provider just doesn't host the model |
| `400`/`404` from the model's own provider | terminal |
| `5xx` | retryable |

### SSRF guard

Two layers, both required:

1. **String** (`isAllowedUpstream` / `allowedBase`): `https:` only; either an exact
   match against the 27 known hosts, or a public dotted hostname that is not
   `localhost` / `*.local` / `*.internal` / RFC1918 / link-local / IPv6 literal.
2. **DNS** (`isSafeHostDns`): resolves the hostname and rejects it if *any*
   returned address is private or reserved (0/8, 10/8, 100.64/10, 127/8,
   169.254/16, 172.16/12, 192.0.0/16, 192.168/16, 198.18/15, 224/4, IPv6
   `::`/`::1`/ULA/link-local/multicast, IPv4-mapped IPv6). Cached 60 s. Literal
   IPs skip the lookup.

Layer 1 alone is bypassable by a public domain with an `A` record of `127.0.0.1`.
Known-good upstreams are constants and skip layer 2 entirely, so only custom
endpoints pay for a resolution.

---

## `server.ts`

The local-development mirror: every API route re-implemented on Express, plus the
WebSocket live-voice path that Vercel serverless cannot host.

Deliberately **side-effect-free at import time** — `ws` and `@google/genai` are
lazy-`import()`ed inside handlers, and `startServer()` only runs when
`NODE_ENV !== "test"` and not on a serverless platform. That came out of a
deploy-crash debugging session; keep it that way.

When you change gateway behaviour in `api/`, mirror it here. The Anthropic
translator currently exists in both places.

---

## Frontend — `src/`

### State and persistence (`App.tsx`)

Everything lives in `localStorage`:

```
er_providers            er_endpoints           er_active_provider
er_routing_policy       er_fallback_chain      er_recent_decisions (30)
er_daily_usages         er_watchdog_active     er_watchdog_logs (50)
er_notifications (50)   er_live_catalog        er_model_status
er_model_filter         er_key_health_v1       er_custom_endpoints_v1
er_api_keys_<id>        er_master_key          er_master_meta
er_probe_history_v1     er_onboarded_v1        er_data_version
er_users                er_session_user        er_operator_username
er_gemini_key           edge_router_proxy_key
```

`runDataMigrations()` executes at **module scope**, before any `useState`
initializer reads storage. An earlier version ran it inside a later initializer,
so stale provider lists won the race. Do not move it.

Tabs are `React.lazy` + `Suspense`; first paint downloads only the shell.

### Utils

| File | Responsibility |
|---|---|
| `providerKeys.ts` | The universal key pool. `KeyEntry {k,g,s,a,u?}`, `UPSTREAM_IDS` (27), `detectKeyUpstream`, `effectiveUpstream` (tag wins), `keyId` (prefix:length:hash), migration from legacy per-provider pools |
| `keyHealth.ts` | Per-key health store, cooldown bookkeeping, `displayStatus`, `smartOrderIndexes` (client-side LRU) |
| `customEndpoints.ts` | Your own OpenAI-compatible endpoints: validation (client SSRF mirror), CRUD, `customPoolEntries` → master-key pool, `customEndpointsSig` for staleness |
| `masterKey.ts` | Shared master-key helpers: build pools, sign, staleness, issue/revoke, count |
| `catalog.ts` | Live catalog sync/diff, per-model key status, `isModelGoneError` (matches model-existence errors only — never quota or auth) |
| `upstream.ts` | Frontend mirror of the routing tables |
| `probe.ts` | Real telemetry: `/api/health` round-trips stored as rolling history, median/p95/uptime computed from genuine samples |
| `auth.ts` | Client-side operator accounts |
| `notify.ts` | Notification bus (persisted, capped, 5 kinds) |
| `copy.ts` | Clipboard with fallback, action-tag stripping, code-block splitting |

### Components

`Navbar` · `MobileTabBar` · `OnboardingWizard` · `BentoDashboard` · `EdgeTester` ·
`DailyQuotaTracker` · `TelemetryView` · `ConnectHub` · `ApiMonitor` ·
`AutonomousCopilot` · `WorkerExporter` · `ProviderKeysModal` · `ProviderModal` ·
`EndpointModal` · `OperatorLoginModal` · `ProfileModal` · `NotificationsBell` ·
`Toasts` · `CopyButton` · `SkeletonLoader`

### Services

`edgeRouterEngine.ts` — 5 routing policies, regional proximity matrix, 60 s
in-memory response cache, tier demotion, cross-provider fallback that skips
providers with no usable keys, and the async live health sweep.

`autonomousWatchdog.ts` — three self-heal rules run every 25 s: quota ≥85% →
switch provider; slowest tier-1 node >65 ms while fastest <30 ms → demote/promote;
latency spread >45 ms → force `lowest-latency`. Plus `SmartPromptRouter`, which
classifies a prompt by keyword and length to pick a model tier.

---

## Design system

`src/index.css` holds three layers:

1. **Tokens** — `--ui-*` custom properties for surfaces, lines, text, brand,
   semantics, radii, elevation, motion and safe-area insets.
2. **Components** — `ui-card`, `ui-glass`, `ui-inset`, `ui-btn` (+ primary / ghost
   / danger / sizes), `ui-input` / `ui-select` / `ui-textarea` / `ui-label` /
   `ui-hint`, `ui-badge`, `ui-chip`, `ui-dot-live`, `ui-track` / `ui-bar`,
   typography scale, `ui-tabbar`, `ui-modal-card`.
3. **Upgrade pass** — remaps the legacy brutalist utilities (`neutral-800/900/950`,
   `rounded-none`) onto the v2 tokens. Tailwind v4 emits utilities inside
   `@layer utilities`, and unlayered rules beat layered ones, so these override
   without `!important` while `hover:` / `focus:` variants keep working. Only
   paint properties are touched — never layout — so nothing reflows.

Accessibility baseline: visible `:focus-visible` rings, `prefers-reduced-motion`
support, `::selection`, 44 px targets and 16 px inputs under `pointer: coarse`,
and `env(safe-area-inset-*)` on the header and bottom tab bar.

---

## Invariants

Break one of these and something fails in production, not in review.

1. **No relative `.ts` cross-imports between `api/` functions.** Each is
   self-contained. Consequence: routing tables are duplicated — when you add a
   provider, update every copy (`api/v1/chat/completions.ts`,
   `api/anthropic/v1/messages.ts`, `api/v1/models.ts`, `api/catalog/sync.ts`,
   `api/keys/test.ts`, `server.ts`, `src/utils/upstream.ts`,
   `src/utils/providerKeys.ts`).
2. **At most 12 serverless functions** (Vercel Hobby). We ship 11. CI enforces it.
3. **`MASTER_KEY_SECRET` has no fallback.** CI fails if a published secret string
   returns to the tree.
4. **Streaming writes headers only after upstream 200.**
5. **`runDataMigrations()` runs at module scope**, before any `useState`
   initializer.
6. **Telemetry is real or zero.** Never fabricate a latency or an uptime figure;
   render unmeasured as `0` / "not measured".
7. **`server.ts` stays side-effect-free at import time.**
8. **Keep `api/` and `server.ts` in parity** for gateway behaviour.

---

## Tests

`npm test` runs 70 unit tests over the pure logic: model→provider routing and its
prefix heuristics, key-prefix detection for all 27 providers, explicit-tag
precedence, upstream registry integrity, key health transitions and cooldown
expiry, LRU ordering, `keyId` collision resistance, custom-endpoint SSRF
validation (15 rejection cases), CRUD, pool entry shape, staleness signatures, and
probe statistics.

`src/test/setup.ts` stubs `window` / `localStorage` with an in-memory
implementation, so the browser utils are testable without a DOM.
