import { useRef, type MouseEvent } from "react";
import { motion, useMotionValue, useScroll, useSpring, useTransform } from "motion/react";
import { ArrowDown, Flame, Github } from "lucide-react";
import { ASHEO } from "../config";
import { Magnetic } from "./ui";

const SPECS = [
  ["VERSION", `v${ASHEO.version}`],
  ["PLATFORM", `MV${ASHEO.manifestVersion} · Chrome ${ASHEO.minChrome}+`],
  ["CORE", "Gateways · BIN · Integrity"],
  ["ORIGIN", "Telegram drops"],
] as const;

export default function Hero({ ready }: { ready: boolean }) {
  const sectionRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });
  const bgY = useTransform(scrollYProgress, [0, 1], ["0%", "22%"]);
  const bgScale = useTransform(scrollYProgress, [0, 1], [1, 1.18]);
  const fade = useTransform(scrollYProgress, [0, 0.7], [1, 0]);
  const rise = useTransform(scrollYProgress, [0, 0.7], [0, -120]);

  // mouse parallax on the giant type
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const tx = useSpring(mx, { stiffness: 60, damping: 20 });
  const ty = useSpring(my, { stiffness: 60, damping: 20 });
  const onMouse = (e: MouseEvent) => {
    const { innerWidth, innerHeight } = window;
    mx.set((e.clientX / innerWidth - 0.5) * 26);
    my.set((e.clientY / innerHeight - 0.5) * 18);
  };

  const ease = [0.16, 1, 0.3, 1] as const;

  return (
    <section
      ref={sectionRef}
      id="top"
      onMouseMove={onMouse}
      className="relative flex min-h-[100svh] flex-col overflow-hidden"
    >
      {/* backdrop */}
      <motion.div style={{ y: bgY, scale: bgScale }} className="absolute inset-0">
        <img
          src="/assets/ember-abyss.jpg"
          alt=""
          className="h-full w-full object-cover opacity-70"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-abyss/70 via-abyss/35 to-abyss" />
        <div className="absolute inset-0 bg-[radial-gradient(90%_60%_at_50%_100%,transparent_40%,rgba(6,5,4,0.75)_100%)]" />
      </motion.div>

      {/* side rails */}
      <div className="absolute left-6 top-1/2 hidden -translate-y-1/2 -rotate-90 xl:block">
        <p className="font-mono text-[10px] tracking-[0.6em] text-dim uppercase">
          Manifest&nbsp;V3&nbsp;Extension
        </p>
      </div>
      <div className="absolute right-6 top-1/2 hidden -translate-y-1/2 rotate-90 xl:block">
        <p className="font-mono text-[10px] tracking-[0.6em] text-dim uppercase">
          Built&nbsp;by&nbsp;ash
        </p>
      </div>

      <motion.div
        style={{ opacity: fade, y: rise }}
        className="container-x relative z-10 flex flex-1 flex-col items-center justify-center pt-28 pb-10 text-center"
      >
        {/* kicker */}
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={ready ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, ease }}
          className="glass mb-6 flex items-center gap-2.5 rounded-full py-2 pr-5 pl-4"
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute h-full w-full animate-pulse-dot rounded-full bg-ember" />
            <span className="h-2 w-2 rounded-full bg-ember" />
          </span>
          <span className="font-mono text-[10px] tracking-[0.3em] text-bone/90 uppercase sm:text-[11px]">
            ash · creator of asheo · v{ASHEO.version}
          </span>
        </motion.div>

        {/* giant type */}
        <motion.div style={{ x: tx, y: ty }} className="relative">
          <h1
            aria-label="ASH"
            className="flex items-start justify-center font-display text-[38vw] leading-[0.85] font-extrabold tracking-tighter select-none sm:text-[11rem] lg:text-[15rem]"
          >
            {"ASH".split("").map((l, i) => (
              <motion.span
                key={i}
                initial={{ y: "58%", opacity: 0, rotate: i === 1 ? -6 : 6, filter: "blur(14px)" }}
                animate={ready ? { y: 0, opacity: 1, rotate: 0, filter: "blur(0px)" } : {}}
                transition={{ delay: 0.15 + i * 0.13, duration: 1.1, ease }}
                className="ember-text inline-block"
              >
                {l}
              </motion.span>
            ))}
          </h1>
          {/* echo */}
          <span
            aria-hidden="true"
            className="text-outline pointer-events-none absolute inset-0 -z-10 flex translate-x-3 translate-y-3 items-start justify-center font-display text-[38vw] leading-[0.85] font-extrabold tracking-tighter opacity-40 select-none sm:text-[11rem] lg:text-[15rem]"
          >
            ASH
          </span>
        </motion.div>

        {/* tagline */}
        <motion.p
          initial={{ opacity: 0, y: 24 }}
          animate={ready ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 0.65, duration: 0.9, ease }}
          className="mt-7 max-w-2xl text-base leading-relaxed text-bone/85 sm:text-xl"
        >
          One developer. One obsession:{" "}
          <span className="text-gold">transactions in seconds.</span>
          <br className="hidden sm:block" />
          Asheo is his answer — {ASHEO.description}
        </motion.p>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={ready ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 0.8, duration: 0.9, ease }}
          className="mt-9 flex flex-col items-center gap-4 sm:flex-row"
        >
          <Magnetic>
            <a
              href="#manifesto"
              className="group flex items-center gap-3 rounded-full bg-gradient-to-r from-blood via-ember to-ember-soft px-8 py-4 font-mono text-[13px] font-semibold tracking-[0.2em] text-white uppercase shadow-[0_12px_50px_-10px_rgba(255,90,31,0.8)] transition-shadow hover:shadow-[0_16px_60px_-8px_rgba(255,90,31,0.9)]"
            >
              <Flame className="h-4 w-4 animate-flicker" />
              Enter the fire
            </a>
          </Magnetic>
          <Magnetic>
            <a
              href={ASHEO.githubTree}
              target="_blank"
              rel="noreferrer"
              className="glass group flex items-center gap-3 rounded-full px-8 py-4 font-mono text-[13px] font-semibold tracking-[0.2em] text-bone uppercase transition-colors hover:border-ember/50"
            >
              <Github className="h-4 w-4 text-ember-soft transition-transform duration-300 group-hover:-rotate-12" />
              Inspect ASH 1.6
            </a>
          </Magnetic>
        </motion.div>

        {/* spec strip */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={ready ? { opacity: 1 } : {}}
          transition={{ delay: 1.05, duration: 1 }}
          className="mt-12 grid w-full max-w-3xl grid-cols-2 gap-y-5 border-t border-white/10 pt-6 sm:grid-cols-4"
        >
          {SPECS.map(([k, v]) => (
            <div key={k} className="flex flex-col items-center gap-1.5">
              <span className="font-mono text-[10px] tracking-[0.35em] text-dim">{k}</span>
              <span className="font-mono text-xs font-medium text-bone/90 sm:text-[13px]">{v}</span>
            </div>
          ))}
        </motion.div>
      </motion.div>

      {/* scroll cue */}
      <motion.a
        href="#manifesto"
        style={{ opacity: fade }}
        initial={{ opacity: 0 }}
        animate={ready ? { opacity: 1 } : {}}
        transition={{ delay: 1.3, duration: 1 }}
        className="absolute bottom-6 left-1/2 z-10 hidden -translate-x-1/2 flex-col items-center gap-3 sm:flex"
        aria-label="Scroll to manifesto"
      >
        <span className="font-mono text-[10px] tracking-[0.4em] text-dim uppercase">Scroll</span>
        <span className="flex h-12 w-6 items-start justify-center rounded-full border border-white/15 p-1.5">
          <ArrowDown className="h-3 w-3 animate-scroll-cue text-ember-soft" />
        </span>
      </motion.a>
    </section>
  );
}
