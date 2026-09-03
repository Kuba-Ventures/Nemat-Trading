
import { useTimeLeft, pad } from "@/lib/countdown";

interface CountdownTimerProps {
  targetIso: string;
  label?: string;
  size?: "sm" | "lg";
  /**
   * "stacked" renders the hero treatment with HRS/MIN/SEC captions.
   * "inline" renders a single compact HH:MM:SS line for tight rows like the purchase bar.
   */
  variant?: "stacked" | "inline";
}

export default function CountdownTimer({
  targetIso,
  label,
  size = "lg",
  variant = "stacked",
}: CountdownTimerProps) {
  const time = useTimeLeft(targetIso);

  if (variant === "inline") {
    // Past 24 hours a clock face stops being readable in a row this tight, so
    // the compact form switches to days and drops the seconds.
    return (
      <span className="font-mono font-bold text-cyan-400 tabular-nums text-[15px] leading-none whitespace-nowrap">
        {time.isLong ? (
          <>
            {time.d}d {time.h}h {time.m}m
          </>
        ) : (
          <>
            {pad(time.h)}
            <span className="text-cyan-400/60">:</span>
            {pad(time.m)}
            <span className="text-cyan-400/60">:</span>
            {pad(time.s)}
          </>
        )}
      </span>
    );
  }

  const units = time.isLong
    ? [{ v: time.d, l: "DAYS" }, { v: time.h, l: "HRS" }, { v: time.m, l: "MIN" }]
    : [{ v: time.h, l: "HRS" }, { v: time.m, l: "MIN" }, { v: time.s, l: "SEC" }];

  const digitClass =
    size === "lg"
      ? "text-4xl md:text-5xl font-mono font-bold text-cyan-400 tracking-widest tabular-nums"
      : "text-2xl md:text-3xl font-mono font-bold text-cyan-400 tracking-widest tabular-nums";

  const sepClass =
    size === "lg" ? "text-3xl md:text-4xl font-mono text-cyan-400/60 mx-1" : "text-xl font-mono text-cyan-400/60 mx-0.5";

  const labelClass = size === "lg" ? "text-[10px] uppercase tracking-[0.2em] text-gray-400 mt-1" : "text-[10px] uppercase tracking-[0.2em] text-gray-400 mt-0.5";

  return (
    <div className="flex flex-col items-center gap-1">
      {label && (
        <span className="text-[10px] uppercase tracking-[0.25em] text-gray-500 mb-2">{label}</span>
      )}
      <div className="flex items-end gap-0">
        {units.map((unit, i) => (
          <div key={unit.l} className="flex items-end">
            <div className="flex flex-col items-center">
              <span className={digitClass}>{pad(unit.v)}</span>
              <span className={labelClass}>{unit.l}</span>
            </div>
            {i < 2 && <span className={sepClass + " mb-4"}>:</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
