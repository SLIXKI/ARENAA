import { ArrowUp, Flame, Github } from "lucide-react";
import { ASHEO, NAV_LINKS } from "../config";
import Marquee from "./Marquee";
import { AshMark, Magnetic } from "./ui";

export default function Footer() {
  return (
    <footer className="relative">
      <Marquee
        items={["ASH", `ASHEO v${ASHEO.version}`, "MATCH", "VALIDATE", "TRANSFORM", "ROUTE"]}
        outline
      />

      <div className="container-x py-14">
        <div className="flex flex-col items-start justify-between gap-10 lg:flex-row lg:items-center">
          <div className="flex items-center gap-4">
            <AshMark className="h-12 w-12" />
            <div>
              <p className="font-display text-2xl font-extrabold tracking-tight">ASH</p>
              <p className="font-mono text-[11px] tracking-[0.25em] text-dim uppercase">
                Developer · Creator of Asheo
              </p>
            </div>
          </div>

          <nav className="flex flex-wrap gap-x-7 gap-y-3">
            {NAV_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="link-ember font-mono text-[11px] tracking-[0.25em] text-smoke uppercase"
              >
                {l.label}
              </a>
            ))}
            <a
              href={ASHEO.githubTree}
              target="_blank"
              rel="noreferrer"
              className="link-ember flex items-center gap-1.5 font-mono text-[11px] tracking-[0.25em] text-smoke uppercase"
            >
              <Github className="h-3.5 w-3.5" /> GitHub
            </a>
          </nav>

          <Magnetic strength={0.35}>
            <a
              href="#top"
              className="group flex h-14 w-14 items-center justify-center rounded-full border border-ember/40 bg-ember/10 text-ember-soft transition-colors hover:bg-ember/25"
              aria-label="Back to top"
            >
              <ArrowUp className="h-5 w-5 transition-transform duration-300 group-hover:-translate-y-1" />
            </a>
          </Magnetic>
        </div>

        <div className="ember-glow-line mt-10 h-px w-full opacity-30" />

        <div className="mt-6 flex flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left">
          <p className="font-mono text-[11px] tracking-wider text-dim">
            © 2026 ash · Asheo v{ASHEO.version} · MV{ASHEO.manifestVersion} · Chrome {ASHEO.minChrome}+
          </p>
          <p className="flex items-center gap-2 font-mono text-[11px] tracking-wider text-dim">
            <Flame className="h-3.5 w-3.5 text-ember" />
            No fake numbers. No stock proofs. Just the work.
          </p>
        </div>
      </div>
    </footer>
  );
}
