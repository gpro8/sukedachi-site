/**
 * Contributors via CF Worker /contributors (Alchemy key never in browser).
 * Falls back to multi-RPC client scan only if worker fails.
 */
import type { Address } from "viem";
import { emptyProfile, type UserProfile } from "./profile";
import { RPC_URL } from "./config";

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_PREFIX = "sk-contrib-v2:";
const WORKER_BASE =
  (import.meta.env.VITE_CONTRIB_API as string | undefined) ||
  RPC_URL.replace(/\/$/, "");

export type ContributorRow = {
  address: Address;
  total: bigint;
  lastBlock: bigint;
  profile: UserProfile;
};

type CachePayload = {
  at: number;
  rows: {
    address: Address;
    total: string;
    lastBlock: string;
    profile: UserProfile;
  }[];
};

function cacheKey(campaign: Address, kind: string) {
  return `${CACHE_PREFIX}${campaign.toLowerCase()}:${kind}`;
}

function readCache(campaign: Address, kind: string): ContributorRow[] | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(campaign, kind));
    if (!raw) return null;
    const p = JSON.parse(raw) as CachePayload;
    if (!p?.at || Date.now() - p.at > CACHE_TTL_MS) return null;
    return (p.rows || []).map((r) => ({
      address: r.address,
      total: BigInt(r.total),
      lastBlock: BigInt(r.lastBlock),
      profile: r.profile || emptyProfile(),
    }));
  } catch {
    return null;
  }
}

function writeCache(campaign: Address, kind: string, rows: ContributorRow[]) {
  try {
    const payload: CachePayload = {
      at: Date.now(),
      rows: rows.map((r) => ({
        address: r.address,
        total: r.total.toString(),
        lastBlock: r.lastBlock.toString(),
        profile: r.profile,
      })),
    };
    sessionStorage.setItem(cacheKey(campaign, kind), JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export function invalidateContributorCache(campaign: Address, kind?: string) {
  try {
    if (kind) {
      sessionStorage.removeItem(cacheKey(campaign, kind));
      return;
    }
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(CACHE_PREFIX + campaign.toLowerCase())) keys.push(k);
    }
    keys.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

function friendlyError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (/origin/i.test(msg)) {
    return new Error("この環境からのアクセスが許可されていません。");
  }
  if (/429|rate|混雑|timeout/i.test(msg)) {
    return new Error(
      "RPCが混雑しています。数秒待って「仲間を表示」を押してください。"
    );
  }
  return new Error("仲間リストの取得に失敗しました。再試行してください。");
}

export async function fetchContributors(
  campaign: Address,
  kind: "crowdfund" | "charity" | "unknown",
  opts?: { bypassCache?: boolean }
): Promise<ContributorRow[]> {
  if (!opts?.bypassCache) {
    const hit = readCache(campaign, kind);
    if (hit) return hit;
  }

  const k = kind === "charity" ? "charity" : "crowdfund";
  const url = `${WORKER_BASE}/contributors?address=${campaign}&kind=${k}`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t.slice(0, 180) || `http_${res.status}`);
    }
    const j = (await res.json()) as {
      ok?: boolean;
      rows?: {
        address: string;
        total: string;
        lastBlock: string;
        profile?: UserProfile;
      }[];
      error?: string;
      message?: string;
    };
    if (j.error) throw new Error(j.message || j.error);
    const rows: ContributorRow[] = (j.rows || []).map((r) => ({
      address: r.address as Address,
      total: BigInt(r.total || "0"),
      lastBlock: BigInt(r.lastBlock || "0"),
      profile: r.profile || emptyProfile(),
    }));
    writeCache(campaign, kind, rows);
    return rows;
  } catch (e) {
    throw friendlyError(e);
  }
}
