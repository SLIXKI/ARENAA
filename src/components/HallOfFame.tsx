import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  Expand,
  ImagePlus,
  MonitorSmartphone,
  Send,
  Trophy,
  X,
} from "lucide-react";
import { ASHEO, PROOF_FILTERS, PROOFS, type Proof } from "../config";
import { Reveal, SectionHead } from "./ui";

type Preview = { url: string; name: string };

const SLOTS = ["SLOT 01", "SLOT 02", "SLOT 03", "SLOT 04", "SLOT 05", "SLOT 06"];

/** Render only proofs whose files truly exist — the wall can never show a broken frame. */
function useLiveProofs() {
  const [live, setLive] = useState<Proof[]>([]);
  useEffect(() => {
    let alive = true;
    const found: Proof[] = [];
    PROOFS.forEach((p) => {
      const img = new Image();
      img.onload = () => {
        found.push(p);
        if (alive) setLive([...found].sort((a, b) => PROOFS.indexOf(a) - PROOFS.indexOf(b)));
      };
      img.src = p.src;
    });
    return () => {
      alive = false;
    };
  }, []);
  return live;
}

function Lightbox({
  proofs,
  index,
  onClose,
  onStep,
}: {
  proofs: Proof[];
  index: number;
  onClose: () => void;
  onStep: (d: number) => void;
}) {
  const p = proofs[index];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onStep(1);
      if (e.key === "ArrowLeft") onStep(-1);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose, onStep]);

  if (!p) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="fixed inset-0 z-[96] flex flex-col bg-abyss/95 backdrop-blur-xl"
      onClick={onClose}
    >
      <div className="container-x flex items-center justify-between py-4">
        <span className="font-mono text-xs tracking-[0.3em] text-smoke">
          PROOF {String(index + 1).padStart(2, "0")} / {String(proofs.length).padStart(2, "0")}
        </span>
        <button
          onClick={onClose}
          className="glass flex h-10 w-10 items-center justify-center rounded-full text-bone transition-colors hover:border-ember/60"
          aria-label="Close viewer"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div
        className="container-x relative flex min-h-0 flex-1 items-center justify-center gap-3 pb-4"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => onStep(-1)}
          className="glass z-10 hidden h-12 w-12 shrink-0 items-center justify-center rounded-full text-bone transition-colors hover:border-ember/60 sm:flex"
          aria-label="Previous proof"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <AnimatePresence mode="wait">
          <motion.figure
            key={p.src}
            initial={{ opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -12 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="flex min-h-0 max-w-4xl flex-col items-center"
          >
            <img
              src={p.src}
              alt={p.title}
              className="max-h-[62vh] w-auto max-w-full rounded-2xl border border-ember/25 object-contain shadow-[0_30px_100px_-20px_rgba(255,90,31,0.35)]"
            />
            <figcaption className="mt-4 max-w-xl text-center">
              <p className="font-display text-xl font-bold">{p.title}</p>
              <p className="mt-1 text-sm text-smoke">{p.detail}</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {p.tags.map((t) => (
                  <span key={t} className="chip">
                    {t}
                  </span>
                ))}
              </div>
            </figcaption>
          </motion.figure>
        </AnimatePresence>

        <button
          onClick={() => onStep(1)}
          className="glass z-10 hidden h-12 w-12 shrink-0 items-center justify-center rounded-full text-bone transition-colors hover:border-ember/60 sm:flex"
          aria-label="Next proof"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* mobile steppers */}
      <div className="flex items-center justify-center gap-4 pb-6 sm:hidden" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => onStep(-1)}
          className="glass flex h-11 w-11 items-center justify-center rounded-full"
          aria-label="Previous proof"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          onClick={() => onStep(1)}
          className="glass flex h-11 w-11 items-center justify-center rounded-full"
          aria-label="Next proof"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </motion.div>
  );
}

