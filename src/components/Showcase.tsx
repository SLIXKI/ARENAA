import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AppWindow,
  Bot,
  CreditCard,
  Crown,
  KeyRound,
  LayoutDashboard,
  Palette,
  ShieldCheck,
  SlidersHorizontal,
  Workflow,
} from "lucide-react";
import { ASHEO, FEATURES } from "../config";
import { Reveal, SectionHead, Tilt } from "./ui";

const ICONS: Record<string, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  gateways: Workflow,
  bins: CreditCard,
  bypasser: ShieldCheck,
  automation: Bot,
  settings: SlidersHorizontal,
  appearance: Palette,
  premium: Crown,
};

const AUTO_MS = 6000;

function Pipeline() {
  const nodes = ["MATCH", "VALIDATE", "TRANSFORM", "ROUTE"];
  return (
    <div className="relative mt-6 overflow-hidden rounded-xl border border-white/[0.07] bg-black/40 p-4">
      <p className="mb-3 font-mono text-[10px] tracking-[0.3em] text-dim uppercase">
        Live request pipeline
      </p>
      <svg viewBox="0 0 400 64" className="w-full" aria-hidden="true">
        <line x1="20" y1="32" x2="380" y2="32" stroke="rgba(255,90,31,0.25)" strokeWidth="2" />
        <line
          x1="20"
          y1="32"
          x2="380"
          y2="32"
          stroke="#ff8a3d"
          strokeWidth="2"
          strokeDasharray="6 8"
          strokeLinecap="round"
          className="animate-dash-flow"
        />
        {nodes.map((n, i) => {
          const x = 30 + i * 113;
          return (
            <g key={n}>
              <circle cx={x} cy="32" r="9" fill="#0e0b08" stroke="#ff5a1f" strokeWidth="2" />
              <circle cx={x} cy="32" r="3" fill="#ffc46b">
                <animate attributeName="opacity" values="1;0.3;1" dur={`${1.2 + i * 0.25}s`} repeatCount="indefinite" />
              </circle>
              <text x={x} y="56" textAnchor="middle" fill="#a89f90" fontSize="8" fontFamily="JetBrains Mono, monospace" letterSpacing="1">
                {n}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function Showcase() {
  const [active, setActive] = useState(1);
  const [paused, setPaused] = useState(false);
  const timer = useRef(0);

  useEffect(() => {
    if (paused) return;
    timer.current = window.setTimeout(() => setActive((a) => (a + 1) % FEATURES.length), AUTO_MS);
    return () => window.clearTimeout(timer.current);
  }, [active, paused]);

  const f = FEATURES[active];
  const ActiveIcon = ICONS[f.id];

  return (
    <section id="asheo" className="relative py-28 sm:py-36">
      {/* ambient glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1/3 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full opacity-25 blur-[140px]"
        style={{ background: "radial-gradient(circle, #ff5a1f, transparent 65%)" }}
      />
      <div className="container-x relative">
        <SectionHead
          index="02"
          kicker="THE CREATION"
          title={
            <>
              Step inside the <span className="ember-text">Control Center.</span>
            </>
          }
          blurb="This window mirrors the real Asheo popup — the same 8 sections, the same engine names, straight from ASH 1.6. Click through it like ash's own users do."
        />

        <Reveal>
          <Tilt max={4}>
            <div
              className="panel-deep overflow-hidden rounded-2xl shadow-[0_40px_120px_-30px_rgba(255,90,31,0.25)]"
              onMouseEnter={() => setPaused(true)}
              onMouseLeave={() => setPaused(false)}
            >
              {/* chrome */}
              <div className="flex items-center gap-3 border-b border-white/[0.07] bg-black/30 px-5 py-3.5">
                <span className="flex gap-1.5">
                  <i className="h-2.5 w-2.5 rounded-full bg-blood/80" />
                  <i className="h-2.5 w-2.5 rounded-full bg-gold/70" />
                  <i className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
                </span>
                <span className="font-mono text-[11px] tracking-wider text-dim">
                  asheo — control center · v{ASHEO.version}
                </span>
                <span className="ml-auto hidden items-center gap-2 sm:flex">
                  <i className="h-2.5 w-2.5 rounded-full bg-zinc-500" title="carbon preset" />
                  <i className="h-2.5 w-2.5 rounded-full bg-ember shadow-[0_0_8px_rgba(255,90,31,0.9)]" title="inferno preset" />
                  <span className="ml-1 font-mono text-[10px] text-dim">preset: inferno</span>
                </span>
              </div>

              <div className="grid lg:grid-cols-[240px_1fr]">
                {/* sidebar — the real 8 nav items */}
                <aside className="flex gap-2 overflow-x-auto border-b border-white/[0.07] bg-black/20 p-3 lg:flex-col lg:overflow-visible lg:border-r lg:border-b-0 lg:p-4">
                  {FEATURES.map((item, i) => {
                    const Icon = ICONS[item.id];
                    const isActive = i === active;
                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          setActive(i);
                          setPaused(true);
                        }}
                        className={`relative flex shrink-0 items-center gap-3 rounded-xl px-4 py-3 text-left transition-all duration-300 lg:shrink ${
                          isActive
                            ? "border border-ember/40 bg-ember/[0.12] text-bone"
                            : "border border-transparent text-smoke hover:bg-white/[0.04] hover:text-bone"
                        }`}
                      >
                        {isActive && (
                          <motion.span
                            layoutId="nav-glow"
                            className="absolute top-1/2 left-0 h-6 w-[3px] -translate-y-1/2 rounded-full bg-gradient-to-b from-gold to-ember shadow-[0_0_12px_rgba(255,90,31,0.9)]"
                          />
                        )}
                        <Icon className={`h-4 w-4 shrink-0 ${isActive ? "text-ember-soft" : "text-dim"}`} />
                        <span className="font-mono text-[12px] tracking-wide whitespace-nowrap">{item.tab}</span>
                        {item.badge && (
                          <span
                            className={`ml-auto hidden rounded-full px-2 py-0.5 font-mono text-[9px] tracking-widest uppercase lg:inline ${
                              item.id === "premium"
                                ? "bg-gradient-to-r from-blood to-ember text-white"
                                : "border border-ember/40 text-ember-soft"
                            }`}
                          >
                            {item.badge}
                          </span>
                        )}
                        {item.id === "settings" && (
                          <span className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-ember shadow-[0_0_6px_rgba(255,90,31,1)] lg:hidden" />
                        )}
                      </button>
                    );
                  })}
                </aside>

                {/* workspace */}
                <div className="relative min-h-[420px] p-6 sm:p-9 lg:min-h-[460px]">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={f.id}
                      initial={{ opacity: 0, y: 22, filter: "blur(6px)" }}
                      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                      exit={{ opacity: 0, y: -16, filter: "blur(6px)" }}
                      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                    >
                      <p className="font-mono text-[11px] tracking-[0.25em] text-dim uppercase">
                        Home <span className="text-ember">/</span> {f.tab}
                      </p>
                      <div className="mt-3 flex items-center gap-4">
                        <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-ember/30 bg-ember/10 text-ember-soft">
                          <ActiveIcon className="h-5 w-5" />
                        </span>
                        <div>
                          <h3 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
                            {f.title}
                          </h3>
                          <p className="font-mono text-xs text-gold/90">{f.tagline}</p>
                        </div>
                      </div>
                      <p className="mt-5 max-w-xl leading-relaxed text-smoke">{f.desc}</p>

                      <p className="mt-6 mb-2.5 font-mono text-[10px] tracking-[0.3em] text-dim uppercase">
                        Engine room
                      </p>
                      <div className="flex max-w-xl flex-wrap gap-2">
                        {f.engine.map((e) => (
                          <span key={e} className="chip">
                            {e}
                          </span>
                        ))}
                      </div>

                      {f.license ? (
                        <div className="mt-6 flex max-w-xl items-center gap-4 rounded-xl border border-gold/25 bg-gradient-to-r from-blood/20 via-ember/10 to-transparent p-4">
                          <KeyRound className="h-5 w-5 shrink-0 text-gold" />
                          <div className="flex-1">
                            <p className="font-display text-sm font-bold">Featured release channel</p>
                            <p className="font-mono text-[11px] text-smoke">license status: awaiting activation</p>
                          </div>
                          <span className="rounded-full bg-gradient-to-r from-blood to-ember px-4 py-2 font-mono text-[11px] font-semibold tracking-widest text-white uppercase">
                            Activate
                          </span>
                        </div>
                      ) : (
                        <div className="max-w-xl">
                          <Pipeline />
                        </div>
                      )}
                    </motion.div>
                  </AnimatePresence>

                  {/* progress + counter */}
                  <div className="absolute right-6 bottom-5 left-6 flex items-center gap-4 sm:right-9 sm:left-9">
                    <span className="font-mono text-[11px] text-dim tabular-nums">
                      {String(active + 1).padStart(2, "0")} / {String(FEATURES.length).padStart(2, "0")}
                    </span>
                    <div className="h-px flex-1 bg-white/10">
                      {!paused && (
                        <motion.div
                          key={active}
                          initial={{ scaleX: 0 }}
                          animate={{ scaleX: 1 }}
                          transition={{ duration: AUTO_MS / 1000, ease: "linear" }}
                          className="h-px origin-left bg-gradient-to-r from-ember to-gold"
                        />
                      )}
                    </div>
                    <AppWindow className="h-3.5 w-3.5 text-dim" />
                  </div>
                </div>
              </div>
            </div>
          </Tilt>
        </Reveal>

        <Reveal delay={0.1}>
          <p className="mt-6 text-center font-mono text-[11px] tracking-[0.2em] text-dim uppercase">
            Section names, engine files & pipeline stages — all real, all from ASH 1.6
          </p>
        </Reveal>
      </div>
    </section>
  );
}
