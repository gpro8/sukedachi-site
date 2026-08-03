import type { Address } from "viem";

export type UserProfile = {
  name: string;
  imageURI: string;
};

export function emptyProfile(): UserProfile {
  return { name: "", imageURI: "" };
}

export function profileDisplayName(p: UserProfile | undefined, address?: string): string {
  if (p?.name?.trim()) return p.name.trim();
  if (!address) return "—";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function hasDisplayProfile(p?: UserProfile): boolean {
  return !!(p && (p.name.trim() || p.imageURI.trim()));
}

/** Tiny deterministic avatar when no pfp set — not stored on-chain */
export function fallbackAvatarDataUri(address: string): string {
  const a = address.toLowerCase();
  let h = 0;
  for (let i = 0; i < a.length; i++) h = (h * 31 + a.charCodeAt(i)) >>> 0;
  const hue = h % 40;
  const c1 = `hsl(${hue + 10} 42% 38%)`;
  const c2 = `hsl(${hue + 25} 35% 55%)`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="#f4f1ea"/>
  <circle cx="32" cy="32" r="28" fill="none" stroke="${c1}" stroke-width="2" opacity="0.5"/>
  <circle cx="32" cy="26" r="10" fill="${c2}"/>
  <ellipse cx="32" cy="48" rx="16" ry="10" fill="${c1}"/>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function avatarSrc(p: UserProfile | undefined, address?: string): string {
  if (p?.imageURI?.trim()) return p.imageURI.trim();
  if (address) return fallbackAvatarDataUri(address);
  return fallbackAvatarDataUri("0x0000000000000000000000000000000000000000");
}

export type ProfileMap = Record<string, UserProfile>;

export function keyAddr(a: Address | string): string {
  return a.toLowerCase();
}
