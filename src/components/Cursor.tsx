import { useEffect, useState } from "react";
import { motion, useMotionValue, useSpring } from "motion/react";

/** Ember aura that trails the cursor + a reactive ring. Desktop only. */
export default function Cursor() {
  const [enabled, setEnabled] = useState(false);
  const [hot, setHot] = useState(false);
  const x = useMotionValue(-400);
  const y = useMotionValue(-400);
  const ax = useSpring(x, { stiffness: 90, damping: 22, mass: 0.6 });
  const ay = useSpring(y, { stiffness: 90, damping: 22, mass: 0.6 });
  const rx = useSpring(x, { stiffness: 500, damping: 40, mass: 0.4 });
  const ry = useSpring(y, { stiffness: 500, damping: 40, mass: 0.4 });

  useEffect(() => {
    if (window.matchMedia("(pointer: coarse)").matches) return;
    setEnabled(true);
    const move = (e: MouseEvent) => {
      x.set(e.clientX);
      y.set(e.clientY);
      const t = e.target as HTMLElement | null;
      setHot(!!t?.closest("a, button, [data-hover]"));
    };
    window.addEventListener("mousemove", move, { passive: true });
    return () => window.removeEventListener("mousemove", move);
  }, [x, y]);

  if (!enabled) return null;

  return (
    <>
      {/* aura */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none fixed left-0 top-0 z-[4] h-72 w-72 rounded-full opacity-60 mix-blend-screen"
        style={{
          x: ax,
          y: ay,
          translateX: "-50%",
          translateY: "-50%",
          background:
            "radial-gradient(circle, rgba(255,90,31,0.16) 0%, rgba(255,90,31,0.05) 45%, transparent 70%)",
        }}
      />
      {/* ring */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none fixed left-0 top-0 z-[80]"
        style={{ x: rx, y: ry, translateX: "-50%", translateY: "-50%" }}
      >
        <motion.div
          className="rounded-full border border-ember/70"
          animate={{
            width: hot ? 44 : 22,
            height: hot ? 44 : 22,
            opacity: hot ? 1 : 0.65,
            backgroundColor: hot ? "rgba(255,90,31,0.12)" : "rgba(255,90,31,0)",
          }}
          transition={{ type: "spring", stiffness: 400, damping: 28 }}
        >
          <span className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold" />
        </motion.div>
      </motion.div>
    </>
  );
}
