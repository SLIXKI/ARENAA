import { useEffect, useRef } from "react";

type Particle = {
  x: number;
  y: number;
  r: number;
  vy: number;
  vx: number;
  sway: number;
  swaySpeed: number;
  phase: number;
  hue: number;
  alpha: number;
  kind: "ember" | "ash" | "spark";
  life: number;
  maxLife: number;
};

/**
 * Cinematic rising-ember particle field.
 * Reacts to the mouse (gentle repulsion) and scroll velocity (updraft boost).
 */
export default function EmberField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let raf = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const mouse = { x: -9999, y: -9999 };
    let updraft = 0;
    let lastScroll = window.scrollY;

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const onMouse = (e: MouseEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };
    const onLeave = () => {
      mouse.x = -9999;
      mouse.y = -9999;
    };
    const onScroll = () => {
      const y = window.scrollY;
      updraft = Math.min(3.2, updraft + Math.min(2.4, Math.abs(y - lastScroll) / 90));
      lastScroll = y;
    };
    window.addEventListener("mousemove", onMouse, { passive: true });
    window.addEventListener("mouseleave", onLeave);
    window.addEventListener("scroll", onScroll, { passive: true });

    const count = Math.min(150, Math.floor((w * h) / 11000));
    const parts: Particle[] = [];
    const spawn = (initial = false): Particle => {
      const roll = Math.random();
      const kind: Particle["kind"] = roll < 0.62 ? "ember" : roll < 0.9 ? "ash" : "spark";
      const maxLife = 320 + Math.random() * 420;
      return {
        x: Math.random() * w,
        y: initial ? Math.random() * h : h + 12,
        r: kind === "ember" ? 0.8 + Math.random() * 2.1 : kind === "spark" ? 0.7 + Math.random() * 1.2 : 1 + Math.random() * 2.4,
        vy: kind === "ash" ? 0.12 + Math.random() * 0.3 : 0.35 + Math.random() * 1.1,
        vx: (Math.random() - 0.5) * 0.3,
        sway: 12 + Math.random() * 30,
        swaySpeed: 0.4 + Math.random() * 1.1,
        phase: Math.random() * Math.PI * 2,
        hue: kind === "ember" ? 14 + Math.random() * 26 : kind === "spark" ? 34 + Math.random() * 14 : 30,
        alpha: 0.35 + Math.random() * 0.6,
        kind,
        life: 0,
        maxLife,
      };
    };
    for (let i = 0; i < count; i++) parts.push(spawn(true));

    let t = 0;
    const tick = () => {
      t += 0.016;
      updraft *= 0.94;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";

      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        p.life += 1;
        p.phase += 0.016 * p.swaySpeed;

        const boost = 1 + updraft;
        p.y -= p.vy * boost * (reduced ? 0.25 : 1);
        p.x += p.vx + Math.sin(p.phase) * 0.35;

        // mouse repulsion
        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 150 * 150) {
          const d = Math.sqrt(d2) || 1;
          const f = ((150 - d) / 150) * 2.4;
          p.x += (dx / d) * f;
          p.y += (dy / d) * f;
        }

        const fadeIn = Math.min(1, p.life / 60);
        const fadeOut = Math.max(
          0,
          Math.min(1, (p.maxLife - p.life) / 90, p.y / (h * 0.25) + 0.15)
        );
        const flicker =
          p.kind === "ember" ? 0.65 + 0.35 * Math.sin(t * 9 + p.phase * 7) * Math.sin(t * 5.3 + p.phase) : 1;
        const a = Math.max(0, p.alpha * fadeIn * fadeOut * flicker);

        if (p.kind === "ash") {
          ctx.beginPath();
          ctx.fillStyle = `rgba(168,159,144,${(a * 0.28).toFixed(3)})`;
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.kind === "spark") {
          const len = 6 + p.vy * 9;
          const grad = ctx.createLinearGradient(p.x, p.y, p.x, p.y + len);
          grad.addColorStop(0, `rgba(255,196,107,${a.toFixed(3)})`);
          grad.addColorStop(1, "rgba(255,90,31,0)");
          ctx.strokeStyle = grad;
          ctx.lineWidth = p.r;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 4, p.y + len);
          ctx.stroke();
        } else {
          const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
          glow.addColorStop(0, `hsla(${p.hue}, 100%, 68%, ${a.toFixed(3)})`);
          glow.addColorStop(0.35, `hsla(${p.hue}, 100%, 52%, ${(a * 0.55).toFixed(3)})`);
          glow.addColorStop(1, "hsla(10, 100%, 40%, 0)");
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.fillStyle = `hsla(${p.hue + 8}, 100%, 80%, ${(a * 0.95).toFixed(3)})`;
          ctx.arc(p.x, p.y, p.r * 0.8, 0, Math.PI * 2);
          ctx.fill();
        }

        if (p.y < -20 || p.life > p.maxLife || p.x < -30 || p.x > w + 30) {
          parts[i] = spawn(false);
        }
      }

      ctx.globalCompositeOperation = "source-over";
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMouse);
      window.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[3]"
    />
  );
}
