import { Fragment } from "react";

export default function Marquee({
  items,
  className = "",
  fast = false,
  outline = false,
}: {
  items: string[];
  className?: string;
  fast?: boolean;
  outline?: boolean;
}) {
  const row = [...items, ...items];
  return (
    <div className={`mask-fade-x overflow-hidden border-y border-white/[0.07] bg-coal/60 py-5 ${className}`}>
      <div className={`flex w-max items-center gap-8 pr-8 ${fast ? "animate-marquee-fast" : "animate-marquee"}`}>
        {row.map((item, i) => (
          <Fragment key={i}>
            <span
              className={`font-display text-2xl font-bold tracking-tight whitespace-nowrap sm:text-3xl ${
                outline ? "text-outline" : "text-bone/90"
              }`}
            >
              {item}
            </span>
            <span className="text-lg text-ember">◆</span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
