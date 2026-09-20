/**
 * ASH — single source of truth.
 * Every fact on this site traces back to the real ASH 1.6 build.
 * Nothing here is invented: no fake users, no fake numbers, no fake proofs.
 */

export const ASH = {
  name: "ash",
  title: "Developer · Creator of Asheo",
  distribution: "Distributed on Telegram",
} as const;

export const ASHEO = {
  name: "Asheo",
  version: "1.6.1",
  buildFolder: "ASH 1.6",
  manifestVersion: 3,
  minChrome: 116,
  omniboxKeyword: "asheo",
  description:
    "Custom payment gateways, BIN tools, and integrity checks as a clean MV3 extension.",
  githubTree: "https://github.com/shaikhmuzakkir003-blip/AAS/tree/main/ASH%201.6",
  githubRepo: "https://github.com/shaikhmuzakkir003-blip/AAS",
  /** ash drops Asheo on Telegram — paste the invite link here when he shares it. */
  telegramUrl: "",
} as const;

export const NAV_LINKS = [
  { label: "Manifesto", href: "#manifesto" },
  { label: "Asheo", href: "#asheo" },
  { label: "Inside", href: "#inside" },
  { label: "Craft", href: "#craft" },
  { label: "Hall of Fame", href: "#fame" },
] as const;

/** The 8 real sections of the Asheo Control Center (popup.html nav). */
export type Feature = {
  id: string;
  tab: string;
  badge?: string;
  title: string;
  tagline: string;
  desc: string;
  engine: string[];
  license?: boolean;
};

export const FEATURES: Feature[] = [
  {
    id: "dashboard",
    tab: "Home",
    title: "Mission control for money movement",
    tagline: "One window. Total command.",
    desc: "Asheo opens into a Control Center — a single popup workspace where every engine reports for duty. No scattered pages, no clutter: Home is the launchpad, and everything else is one click down the rail.",
    engine: ["popup.html", "functions/popup-boot.js", "functions/first-run-guard.js"],
  },
  {
    id: "gateways",
    tab: "Payment Rules",
    title: "Payment rules, engineered",
    tagline: "Match. Validate. Transform. Route.",
    desc: "Custom gateway logic sits at the heart of Asheo. Every request runs through the gateway engine — matcher, validator, transformer — and then down the v3 router pipeline: registry, interceptors, response hooks. Rules you write, executed at machine speed.",
    engine: [
      "engine/gatewayEngine.js",
      "engine/matcher.js",
      "engine/validator.js",
      "engine/transformer.js",
      "router/v3/request-pipeline.js",
      "router/v3/gateway-registry.js",
      "router/v3/interceptors.js",
      "router/v3/response-hooks.js",
    ],
  },
  {
    id: "bins",
    tab: "Card Profiles",
    title: "Card profiles & BIN tooling",
    tagline: "Profiles that think ahead.",
    desc: "Card Profiles pair BIN tooling with a full algo runtime — candidate generation, validation, orchestration and encryption helpers. Built for developers and QA who test payment integrations for a living.",
    engine: [
      "algo/generator.js",
      "algo/v2-candidate-generator.js",
      "algo/v2-validator.js",
      "algo/v2-orchestrator.js",
      "algo/adyenEncryptor.js",
    ],
  },
  {
    id: "bypasser",
    tab: "Protection",
    title: "A bodyguard that never sleeps",
    tagline: "Tamper with it, and it stops cold.",
    desc: "Every single startup, Asheo verifies its own signed build hashes. Modified, missing or renamed file? You meet the integrity page — and the extension refuses to run. ash signs his work, then makes the work defend itself.",
    engine: ["build-hashes.json", "build-hashes.sig", "error.html"],
  },
  {
    id: "automation",
    tab: "Automation",
    title: "The checkout, on autopilot",
    tagline: "Clicks you never have to make.",
    desc: "Fillers complete identities and cards, probes sniff out gateways, the injection HUD narrates every move, browser mods bend pages into shape — and the autoclicker finishes the job. Transactions that took minutes now take seconds.",
    engine: [
      "content/filler_core.js",
      "content/identity_filler.js",
      "content/card_filler.js",
      "content/gateway_probe.js",
      "content/gateway_detector.js",
      "content/injection_hud.js",
      "content/browser_mods.js",
      "content/autoclicker.js",
    ],
  },
  {
    id: "settings",
    tab: "Advanced",
    badge: "Update",
    title: "Advanced, without the anxiety",
    tagline: "Power tools, neatly shelved.",
    desc: "Update channels with required-update enforcement, a command palette for keyboard-first operators, and the omnibox keyword — type it in Chrome's address bar and Asheo answers. Depth that never gets in the way.",
    engine: ["omnibox keyword: asheo", "command palette", "update channel", "offscreen.html"],
  },
  {
    id: "appearance",
    tab: "Appearance",
    title: "Two moods: carbon & inferno",
    tagline: "Dark, darker, Asheo.",
    desc: "The whole Control Center rides on a premium theme system with presets like carbon and inferno. Because a tool you live inside should look like somewhere you want to be.",
    engine: ["assets/css/popup-premium.css", "preset: carbon", "preset: inferno"],
  },
  {
    id: "premium",
    tab: "Premium",
    badge: "Pro",
    license: true,
    title: "Premium, done properly",
    tagline: "Releases worth activating.",
    desc: "Campaign releases with featured banners, version channels and license activation — Asheo's premium layer treats every drop like an event, not a paywall.",
    engine: ["campaign releases", "license activation", "featured drops"],
  },
];

