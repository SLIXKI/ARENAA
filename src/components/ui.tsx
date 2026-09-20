import { useRef, type ReactNode, type MouseEvent } from "react";
import { motion, useMotionValue, useSpring } from "motion/react";

/* ---------------- Magnetic ---------------- */
export function Magnetic({
  children,
  strength = 0.35,
  className = "",
}: {
  children: ReactNode;
  strength?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 220, damping: 16, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 220, damping: 16, mass: 0.4 });

  const onMove = (e: MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * strength);
    y.set((e.clientY - (r.top + r.height / 2)) * strength);
  };
  const onLeave = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{ x: sx, y: sy }}
      className={`inline-block ${className}`}
    >
      {children}
    </motion.div>
  );
}

/* ---------------- Tilt (3D) ---------------- */
export function Tilt({
  children,
  className = "",
  max = 7,
}: {
  children: ReactNode;
  className?: string;
  max?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const srx = useSpring(rx, { stiffness: 160, damping: 20 });
  const sry = useSpring(ry, { stiffness: 160, damping: 20 });

  const onMove = (e: MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    rx.set(-py * max * 2);
    ry.set(px * max * 2);
  };
  const onLeave = () => {
    rx.set(0);
    ry.set(0);
  };

  return (
    <div style={{ perspective: 1200 }}>
      <motion.div
        ref={ref}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        style={{ rotateX: srx, rotateY: sry, transformStyle: "preserve-3d" }}
        className={className}
      >
        {children}
      </motion.div>
    </div>
  );
}

/* ---------------- Reveal ---------------- */
export function Reveal({
  children,
  delay = 0,
  y = 36,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.9, delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ---------------- SectionHead ---------------- */
export function SectionHead({
  index,
  kicker,
  title,
  blurb,
}: {
  index: string;
  kicker: string;
  title: ReactNode;
  blurb?: string;
}) {
  return (
    <div className="relative mb-12 sm:mb-16">
      <span
        aria-hidden="true"
        className="text-outline-faint pointer-events-none absolute -top-10 right-0 hidden select-none font-display text-[7rem] font-extrabold leading-none sm:block lg:text-[9rem]"
      >
        {index}
      </span>
      <Reveal>
        <p className="mb-4 flex items-center gap-3 font-mono text-[11px] tracking-[0.4em] text-ember-soft">
          <span className="inline-block h-px w-10 bg-gradient-to-r from-ember to-transparent" />
          {kicker}
        </p>
      </Reveal>
      <Reveal delay={0.08}>
        <h2 className="max-w-3xl font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
          {title}
        </h2>
      </Reveal>
      {blurb && (
        <Reveal delay={0.16}>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-smoke sm:text-lg">{blurb}</p>
        </Reveal>
      )}
    </div>
  );
}

/* ---------------- AshMark (logo) ---------------- */
export function AshMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#14110c" />
      <rect x="1" y="1" width="62" height="62" rx="13" fill="none" stroke="#ff5a1f" strokeOpacity="0.4" strokeWidth="2" />
      <path d="M32 10 L53 52 H44.5 L32 23.5 L19.5 52 H11 Z" fill="url(#ashmark-g)" />
      <circle cx="32" cy="44" r="2.6" fill="#ffc46b" />
      <defs>
        <linearGradient id="ashmark-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffc46b" />
          <stop offset=".5" stopColor="#ff5a1f" />
          <stop offset="1" stopColor="#a11206" />
        </linearGradient>
      </defs>
    </svg>
  );
}
