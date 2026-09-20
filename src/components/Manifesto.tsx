import { useEffect, useRef, useState } from "react";
import { Fingerprint, Flame, ServerOff } from "lucide-react";
import { Reveal, SectionHead } from "./ui";

const TEXT =
  "There is a corner of the internet everyone hates — the checkout. Endless fields, spinning loaders, payments that crawl. ash looked at that corner and refused to accept it. So he built Asheo: a Manifest V3 extension that compresses the whole painful ritual into seconds. No noise. No theatre. Just an engine, a bodyguard, and autopilot — crafted by one developer who sweats every line.";

function useScrubProgress(ref: React.RefObject<HTMLElement | null>) {
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const start = window.innerHeight * 0.85;
      const end = window.innerHeight * 0.35;
      const total = start - end;
      const raw = (start - r.top - r.height * 0.15) / (r.height * 0.7 + total);
      setP(Math.max(0, Math.min(1, raw)));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref]);
  return p;
}

const PRINCIPLES = [
  {
    icon: Fingerprint,
    title: "Signed work",
    desc: "Every Asheo startup verifies its own signed build hashes. If a single file is touched, the extension stops cold. Trust, compiled in.",
  },
  {
    icon: ServerOff,
    title: "Local-first, always",
    desc: "No card data ever leaves the browser. Logs and test data live in on-device storage — by design, stated up front in the one-time disclaimer.",
  },
  {
    icon: Flame,
    title: "Seconds, not minutes",
    desc: "Fillers, probes and an autoclicker collapse the checkout ritual. Asheo exists for one reason: to make paying feel instant.",
  },
];

export default function Manifesto() {
  const ref = useRef<HTMLElement>(null);
  const progress = useScrubProgress(ref);
  const words = TEXT.split(" ");
  const hot = new Set(["ash", "Asheo:", "seconds.", "Manifest", "V3"]);

  return (
    <section ref={ref} id="manifesto" className="relative py-28 sm:py-36">
      <div className="container-x">
        <SectionHead
          index="01"
          kicker="THE DEVELOPER"
          title={
            <>
              ash doesn't ship demos. <span className="ember-text">He ships fire.</span>
            </>
          }
        />

        <p className="max-w-4xl font-display text-2xl leading-snug font-bold tracking-tight sm:text-4xl lg:text-[2.9rem] lg:leading-[1.2]">
          {words.map((w, i) => {
            const on = progress * words.length > i;
            const isHot = hot.has(w);
            return (
              <span
                key={i}
                className="transition-all duration-300"
                style={{
                  opacity: on ? 1 : 0.14,
                  color: on && isHot ? "#ffc46b" : undefined,
                  textShadow: on && isHot ? "0 0 24px rgba(255,138,61,0.5)" : undefined,
                }}
              >
                {w}{" "}
              </span>
            );
          })}
        </p>

        <div className="mt-16 grid gap-5 sm:grid-cols-3">
          {PRINCIPLES.map((c, i) => (
            <Reveal key={c.title} delay={i * 0.1}>
              <div className="spotlight card-lift glass group h-full rounded-2xl p-7">
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-ember/25 bg-ember/10 text-ember-soft transition-all duration-500 group-hover:scale-110 group-hover:bg-ember/20">
                  <c.icon className="h-5 w-5" />
                </div>
                <h3 className="font-display text-xl font-bold">{c.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-smoke">{c.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
