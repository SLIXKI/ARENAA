import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Ban,
  ChevronRight,
  Cpu,
  FileCode2,
  FileJson2,
  FileWarning,
  FolderGit2,
  Landmark,
  Lock,
  ScrollText,
  ShieldCheck,
} from "lucide-react";
import { ASHEO, LAYERS, MANIFEST_SNIPPET, PERMISSIONS } from "../config";
import { Reveal, SectionHead } from "./ui";

type Node = { name: string; blurb: string; files: { name: string; note: string }[] };

const TREE: Node[] = [
  {
    name: "algo/",
    blurb: "The brain — generation, validation & orchestration runtimes.",
    files: [
      { name: "v2-orchestrator.js", note: "Conducts the v2 runtime pipeline end to end." },
      { name: "v2-candidate-generator.js", note: "Produces candidates for the validator to judge." },
      { name: "v2-validator.js", note: "The judge — every candidate passes through here." },
      { name: "v2-runtime.js", note: "Runtime core the v2 modules execute on." },
      { name: "v2-normalizer.js", note: "Normalizes inputs before they touch the pipeline." },
      { name: "v2-network.js", note: "Network layer for v2 algo operations." },
      { name: "v2-source-resolver.js", note: "Resolves where each v2 input comes from." },
      { name: "generator.js", note: "Standalone generation routines." },
      { name: "adyenEncryptor.js", note: "Encryption helper for Adyen-flavoured flows." },
      { name: "core.js", note: "Shared algo primitives." },
      { name: "utils.js", note: "Shared algo helpers." },
    ],
  },
  {
    name: "engine/",
    blurb: "The heart — gateway request processing in four moves.",
    files: [
      { name: "gatewayEngine.js", note: "The conductor: match → validate → transform." },
      { name: "matcher.js", note: "Decides which gateway rule owns a request." },
      { name: "validator.js", note: "Accepts or rejects before anything mutates." },
      { name: "transformer.js", note: "Rewrites requests into their final shape." },
      { name: "utils.js", note: "Engine-wide helpers." },
    ],
  },
  {
    name: "modules/router/v3/",
    blurb: "The nervous system — intercept, route, hook, log.",
    files: [
      { name: "bootstrap.js", note: "Wires the v3 router together on load." },
      { name: "index.js", note: "Public entry of the v3 router." },
      { name: "gateway-registry.js", note: "Registry of every known gateway." },
      { name: "request-pipeline.js", note: "The pipeline every request travels." },
      { name: "interceptors.js", note: "Hooks that catch requests mid-flight." },
      { name: "response-hooks.js", note: "Post-flight response handling." },
      { name: "runtime-state.js", note: "Live state shared across the router." },
      { name: "redaction-logger.js", note: "Logging with secrets redacted." },
    ],
  },
  {
    name: "content/",
    blurb: "The hands — nine scripts living inside your pages.",
    files: [
      { name: "autoclicker.js", note: "The finisher — the click you never make." },
      { name: "filler_core.js", note: "Core routines shared by all fillers." },
      { name: "identity_filler.js", note: "Completes identity fields automatically." },
      { name: "card_filler.js", note: "Completes card fields automatically." },
      { name: "gateway_probe.js", note: "Probes pages for gateways (MAIN world)." },
      { name: "gateway_detector.js", note: "Detects gateway fingerprints (isolated)." },
      { name: "injection_hud.js", note: "On-page HUD narrating injections." },
      { name: "browser_mods.js", note: "Page modifications, MAIN world." },
      { name: "browser_mods_bridge.js", note: "Bridge between worlds for mods." },
    ],
  },
  {
    name: "functions/",
    blurb: "The spine — background worker, boot guards & injectors.",
    files: [
      { name: "background.js", note: "MV3 service worker (type: module) — always on." },
      { name: "inject.js", note: "Injects the stack at document_start." },
      { name: "algo.js", note: "Algo entry loaded into the page world." },
      { name: "popup-boot.js", note: "Boots the Control Center popup." },
      { name: "first-run-guard.js", note: "First-run guard — disclaimer before anything." },
      { name: "disclaimer.js", note: "Powers the one-time agreement screen." },
    ],
  },
  {
    name: "root",
    blurb: "The face — manifest, pages & the tamper-evident seal.",
    files: [
      { name: "manifest.json", note: "MV3 manifest — 16 permissions, 7 script layers." },
      { name: "popup.html", note: "The Control Center itself." },
      { name: "disclaimer.html", note: "One-time lawful-use agreement." },
      { name: "error.html", note: "The integrity-failed wall. No pass, no run." },
      { name: "offscreen.html", note: "Offscreen document for background work." },
      { name: "build-hashes.json + .sig", note: "The signed seal, verified every boot." },
    ],
  },
];

