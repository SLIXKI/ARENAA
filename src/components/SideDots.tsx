import { useEffect, useState } from "react";

const DOTS: [string, string][] = [
  ["top", "Ignite"],
  ["manifesto", "Manifesto"],
  ["asheo", "Asheo"],
  ["inside", "Inside"],
  ["craft", "Craft"],
  ["fame", "Fame"],
  ["get", "Get"],
];

/** Fixed section-spy dot navigation. Desktop only. */
export default function SideDots() {
  const [active, setActive] = useState("top");

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setActive(e.target.id);
        });
      },
      { rootMargin: "-38% 0px -55% 0px" }
    );
    DOTS.forEach(([id]) => {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, []);

  return (
    <nav
      aria-label="Section navigation"
      className="fixed top-1/2 left-5 z-50 hidden -translate-y-1/2 flex-col items-center gap-5 xl:flex"
    >
      <span className="h-10 w-px bg-gradient-to-b from-transparent to-ember/50" />
      {DOTS.map(([id, label]) => {
        const isActive = active === id;
        return (
          <a key={id} href={`#${id}`} className="group relative flex items-center" aria-label={label}>
            <span
              className={`block rounded-full transition-all duration-400 ${
                isActive
                  ? "h-2.5 w-2.5 bg-ember shadow-[0_0_12px_rgba(255,90,31,1)]"
                  : "h-1.5 w-1.5 bg-white/25 group-hover:bg-gold"
              }`}
            />
            <span
              className={`absolute left-5 font-mono text-[10px] tracking-[0.25em] whitespace-nowrap uppercase transition-all duration-300 ${
                isActive ? "text-gold opacity-100" : "text-smoke opacity-0 group-hover:opacity-100"
              }`}
            >
              {label}
            </span>
          </a>
        );
      })}
      <span className="h-10 w-px bg-gradient-to-t from-transparent to-ember/50" />
    </nav>
  );
}
