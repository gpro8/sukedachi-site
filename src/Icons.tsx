/** Inline 和風 / clean UI icons — no external CDN (free-forever). */

type IconProps = { className?: string; title?: string };

const base = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true as const,
};

/** Vertical 幟 / 戦国旗 — tall square banner (not emoji flag) */
export function IconNobori({ className }: IconProps) {
  return (
    <svg {...base} className={className} viewBox="0 0 24 24">
      {/* pole */}
      <path d="M6 3v18" />
      {/* tall vertical banner cloth */}
      <path
        d="M7 4.2h7.2c.7 0 1.1.8.7 1.35l-1.15 1.55c-.25.35-.25.85 0 1.2l1.15 1.55c.4.55 0 1.35-.7 1.35H7"
        fill="currentColor"
        fillOpacity="0.12"
      />
      <path d="M7 4.2h7.2c.7 0 1.1.8.7 1.35l-1.15 1.55c-.25.35-.25.85 0 1.2l1.15 1.55c.4.55 0 1.35-.7 1.35H7" />
      {/* mon circle on cloth */}
      <circle cx="10.6" cy="7.8" r="1.35" />
    </svg>
  );
}

/** AL / scroll petition */
export function IconScroll({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M8 4h9a2 2 0 0 1 2 2v11.5a1.5 1.5 0 0 1-1.5 1.5H8" />
      <path d="M8 4a2 2 0 0 0-2 2v12.2c0 .9.7 1.6 1.6 1.6H18" />
      <path d="M10 9h5M10 12h5M10 15h3" />
    </svg>
  );
}

/** 賢契約 — sealed scroll / on-chain */
export function IconContract({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="5" y="3.5" width="14" height="17" rx="2" />
      <path d="M8.5 8h7M8.5 11.5h7M8.5 15h4.5" />
      <circle cx="15.5" cy="16.5" r="2.2" fill="currentColor" fillOpacity="0.15" />
      <circle cx="15.5" cy="16.5" r="2.2" />
    </svg>
  );
}

/** Wallet connect */
export function IconWallet({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M3.5 8.5h15.5a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18V8.5Z" />
      <path d="M3.5 8.5V7A1.5 1.5 0 0 1 5 5.5h11" />
      <circle cx="16.2" cy="14" r="1.1" fill="currentColor" />
    </svg>
  );
}

/** User / my page */
export function IconUser({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="8.2" r="3.2" />
      <path d="M5.5 19.2c.9-3.1 3.3-4.7 6.5-4.7s5.6 1.6 6.5 4.7" />
    </svg>
  );
}

/** List / home 一覧 */
export function IconList({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M9 7h10M9 12h10M9 17h10" />
      <circle cx="5.5" cy="7" r="1.1" fill="currentColor" />
      <circle cx="5.5" cy="12" r="1.1" fill="currentColor" />
      <circle cx="5.5" cy="17" r="1.1" fill="currentColor" />
    </svg>
  );
}

/** Raise flag / create */
export function IconRaise({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M7 20V5" />
      <path
        d="M7 5.5h8.5l-1.4 2.4 1.4 2.4H7"
        fill="currentColor"
        fillOpacity="0.14"
      />
      <path d="M7 5.5h8.5l-1.4 2.4 1.4 2.4H7" />
      <path d="M5.5 20h4" />
    </svg>
  );
}

/** FAQ / 心得 */
export function IconBook({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M5 5.5h5.2a2.3 2.3 0 0 1 2.3 2.3V20l-2.1-1.3L8.3 20V7.8A2.3 2.3 0 0 0 6 5.5H5" />
      <path d="M19 5.5h-5.2A2.3 2.3 0 0 0 11.5 7.8V20l2.1-1.3 2.1 1.3V7.8A2.3 2.3 0 0 1 18 5.5h1" />
    </svg>
  );
}

/** Sun — switch to light */
export function IconSun({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="3.6" />
      <path d="M12 3.5v1.8M12 18.7v1.8M3.5 12h1.8M18.7 12h1.8M6.1 6.1l1.3 1.3M16.6 16.6l1.3 1.3M6.1 17.9l1.3-1.3M16.6 7.4l1.3-1.3" />
    </svg>
  );
}

/** Moon — switch to dark */
export function IconMoon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M18.5 14.2A7.2 7.2 0 0 1 9.8 5.5 6.6 6.6 0 1 0 18.5 14.2Z" />
    </svg>
  );
}