const TRUST = [
  { icon: Ban, title: "Captcha pages excluded", desc: "Challenge, captcha & reCAPTCHA hosts are explicitly fenced off in the manifest." },
  { icon: Lock, title: "CSP-locked pages", desc: "Extension pages run under a strict content security policy — self scripts only." },
  { icon: ShieldCheck, title: "Local-only data", desc: "Logs and test data stay in the browser's on-device storage. No card servers." },
  { icon: ScrollText, title: "One-time disclaimer", desc: "First run shows the rules: your systems, your tests, your responsibility." },
];

export default function Architecture() {
  const [folder, setFolder] = useState(0);
  const [file, setFile] = useState(0);
  const node = TREE[folder];
  const active = node.files[Math.min(file, node.files.length - 1)];

  return (
    <section id="inside" className="relative py-28 sm:py-36">
      <div className="container-x">
        <SectionHead
          index="03"
          kicker="UNDER THE HOOD"
          title={
            <>
              Seven folders. <span className="ember-text">Zero mysteries.</span>
            </>
          }
          blurb="Click through the real ASH 1.6 tree — algo, engine, modules, content, functions. Every file below exists in the build ash ships."
        />

        {/* explorer */}
        <Reveal>
          <div className="panel-deep grid overflow-hidden rounded-2xl lg:grid-cols-[300px_1fr_1fr]">
            {/* folders */}
            <div className="border-b border-white/[0.07] bg-black/25 p-3 lg:border-r lg:border-b-0">
              <p className="px-3 pt-2 pb-3 font-mono text-[10px] tracking-[0.3em] text-dim uppercase">
                ASH 1.6 /
              </p>
              {TREE.map((n, i) => (
                <button
                  key={n.name}
                  onClick={() => {
                    setFolder(i);
                    setFile(0);
                  }}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-all duration-300 ${
                    i === folder ? "bg-ember/[0.12] text-bone" : "text-smoke hover:bg-white/[0.04]"
                  }`}
                >
                  <FolderGit2 className={`h-4 w-4 shrink-0 ${i === folder ? "text-ember-soft" : "text-dim"}`} />
                  <span className="font-mono text-[13px]">{n.name}</span>
                  <ChevronRight
                    className={`ml-auto h-4 w-4 transition-transform duration-300 ${i === folder ? "rotate-90 text-ember" : "text-dim"}`}
                  />
                </button>
              ))}
              <a
                href={ASHEO.githubTree}
                target="_blank"
                rel="noreferrer"
                className="mt-3 block rounded-xl border border-dashed border-ember/30 bg-ember/[0.05] px-3 py-3 text-center font-mono text-[11px] tracking-wider text-ember-soft transition-colors hover:bg-ember/[0.12]"
              >
                ↗ verify on GitHub
              </a>
            </div>

            {/* files */}
            <div className="max-h-[320px] overflow-y-auto border-b border-white/[0.07] p-3 lg:max-h-none lg:border-r lg:border-b-0">
              <AnimatePresence mode="wait">
                <motion.div
                  key={folder}
                  initial={{ opacity: 0, x: 14 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -14 }}
                  transition={{ duration: 0.3 }}
                >
                  {node.files.map((f, i) => (
                    <button
                      key={f.name}
                      onClick={() => setFile(i)}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 font-mono text-[12.5px] transition-colors ${
                        i === Math.min(file, node.files.length - 1)
                          ? "bg-white/[0.06] text-gold"
                          : "text-smoke hover:bg-white/[0.03] hover:text-bone"
                      }`}
                    >
                      <FileCode2 className="h-3.5 w-3.5 shrink-0 opacity-60" />
                      <span className="truncate">{f.name}</span>
                    </button>
                  ))}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* detail */}
            <div className="relative flex min-h-[280px] flex-col bg-black/40 p-6 sm:p-8">
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${folder}-${active.name}`}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3 }}
                  className="flex flex-1 flex-col"
                >
                  <p className="font-mono text-[11px] tracking-[0.25em] text-ember-soft uppercase">{node.name}</p>
                  <h3 className="mt-2 font-mono text-lg font-semibold break-all sm:text-xl">{active.name}</h3>
                  <p className="mt-2 text-sm text-dim">{node.blurb}</p>
                  <p className="mt-4 flex-1 leading-relaxed text-bone/85">{active.note}</p>
                  <div className="mt-6 flex items-center gap-2 border-t border-white/[0.07] pt-4 font-mono text-[11px] text-dim">
                    <Cpu className="h-3.5 w-3.5 text-ember" />
                    ships in the ASH 1.6 build · verified
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </Reveal>

        {/* injection layers */}
        <div className="mt-16">
          <Reveal>
            <h3 className="mb-2 font-display text-2xl font-bold sm:text-3xl">
              Seven injection layers. <span className="text-outline-ember">One choreography.</span>
            </h3>
            <p className="mb-8 max-w-2xl text-smoke">
              The manifest stages every script like a heist crew — each layer enters at the exact
              right moment, in the exact right world.
            </p>
          </Reveal>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {LAYERS.map((l, i) => (
              <Reveal key={l.code} delay={(i % 4) * 0.08}>
                <div className="spotlight card-lift glass group h-full rounded-2xl p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <span className="font-display text-3xl font-extrabold text-white/[0.14] transition-colors duration-500 group-hover:text-ember/40">
                      {l.code}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 font-mono text-[9px] tracking-[0.2em] uppercase ${
                        l.world === "MAIN"
                          ? "border border-gold/40 bg-gold/10 text-gold"
                          : "border border-white/15 bg-white/[0.04] text-smoke"
                      }`}
                    >
                      {l.world}
                    </span>
                  </div>
                  <h4 className="font-display text-lg font-bold">{l.name}</h4>
                  <p className="mt-1 font-mono text-[10px] tracking-wider text-ember-soft/80">{l.runAt}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {l.files.slice(0, 3).map((f) => (
                      <span key={f} className="rounded-md bg-white/[0.05] px-2 py-1 font-mono text-[10px] text-bone/70">
                        {f}
                      </span>
                    ))}
                    {l.files.length > 3 && (
                      <span className="rounded-md bg-ember/10 px-2 py-1 font-mono text-[10px] text-ember-soft">
                        +{l.files.length - 3} more
                      </span>
                    )}
                  </div>
                  <p className="mt-3 text-[13px] leading-relaxed text-smoke">{l.note}</p>
                </div>
              </Reveal>
            ))}

            {/* manifest card */}
            <Reveal delay={0.24}>
              <div className="card-lift relative h-full overflow-hidden rounded-2xl border border-ember/30 bg-[#0a0806] p-5">
                <div className="absolute -top-16 -right-16 h-40 w-40 rounded-full bg-ember/20 blur-3xl" />
                <div className="mb-4 flex items-center gap-2">
                  <FileJson2 className="h-4 w-4 text-ember-soft" />
                  <span className="font-mono text-[11px] tracking-widest text-ember-soft">manifest.json</span>
                  <span className="ml-auto h-2 w-4 animate-caret bg-gold/80" />
                </div>
                <pre className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-bone/80">
                  {MANIFEST_SNIPPET.split("\n").map((line, i) => (
                    <div key={i}>
                      <span className="mr-3 text-dim/50 select-none">{String(i + 1).padStart(2, "0")}</span>
                      <span className={line.includes("1.6.1") || line.includes("asheo") ? "text-gold" : line.includes("16 declared") ? "text-ember-soft" : ""}>
                        {line}
                      </span>
                    </div>
                  ))}
                </pre>
              </div>
            </Reveal>
          </div>
        </div>

        {/* permissions + trust */}
        <div className="mt-16 grid gap-8 lg:grid-cols-2">
          <Reveal>
            <div className="glass h-full rounded-2xl p-6 sm:p-8">
              <div className="mb-2 flex items-center gap-3">
                <Landmark className="h-5 w-5 text-ember-soft" />
                <h3 className="font-display text-xl font-bold">16 declared permissions</h3>
              </div>
              <p className="mb-5 text-sm text-smoke">
                Everything Asheo can touch is declared up front in the manifest. No hidden
                capabilities — inspect every one:
              </p>
              <div className="flex flex-wrap gap-2">
                {PERMISSIONS.map((p) => (
                  <span key={p} className="chip">
                    {p}
                  </span>
                ))}
                <span className="chip border-gold/40 bg-gold/10 text-gold">host: &lt;all_urls&gt;</span>
              </div>
            </div>
          </Reveal>
          <div className="grid gap-4 sm:grid-cols-2">
            {TRUST.map((t, i) => (
              <Reveal key={t.title} delay={i * 0.08}>
                <div className="card-lift glass h-full rounded-2xl p-5">
                  <t.icon className="mb-3 h-5 w-5 text-ember-soft" />
                  <h4 className="font-display text-[15px] font-bold">{t.title}</h4>
                  <p className="mt-2 text-[13px] leading-relaxed text-smoke">{t.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>

        <Reveal delay={0.05}>
          <div className="mt-8 flex items-start gap-3 rounded-2xl border border-blood/40 bg-blood/10 p-5">
            <FileWarning className="mt-0.5 h-5 w-5 shrink-0 text-ember-soft" />
            <p className="text-sm leading-relaxed text-bone/80">
              <span className="font-semibold text-gold">ash's own rule, baked into the build:</span>{" "}
              Asheo is a developer &amp; QA testing tool — for your own integrations and authorised
              testing only. The disclaimer says it, the error page enforces it, and this site repeats
              it. Use it lawfully.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