/** The 7 real content-script layers from manifest.json. */
export type Layer = {
  code: string;
  name: string;
  files: string[];
  world: "MAIN" | "ISOLATED";
  runAt: string;
  note: string;
};

export const LAYERS: Layer[] = [
  {
    code: "L0",
    name: "Boot",
    files: ["modules/loader.content.js", "functions/inject.js", "content/browser_mods_bridge.js"],
    world: "ISOLATED",
    runAt: "document_start · all frames",
    note: "Loaders hit first, before the page even breathes.",
  },
  {
    code: "L1",
    name: "Core",
    files: ["assets/library/jsenc.js", "functions/algo.js", "algo/* · 11 modules", "engine/* · 5 modules", "modules/router/v3/* · 8 modules", "content/browser_mods.js"],
    world: "MAIN",
    runAt: "document_start · all frames",
    note: "The full algo + engine + router stack, running inside the page world.",
  },
  {
    code: "L2",
    name: "Fill",
    files: ["content/filler_core.js", "content/identity_filler.js", "content/card_filler.js"],
    world: "ISOLATED",
    runAt: "document_idle · all frames",
    note: "Identity and card fillers, staged once the DOM settles.",
  },
  {
    code: "L3",
    name: "Probe",
    files: ["content/gateway_probe.js"],
    world: "MAIN",
    runAt: "document_idle",
    note: "Sniffs the page for payment gateways from the inside.",
  },
  {
    code: "L4",
    name: "HUD",
    files: ["content/injection_hud.js"],
    world: "MAIN",
    runAt: "document_idle",
    note: "The heads-up display — every injection, narrated live.",
  },
  {
    code: "L5",
    name: "Sense",
    files: ["content/gateway_detector.js"],
    world: "ISOLATED",
    runAt: "document_idle",
    note: "A second set of eyes watching for gateway fingerprints.",
  },
  {
    code: "L6",
    name: "Click",
    files: ["content/autoclicker.js"],
    world: "ISOLATED",
    runAt: "document_idle",
    note: "The finisher. The click you never had to make.",
  },
];

export const PERMISSIONS = [
  "storage",
  "scripting",
  "activeTab",
  "webNavigation",
  "webRequest",
  "webRequestAuthProvider",
  "declarativeNetRequest",
  "declarativeNetRequestWithHostAccess",
  "proxy",
  "privacy",
  "alarms",
  "unlimitedStorage",
  "tabs",
  "notifications",
  "offscreen",
  "browsingData",
] as const;

export const SKILLS = [
  {
    icon: "Blocks",
    title: "Manifest V3 systems",
    proof: "Service worker + 7 content-script layers · Chrome 116+",
  },
  {
    icon: "Server",
    title: "Service-worker core",
    proof: "functions/background.js — type: module",
  },
  {
    icon: "Layers",
    title: "Dual-world injection",
    proof: "Isolated + MAIN world scripts at document_start",
  },
  {
    icon: "Route",
    title: "Request pipelines",
    proof: "v3 pipeline: registry → interceptors → hooks",
  },
  {
    icon: "Landmark",
    title: "Gateway engineering",
    proof: "matcher → validator → transformer → engine",
  },
  {
    icon: "Zap",
    title: "Checkout automation",
    proof: "fillers · probes · HUD · autoclicker",
  },
  {
    icon: "Fingerprint",
    title: "Tamper-evident builds",
    proof: "build-hashes.json + .sig verified on boot",
  },
  {
    icon: "AppWindow",
    title: "Control-center UI",
    proof: "command palette · presets · campaigns",
  },
] as const;