export default function HallOfFame() {
  const live = useLiveProofs();
  const [filter, setFilter] = useState<string>("All");
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasProofs = live.length > 0;
  const visible = useMemo(
    () => (filter === "All" ? live : live.filter((p) => p.tags.includes(filter))),
    [live, filter]
  );

  const step = (d: number) =>
    setLightbox((i) => (i === null ? i : (i + d + visible.length) % visible.length));

  const addFiles = (files: FileList | File[]) => {
    const imgs = Array.from(files).filter((f) => f.type.startsWith("image/")).slice(0, 6);
    if (!imgs.length) return;
    setPreviews((prev) =>
      [...prev, ...imgs.map((f) => ({ url: URL.createObjectURL(f), name: f.name }))].slice(0, 12)
    );
  };

  const remove = (url: string) => {
    URL.revokeObjectURL(url);
    setPreviews((prev) => prev.filter((p) => p.url !== url));
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };

  return (
    <section id="fame" className="relative py-28 sm:py-36">
      <div className="container-x">
        <SectionHead
          index="05"
          kicker="HALL OF FAME"
          title={
            hasProofs ? (
              <>
                The legends are <span className="ember-text">on the wall.</span>
              </>
            ) : (
              <>
                The wall awaits <span className="ember-text">its first legends.</span>
              </>
            )
          }
          blurb={
            hasProofs
              ? "Real Asheo runs, verified by ash — gateway hits, success screens and cleared payments. Click any frame to inspect it up close."
              : "This is where real Asheo payment proofs will live. The wall is empty on purpose — no stock screenshots, no borrowed wins, no fakes. Ever."
          }
        />

        {/* hero */}
        <Reveal>
          <div className="panel-deep relative overflow-hidden rounded-3xl p-10 text-center sm:p-14">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ember/15 blur-[100px]"
            />
            <motion.div
              initial={{ scale: 0.7, opacity: 0, rotate: -8 }}
              whileInView={{ scale: 1, opacity: 1, rotate: 0 }}
              viewport={{ once: true }}
              transition={{ type: "spring", stiffness: 120, damping: 14 }}
              className="relative mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl border border-gold/30 bg-gradient-to-br from-ember/25 to-blood/20 shadow-[0_0_60px_-10px_rgba(255,90,31,0.6)]"
            >
              <Trophy className="h-9 w-9 text-gold" />
            </motion.div>
            <h3 className="relative font-display text-2xl font-bold sm:text-4xl">
              {hasProofs ? (
                <>
                  {live.length} verified {live.length === 1 ? "proof" : "proofs"}.{" "}
                  <span className="text-outline-ember">0 fakes.</span>
                </>
              ) : (
                <>
                  0 proofs. 0 pretenders. <span className="text-outline-ember">100% real soon.</span>
                </>
              )}
            </h3>
            <p className="relative mx-auto mt-4 max-w-xl text-smoke">
              {hasProofs
                ? "The founding legends hold the top row — forever. Got a clean Asheo run? Send it in and take your place beside them."
                : "Got a clean Asheo run? Send your payment screenshot to ash and take your place on this wall. First legends get the top row — forever."}
            </p>
            <div className="relative mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              {ASHEO.telegramUrl ? (
                <a
                  href={ASHEO.telegramUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2.5 rounded-full bg-gradient-to-r from-blood via-ember to-ember-soft px-7 py-3.5 font-mono text-[12px] font-semibold tracking-[0.2em] text-white uppercase shadow-[0_12px_50px_-10px_rgba(255,90,31,0.8)]"
                >
                  <Send className="h-4 w-4" /> Submit via Telegram
                </a>
              ) : (
                <span className="flex items-center gap-2.5 rounded-full border border-dashed border-ember/50 bg-ember/[0.07] px-7 py-3.5 font-mono text-[12px] font-semibold tracking-[0.2em] text-ember-soft uppercase">
                  <Send className="h-4 w-4" /> Telegram submissions open soon
                </span>
              )}
              <span className="flex items-center gap-2 font-mono text-[11px] tracking-wider text-dim">
                <BadgeCheck className="h-4 w-4 text-emerald-400" /> every proof verified by ash
              </span>
            </div>
          </div>
        </Reveal>

        {/* gallery */}
        {hasProofs ? (
          <>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
              {PROOF_FILTERS.map((f) => {
                const count = f === "All" ? live.length : live.filter((p) => p.tags.includes(f)).length;
                if (f !== "All" && count === 0) return null;
                const isActive = filter === f;
                return (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`rounded-full px-4 py-2 font-mono text-[11px] tracking-[0.15em] uppercase transition-all duration-300 ${
                      isActive
                        ? "border border-ember/60 bg-ember/15 text-gold shadow-[0_0_24px_-6px_rgba(255,90,31,0.7)]"
                        : "border border-white/10 bg-white/[0.03] text-smoke hover:border-ember/40 hover:text-bone"
                    }`}
                  >
                    {f} <span className="opacity-60">· {count}</span>
                  </button>
                );
              })}
            </div>

            <motion.div layout className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <AnimatePresence mode="popLayout">
                {visible.map((p, i) => (
                  <motion.figure
                    layout
                    key={p.src}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                    onClick={() => setLightbox(i)}
                    className="group relative cursor-pointer overflow-hidden rounded-2xl border border-white/[0.08] bg-black/40 transition-colors duration-500 hover:border-ember/50"
                    data-hover
                  >
                    <div className="relative h-64 overflow-hidden sm:h-72">
                      <img
                        src={p.src}
                        alt={p.title}
                        loading="lazy"
                        className="h-full w-full object-cover object-top transition-transform duration-700 ease-out group-hover:scale-[1.05]"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
                      <span className="absolute top-3 left-3 rounded-full border border-gold/40 bg-black/70 px-3 py-1 font-mono text-[10px] tracking-[0.2em] text-gold backdrop-blur">
                        #{String(PROOFS.indexOf(p) + 1).padStart(2, "0")}
                      </span>
                      <span className="absolute top-3 right-3 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/60 text-bone opacity-0 backdrop-blur transition-all duration-300 group-hover:opacity-100">
                        <Expand className="h-4 w-4" />
                      </span>
                    </div>
                    <figcaption className="relative p-5">
                      <p className="font-display text-lg leading-tight font-bold">{p.title}</p>
                      <p className="mt-1.5 text-[13px] leading-relaxed text-smoke">{p.detail}</p>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {p.tags.map((t) => (
                          <span key={t} className="chip">
                            {t}
                          </span>
                        ))}
                      </div>
                    </figcaption>
                  </motion.figure>
                ))}
              </AnimatePresence>
            </motion.div>
          </>
        ) : (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SLOTS.map((s, i) => (
              <Reveal key={s} delay={(i % 3) * 0.08}>
                <div className="slot-shimmer flex aspect-[16/10] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/15 bg-white/[0.015]">
                  <span className="font-display text-4xl font-extrabold text-white/[0.08]">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="font-mono text-[11px] tracking-[0.3em] text-dim">{s}</span>
                  <span className="font-mono text-[10px] tracking-wider text-dim/60">
                    — awaiting a real proof —
                  </span>
                </div>
              </Reveal>
            ))}
          </div>
        )}

        {/* local dropzone */}
        <Reveal delay={0.05}>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={`mt-8 cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-all duration-300 sm:p-10 ${
              dragging
                ? "border-ember bg-ember/[0.08] shadow-[0_0_60px_-15px_rgba(255,90,31,0.5)]"
                : "border-white/12 bg-black/20 hover:border-ember/50 hover:bg-ember/[0.04]"
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <ImagePlus className={`mx-auto mb-4 h-8 w-8 transition-colors ${dragging ? "text-ember-soft" : "text-dim"}`} />
            <p className="font-display text-lg font-bold">
              {dragging ? "Drop it like it's proof." : "Preview your screenshot right here"}
            </p>
            <p className="mx-auto mt-2 flex max-w-md items-center justify-center gap-2 text-sm text-smoke">
              <MonitorSmartphone className="h-4 w-4 shrink-0 text-dim" />
              Drop images or click to browse — they preview below on this device only. Nothing uploads anywhere.
            </p>
          </div>
        </Reveal>

        <AnimatePresence>
          {previews.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              <p className="mt-8 mb-4 text-center font-mono text-[11px] tracking-[0.3em] text-gold uppercase">
                ◈ local preview — only you see this ◈
              </p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {previews.map((p) => (
                  <motion.figure
                    key={p.url}
                    layout
                    initial={{ opacity: 0, scale: 0.92 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="group relative overflow-hidden rounded-2xl border border-gold/25 bg-black/40"
                  >
                    <img src={p.url} alt={p.name} className="aspect-[16/10] w-full object-cover" />
                    <figcaption className="flex items-center justify-between gap-2 px-4 py-2.5">
                      <span className="truncate font-mono text-[11px] text-smoke">{p.name}</span>
                      <button
                        onClick={() => remove(p.url)}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/15 text-smoke transition-colors hover:border-blood hover:text-ember-soft"
                        aria-label={`Remove ${p.name}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </figcaption>
                  </motion.figure>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* lightbox */}
      <AnimatePresence>
        {lightbox !== null && visible.length > 0 && (
          <Lightbox proofs={visible} index={lightbox} onClose={() => setLightbox(null)} onStep={step} />
        )}
      </AnimatePresence>
    </section>
  );
}
