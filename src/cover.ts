/** Free-forever campaign covers — no external host required. */

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type CoverKind = "crowdfund" | "charity" | "unknown";

/** 和色 lock: 皆済 = darker 朽葉 (today), 義援 = brighter 千歳緑. */
export const KIND_WAIRO = {
  crowdfund: {
    pill: "#6B4533",
    pillText: "#fff8f0",
    stroke: "#917347",
    bar: "#CD5E3C",
    bar2: "#e08a6a",
  },
  charity: {
    pill: "#3D7A62",
    pillText: "#f7fbf8",
    stroke: "#5A9A7A",
    bar: "#3D7A62",
    bar2: "#7BB89A",
  },
  unknown: {
    pill: "#5A3A28",
    pillText: "#fff8f0",
    stroke: "#917347",
    bar: "#CD5E3C",
    bar2: "#e08a6a",
  },
} as const;

/**
 * Deterministic SVG cover as data URI (tiny, permanent, no CDN).
 * Used as default image in metadata and as broken-image fallback.
 */
export function buildCoverDataUri(input: {
  title: string;
  kind?: CoverKind;
}): string {
  const title = (input.title || "旗揚げ").trim().slice(0, 40) || "旗揚げ";
  const kind = input.kind || "unknown";
  const label =
    kind === "charity" ? "義援" : kind === "crowdfund" ? "皆済" : "助太刀";
  const w = KIND_WAIRO[kind];
  const lines = wrapTitle(title, 12, 2);
  const paper0 = kind === "charity" ? "#f3f7f2" : "#f7f0e4";
  const paper1 = kind === "charity" ? "#e2eee6" : "#e8dcc8";

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${paper0}"/>
      <stop offset="100%" stop-color="${paper1}"/>
    </linearGradient>
    <pattern id="shippo" width="40" height="40" patternUnits="userSpaceOnUse">
      <circle cx="0" cy="0" r="14.14" fill="none" stroke="${w.stroke}" stroke-opacity="0.28" stroke-width="1.2"/>
      <circle cx="40" cy="0" r="14.14" fill="none" stroke="${w.stroke}" stroke-opacity="0.28" stroke-width="1.2"/>
      <circle cx="0" cy="40" r="14.14" fill="none" stroke="${w.stroke}" stroke-opacity="0.28" stroke-width="1.2"/>
      <circle cx="40" cy="40" r="14.14" fill="none" stroke="${w.stroke}" stroke-opacity="0.28" stroke-width="1.2"/>
      <circle cx="20" cy="20" r="14.14" fill="none" stroke="${w.stroke}" stroke-opacity="0.28" stroke-width="1.2"/>
    </pattern>
  </defs>
  <rect width="800" height="500" fill="url(#g)"/>
  <rect width="800" height="500" fill="url(#shippo)"/>
  <rect x="0" y="0" width="800" height="8" fill="${w.pill}"/>
  <rect x="48" y="48" width="120" height="36" rx="18" fill="${w.pill}"/>
  <text x="108" y="72" text-anchor="middle" font-family="Noto Sans JP, sans-serif" font-size="16" font-weight="700" fill="${w.pillText}">${esc(label)}</text>
  <text x="400" y="230" text-anchor="middle" font-family="Noto Sans JP, serif" font-size="42" font-weight="700" fill="#1f3134">${esc(lines[0] || title)}</text>
  ${lines[1] ? `<text x="400" y="285" text-anchor="middle" font-family="Noto Sans JP, serif" font-size="36" font-weight="700" fill="#1f3134">${esc(lines[1])}</text>` : ""}
  <text x="400" y="430" text-anchor="middle" font-family="Noto Sans JP, sans-serif" font-size="18" fill="#6c7a7f">助太刀 Sukedachi</text>
</svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function wrapTitle(t: string, maxChars: number, maxLines: number): string[] {
  const out: string[] = [];
  let rest = t;
  while (rest && out.length < maxLines) {
    if (rest.length <= maxChars) {
      out.push(rest);
      break;
    }
    out.push(rest.slice(0, maxChars));
    rest = rest.slice(maxChars);
  }
  return out;
}