export const INSTALL_STEPS = [
  {
    n: "01",
    title: "Get the build",
    desc: "Grab the ASH 1.6 drop from ash on Telegram — or inspect the source tree on GitHub.",
  },
  {
    n: "02",
    title: "Load it unpacked",
    desc: "Open chrome://extensions, flip on Developer mode, and load the Asheo folder.",
  },
  {
    n: "03",
    title: "Read once, agree once",
    desc: "A one-time disclaimer lays out the rules: your systems, your tests, your responsibility.",
  },
  {
    n: "04",
    title: "Type asheo and go",
    desc: "Hit the toolbar popup — or type the omnibox keyword straight into Chrome's address bar.",
  },
] as const;

export const MANIFEST_SNIPPET = `"name": "Asheo",
"version": "1.6.1",
"manifest_version": 3,
"minimum_chrome_version": "116",
"background": {
  "service_worker": "functions/background.js",
  "type": "module"
},
"omnibox": { "keyword": "asheo" },
"permissions": [ 16 declared ],
"host_permissions": [ "<all_urls>" ]`;

/**
 * Hall of Fame — verified Asheo payment proofs.
 * Files live in public/proofs/. The wall renders only images that
 * actually exist on disk, so it can never show a broken frame.
 */
export type Proof = {
  src: string;
  title: string;
  detail: string;
  tags: string[];
};

export const PROOF_FILTERS = [
  "All",
  "Stripe",
  "3DS2",
  "Braintree",
  "Adyen",
  "Success screens",
] as const;

export const PROOFS: Proof[] = [
  {
    src: "/proofs/proof-01.jpg",
    title: "Stripe · 3DS2 bypassed",
    detail: "AdsPower checkout: bypassed, then hit. ASHEO LIVE riding along in CC mode.",
    tags: ["Stripe", "3DS2"],
  },
  {
    src: "/proofs/proof-02.jpg",
    title: "Rebtel · Payment successful",
    detail: "Braintree swap armed, receipt sent. Green check, full stop.",
    tags: ["Braintree", "Success screens"],
  },
  {
    src: "/proofs/proof-03.jpg",
    title: "Stripe · Hit successfully",
    detail: "Card staged, hit confirmed, HUD lit in BIN mode.",
    tags: ["Stripe"],
  },
  {
    src: "/proofs/proof-04.jpg",
    title: "Stripe · Singapore run",
    detail: "Apple Pay + Link checkout, cardholder Asheo BYP. Hit.",
    tags: ["Stripe"],
  },
  {
    src: "/proofs/proof-05.jpg",
    title: "Suno · Subscription hit",
    detail: "One HIT row glowing among the declined on a live sub checkout.",
    tags: ["Stripe"],
  },
  {
    src: "/proofs/proof-06.jpg",
    title: "Buffer · India run",
    detail: "Dark-mode checkout, Asheo BYP, hit toast on top.",
    tags: ["Stripe"],
  },
  {
    src: "/proofs/proof-07.jpg",
    title: "Stripe · Israel run",
    detail: "checkout.stripe.com, green confirm locked, hit already banked.",
    tags: ["Stripe"],
  },
  {
    src: "/proofs/proof-08.jpg",
    title: "Undetectable AI · US$31.00",
    detail: "Stripe WILL SWAP → swap LIVE. One detected, one delivered.",
    tags: ["Stripe"],
  },
  {
    src: "/proofs/proof-09.jpg",
    title: "Adyen · US$200.00 cleared",
    detail: "IRAY TECHNOLOGY receipt with the green ring. 支付成功.",
    tags: ["Adyen", "Success screens"],
  },
  {
    src: "/proofs/proof-10.jpg",
    title: "Topuplive · AUD 138.13",
    detail: "Airwallex detect-only pill on a succeeded order. Succeed, returning.",
    tags: ["Success screens"],
  },
  {
    src: "/proofs/proof-11.jpg",
    title: "eSIM · Through the 3DS trail",
    detail: "Success screen with the 3DS fingerprint log as witness.",
    tags: ["3DS2", "Success screens"],
  },
  {
    src: "/proofs/proof-12.jpg",
    title: "Whop · $13.00 sealed",
    detail: "Paid through with the network log watching every request.",
    tags: ["Success screens"],
  },
  {
    src: "/proofs/proof-13.jpg",
    title: "Whop · $50.00/mo sealed",
    detail: "Payment complete on a funded-accounts sub, 584 requests logged.",
    tags: ["Success screens"],
  },
  {
    src: "/proofs/proof-14.jpg",
    title: "Ledger · $10.00 → 1,000 credits",
    detail: "Transaction history: completed, credited, case closed.",
    tags: ["Success screens"],
  },
];
