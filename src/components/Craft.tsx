import {
  AppWindow,
  Blocks,
  Fingerprint,
  Github,
  Landmark,
  Layers,
  Route,
  Server,
  Zap,
} from "lucide-react";
import { ASHEO, SKILLS } from "../config";
import { Magnetic, Reveal, SectionHead } from "./ui";

const ICONS: Record<string, typeof Blocks> = {
  Blocks,
  Server,
  Layers,
  Route,
  Landmark,
  Zap,
  Fingerprint,
  AppWindow,
};

export default function Craft() {
  return (
    <section id="craft" className="relative py-28 sm:py-36">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-1/2 h-[420px] w-[720px] -translate-x-1/2 rounded-full opacity-20 blur-[140px]"
        style={{ background: "radial-gradient(circle, #ff5a1f, transparent 65%)" }}
      />
      <div className="container-x relative">
        <SectionHead
          index="04"
          kicker="THE CRAFT"
          title={
            <>
              Hard work you can <span className="ember-text">inspect.</span>
            </>
          }
          blurb="No buzzwords, no padded résumé. Every skill below is proven by a file, a folder or a behaviour inside the ASH 1.6 build."
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SKILLS.map((s, i) => {
            const Icon = ICONS[s.icon];
            const tall = i === 1 || i === 6;
            return (
              <Reveal key={s.title} delay={(i % 4) * 0.08} className={tall ? "lg:translate-y-8" : ""}>
                <div className="card-lift glass group relative h-full overflow-hidden rounded-2xl p-6">
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute -top-8 -right-4 font-display text-[5.5rem] font-extrabold text-white/[0.05] transition-colors duration-500 group-hover:text-ember/10"
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="mb-12 flex h-11 w-11 items-center justify-center rounded-xl border border-ember/25 bg-gradient-to-br from-ember/20 to-transparent text-ember-soft transition-transform duration-500 group-hover:scale-110 group-hover:rotate-6">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="font-display text-lg leading-tight font-bold">{s.title}</h3>
                  <p className="mt-2.5 border-t border-white/[0.07] pt-2.5 font-mono text-[11px] leading-relaxed text-smoke">
                    {s.proof}
                  </p>
                </div>
              </Reveal>
            );
          })}
        </div>

        <Reveal delay={0.1}>
          <div className="panel-deep mt-14 flex flex-col items-center gap-6 rounded-2xl p-8 text-center sm:p-10 lg:flex-row lg:text-left">
            <p className="max-w-2xl font-display text-xl leading-snug font-bold sm:text-2xl">
              "Don't take this site's word for it.{" "}
              <span className="ember-text">Take the source tree's.</span>"
            </p>
            <Magnetic strength={0.25} className="lg:ml-auto">
              <a
                href={ASHEO.githubTree}
                target="_blank"
                rel="noreferrer"
                className="group flex items-center gap-3 rounded-full border border-ember/40 bg-ember/10 px-7 py-3.5 font-mono text-[12px] font-semibold tracking-[0.2em] text-gold uppercase transition-all hover:bg-ember/20"
              >
                <Github className="h-4 w-4 transition-transform duration-300 group-hover:-rotate-12" />
                Open ASH 1.6
              </a>
            </Magnetic>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
