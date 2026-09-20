import { useEffect, useState } from "react";
import { motion } from "motion/react";

export default function Preloader({ onDone }: { onDone: () => void }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let v = 0;
    const id = window.setInterval(() => {
      v += 4 + Math.random() * 11;
      if (v >= 100) {
        v = 100;
        window.clearInterval(id);
        window.setTimeout(onDone, 450);
      }
      setProgress(Math.floor(v));
    }, 90);
    return () => window.clearInterval(id);
  }, [onDone]);

  return (
    <motion.div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-abyss"
      exit={{ clipPath: "inset(0 0 100% 0)", transition: { duration: 0.9, ease: [0.76, 0, 0.24, 1] } }}
    >
      {/* faint ember backdrop */}
      <div
        className="absolute inset-0 opacity-40"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 62%, rgba(255,90,31,0.22), transparent 70%)",
        }}
      />
      <motion.p
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative mb-5 font-mono text-[11px] tracking-[0.5em] text-ember-soft/80"
      >
        IGNITING&nbsp;THE&nbsp;FORGE
      </motion.p>

      <h1 className="relative flex overflow-hidden font-display text-[22vw] font-extrabold leading-none tracking-tight sm:text-[9rem]">
        {"ASH".split("").map((l, i) => (
          <motion.span
            key={i}
            initial={{ y: "110%", rotate: 4 }}
            animate={{ y: 0, rotate: 0 }}
            transition={{ delay: 0.15 + i * 0.12, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="ember-text inline-block"
          >
            {l}
          </motion.span>
        ))}
      </h1>

      <div className="relative mt-8 w-56 sm:w-72">
        <div className="h-px w-full bg-white/10">
          <motion.div
            className="h-px origin-left bg-gradient-to-r from-blood via-ember to-gold"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-3 flex items-center justify-between font-mono text-xs text-smoke">
          <span>ASH&nbsp;1.6</span>
          <span className="tabular-nums text-bone">{progress}%</span>
        </div>
      </div>
    </motion.div>
  );
}
