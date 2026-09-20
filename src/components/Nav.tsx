import { useEffect, useState } from "react";
import { AnimatePresence, motion, useScroll, useSpring } from "motion/react";
import { Github, Menu, Send, X } from "lucide-react";
import { ASHEO, NAV_LINKS } from "../config";
import { AshMark, Magnetic } from "./ui";

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 30 });

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      {/* scroll progress */}
      <motion.div
        className="ember-glow-line fixed inset-x-0 top-0 z-[90] h-[2px] origin-left"
        style={{ scaleX: progress }}
      />

      <motion.header
        initial={{ y: -80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className={`fixed inset-x-0 top-0 z-[60] transition-all duration-500 ${
          scrolled ? "border-b border-white/[0.07] bg-abyss/75 backdrop-blur-xl" : "bg-transparent"
        }`}
      >
        <div className="container-x flex h-16 items-center justify-between sm:h-[76px]">
          <a href="#top" className="group flex items-center gap-3" aria-label="ASH — back to top">
            <span className="transition-transform duration-500 group-hover:rotate-[8deg]">
              <AshMark />
            </span>
            <span className="flex flex-col leading-none">
              <span className="font-display text-xl font-extrabold tracking-tight">ASH</span>
              <span className="font-mono text-[10px] tracking-[0.25em] text-dim">
                v{ASHEO.version} · MV{ASHEO.manifestVersion}
              </span>
            </span>
          </a>

          <nav className="hidden items-center gap-8 lg:flex">
            {NAV_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="link-ember font-mono text-[12px] tracking-[0.2em] text-smoke uppercase"
              >
                {l.label}
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-3 lg:flex">
            <Magnetic strength={0.3}>
              <a
                href={ASHEO.githubTree}
                target="_blank"
                rel="noreferrer"
                className="glass flex h-10 w-10 items-center justify-center rounded-full text-smoke transition-colors hover:text-gold"
                aria-label="ASH 1.6 on GitHub"
              >
                <Github className="h-[18px] w-[18px]" />
              </a>
            </Magnetic>
            <Magnetic strength={0.25}>
              {ASHEO.telegramUrl ? (
                <a
                  href={ASHEO.telegramUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-center gap-2 rounded-full bg-gradient-to-r from-blood via-ember to-ember-soft px-5 py-2.5 font-mono text-[12px] font-semibold tracking-[0.15em] text-white uppercase shadow-[0_8px_30px_-8px_rgba(255,90,31,0.7)]"
                >
                  <Send className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  Get Asheo
                </a>
              ) : (
                <a
                  href="#get"
                  className="group flex items-center gap-2 rounded-full bg-gradient-to-r from-blood via-ember to-ember-soft px-5 py-2.5 font-mono text-[12px] font-semibold tracking-[0.15em] text-white uppercase shadow-[0_8px_30px_-8px_rgba(255,90,31,0.7)]"
                >
                  <Send className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  Get Asheo
                </a>
              )}
            </Magnetic>
          </div>

          <button
            onClick={() => setOpen(true)}
            className="glass flex h-10 w-10 items-center justify-center rounded-full text-bone lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </motion.header>

      {/* mobile overlay menu */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-[95] flex flex-col bg-abyss/95 backdrop-blur-2xl"
          >
            <div className="container-x flex h-16 items-center justify-between">
              <span className="flex items-center gap-3">
                <AshMark className="h-8 w-8" />
                <span className="font-display text-lg font-extrabold">ASH</span>
              </span>
              <button
                onClick={() => setOpen(false)}
                className="glass flex h-10 w-10 items-center justify-center rounded-full"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="container-x flex flex-1 flex-col justify-center gap-2">
              {[...NAV_LINKS, { label: "Get Asheo", href: "#get" }].map((l, i) => (
                <motion.a
                  key={l.href + l.label}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  initial={{ opacity: 0, x: -32 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.08 + i * 0.06, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                  className="group flex items-baseline gap-4 border-b border-white/[0.06] py-4"
                >
                  <span className="font-mono text-xs text-ember">0{i + 1}</span>
                  <span className="font-display text-4xl font-bold tracking-tight transition-colors group-hover:text-gold">
                    {l.label}
                  </span>
                </motion.a>
              ))}
              <motion.a
                href={ASHEO.githubTree}
                target="_blank"
                rel="noreferrer"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="mt-6 flex items-center gap-3 font-mono text-xs tracking-[0.25em] text-smoke uppercase"
              >
                <Github className="h-4 w-4" /> ASH 1.6 — source tree
              </motion.a>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
