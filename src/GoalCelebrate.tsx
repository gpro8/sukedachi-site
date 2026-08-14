import { useEffect, useState } from "react";

const LS = "sukedachi.celebrate.v1.";

export function overGoalPct(raised: bigint, goal: bigint): number {
  if (goal <= 0n) return 0;
  return Number((raised * 10000n) / goal) / 100;
}

export function HankoStamp({
  className = "",
  label = "達成",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <svg
      className={`hanko-stamp ${className}`}
      viewBox="0 0 88 88"
      aria-hidden
    >
      <circle cx="44" cy="44" r="40" fill="none" stroke="currentColor" strokeWidth="4.5" />
      <circle cx="44" cy="44" r="33" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <text
        x="44"
        y="52"
        textAnchor="middle"
        fill="currentColor"
        fontSize="22"
        fontWeight="800"
        fontFamily='"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif'
      >
        {label}
      </text>
    </svg>
  );
}

/** One-time overlay on detail. Stamp stays via sibling UI. */
export function CelebrateOverlay({
  id,
  play,
  pctLabel,
}: {
  id: string;
  play: boolean;
  pctLabel: string;
}) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!play || !id) return;
    try {
      if (localStorage.getItem(LS + id)) return;
      localStorage.setItem(LS + id, "1");
    } catch {
      /* private mode: still play once this session */
    }
    setShow(true);
    const t = window.setTimeout(() => setShow(false), 2800);
    return () => window.clearTimeout(t);
  }, [play, id]);

  if (!show) return null;

  return (
    <div className="celebrate-overlay" role="status" aria-live="polite">
      <div className="celebrate-burst" />
      <div className="celebrate-card">
        <HankoStamp className="hanko-xl slam" />
        <p className="celebrate-kicker">おめでとうございます</p>
        <p className="celebrate-pct">{pctLabel}</p>
        <p className="celebrate-sub">目標達成 · 加勢はまだ受け付けています</p>
      </div>
    </div>
  );
}
