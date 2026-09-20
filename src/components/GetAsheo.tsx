import { motion } from "motion/react";
import { ArrowUpRight, Github, Send, TerminalSquare } from "lucide-react";
import { ASHEO, INSTALL_STEPS } from "../config";
import { Magnetic, Reveal, SectionHead } from "./ui";

export default function GetAsheo() {
  return (
    <section id="get" className="relative overflow-hidden py-28 sm:py-36">
      {/* molten A backdrop */}
      <div aria-hidden="true" className="absolute inset-0">
        <img
          src="/assets/og-cover.jpg"
          alt=""
          className="h-full w-full object-cover opacity-25"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-abyss via-abyss/70 to-abyss" />
        <div className="absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_45%,transparent_30%,rgba(6,5,4,0.8)_100%)]" />
      </div>

      <div className="container-x relative">
        <SectionHead
          index="06"
          kicker="GET ASHEO"
          title={
            <>
              Ready to move at <span className="ember-text">ash speed?</span>
            </>
          }
          blurb="ash distributes Asheo on Telegram — the drops, the updates, the premium releases. Prefer to inspect first? The source tree is wide open."
        />

        <div className="grid gap-5 lg:grid-cols-2">
          {/* telegram */}
          <Reveal>
            <motion.div
              whileHover={{ y: -6 }}
              transition={{ type: "spring", stiffness: 200, damping: 20 }}
              className="relative h-full overflow-hidden rounded-3xl border border-ember/30 bg-gradient-to-br from-blood/25 via-coal to-coal p-8 sm:p-10"
            >
              <div className="absolute -top-20 -right-20 h-56 w-56 rounded-full bg-ember/25 blur-[90px]" />
              <span className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-ember to-blood text-white shadow-[0_10px_40px_-8px_rgba(255,90,31,0.8)]">
                <Send className="h-6 w-6" />
              </span>
              <h3 className="font-display text-3xl font-bold">The Telegram drop</h3>
              <p className="mt-3 max-w-md leading-relaxed text-smoke">
                This is where Asheo lives — fresh builds, release notes and premium activations,
                straight from the developer. No middlemen, no mirrors, no tampered copies.
              </p>
              <div className="mt-8">
                {ASHEO.telegramUrl ? (
                  <Magnetic>
                    <a
                      href={ASHEO.telegramUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="group inline-flex items-center gap-3 rounded-full bg-gradient-to-r from-blood via-ember to-ember-soft px-8 py-4 font-mono text-[13px] font-semibold tracking-[0.2em] text-white uppercase shadow-[0_12px_50px_-10px_rgba(255,90,31,0.8)]"
                    >
                      Join the channel
                      <ArrowUpRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-1" />
                    </a>
                  </Magnetic>
                ) : (
                  <div className="inline-flex items-center gap-3 rounded-full border border-dashed border-ember/50 bg-ember/[0.07] px-8 py-4 font-mono text-[12px] font-semibold tracking-[0.2em] text-ember-soft uppercase">
                    <span className="h-2 w-2 animate-pulse-dot rounded-full bg-ember" />
                    Invite link drops soon
                  </div>
                )}
              </div>
              <p className="mt-5 font-mono text-[11px] tracking-wider text-dim">
                always verify: reinstall only from trusted sources
              </p>
            </motion.div>
          </Reveal>

          {/* github */}
          <Reveal delay={0.1}>
            <motion.div
              whileHover={{ y: -6 }}
              transition={{ type: "spring", stiffness: 200, damping: 20 }}
              className="glass relative h-full overflow-hidden rounded-3xl p-8 sm:p-10"
            >
              <span className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/15 bg-white/[0.05] text-bone">
                <Github className="h-6 w-6" />
              </span>
              <h3 className="font-display text-3xl font-bold">Inspect the source</h3>
              <p className="mt-3 max-w-md leading-relaxed text-smoke">
                Read the manifest. Count the layers. Audit the permissions. ASH 1.6 is on GitHub
                for anyone who — like ash — trusts only what they can verify.
              </p>
              <div className="mt-8">
                <Magnetic>
                  <a
                    href={ASHEO.githubTree}
                    target="_blank"
                    rel="noreferrer"
                    className="group inline-flex items-center gap-3 rounded-full border border-white/20 bg-white/[0.06] px-8 py-4 font-mono text-[13px] font-semibold tracking-[0.2em] text-bone uppercase transition-colors hover:border-gold/60 hover:text-gold"
                  >
                    Open ASH 1.6
                    <ArrowUpRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-1" />
                  </a>
                </Magnetic>
              </div>
              <p className="mt-5 font-mono text-[11px] tracking-wider text-dim">
                shaikhmuzakkir003-blip / AAS / ASH 1.6
              </p>
            </motion.div>
          </Reveal>
        </div>

        {/* install ritual */}
        <div className="mt-14">
          <Reveal>
            <h3 className="mb-8 flex items-center gap-3 font-display text-2xl font-bold">
              <TerminalSquare className="h-6 w-6 text-ember-soft" />
              The install ritual
            </h3>
          </Reveal>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {INSTALL_STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 0.08}>
                <div className="card-lift group relative h-full overflow-hidden rounded-2xl border border-white/[0.08] bg-black/40 p-6">
                  <span className="ember-text font-display text-5xl font-extrabold opacity-80">
                    {s.n}
                  </span>
                  <div className="ember-glow-line mt-4 h-px w-full opacity-40 transition-opacity duration-500 group-hover:opacity-100" />
                  <h4 className="mt-4 font-display text-lg font-bold">{s.title}</h4>
                  <p className="mt-2 text-sm leading-relaxed text-smoke">{s.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal delay={0.1}>
            <p className="mt-6 text-center font-mono text-[11px] tracking-[0.2em] text-dim uppercase">
              Developer &amp; QA tool — use only on systems you own or are authorised to test
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
