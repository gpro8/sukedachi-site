/**
 * Event-sourced contributor list (Pledged / Donated) + Profile chips.
 * Lazy-load friendly: caller should only invoke on user request.
 * Multi-RPC + session cache to survive public-node prune/rate limits.
 */
import {
  createPublicClient,
  http,
  parseAbiItem,
  type Address,
  type Log,
  type PublicClient,
} from "viem";
import {
  CHAIN,
  FACTORY_DEPLOY_BLOCK,
  PROFILE_ABI,
  PROFILE_ADDRESS,
  RPC_URL,
} from "./config";
import { emptyProfile, type UserProfile } from "./profile";

/** Publicnode max range ~10k; stay under. */
const LOG_CHUNK = 9_000n;
const CHUNK_DELAY_MS = 40;
const MAX_CHUNKS = 80;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_PREFIX = "sk-contrib-v1:";

/** Prefer dedicated VITE_RPC_URL, then public endpoints that still serve recent eth_getLogs. */
const LOG_RPC_CANDIDATES: string[] = Array.from(
  new Set(
    [
      RPC_URL,
      "https://polygon-bor.publicnode.com",
      "https://rpc-mainnet.matic.quiknode.pro",
      "https://1rpc.io/matic",
      "https://polygon.drpc.org",
      "https://rpc.ankr.com/polygon",
    ].filter(Boolean)
  )
);

const pledgedEvent = parseAbiItem(
  "event Pledged(address indexed backer, uint256 amount, uint256 totalRaised)"
);
const donatedEvent = parseAbiItem(
  "event Donated(address indexed donor, uint256 amount, uint256 totalRaised)"
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type ContributorRow = {
  address: Address;
  total: bigint;
  lastBlock: bigint;
  profile: UserProfile;
};

type CachePayload = {
  at: number;
  rows: { address: Address; total: string; lastBlock: string; profile: UserProfile }[];
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

function writeCache(
  campaign: Address,
  kind: string,
  rows: ContributorRow[]
) {
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
    /* quota / private mode */
  }
}

function makeClient(url: string): PublicClient {
  return createPublicClient({
    chain: CHAIN,
    transport: http(url, { retryCount: 1, retryDelay: 400, timeout: 20_000 }),
  });
}

function friendlyRpcError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (/prun|history has been pruned|missing trie|ancient/i.test(msg)) {
    return new Error(
      "履歴RPCが古いブロックを保持していません。しばらくして再試行するか、運営に専用RPC設定を依頼してください。"
    );
  }
  if (/rate limit|429|too many|timeout|limit exceeded/i.test(msg)) {
    return new Error(
      "RPCが混雑しています。数秒待って「仲間を表示」を押してください。"
    );
  }
  if (/failed to fetch|network|ECONN|cors/i.test(msg)) {
    return new Error("ネットワークエラーです。接続を確認して再試行してください。");
  }
  // Never surface raw viem dumps in UI
  return new Error("仲間リストの取得に失敗しました。再試行してください。");
}

async function getLogsOnce(
  client: PublicClient,
  params: {
    address: Address;
    event: typeof pledgedEvent | typeof donatedEvent;
    fromBlock: bigint;
    toBlock: bigint;
  }
): Promise<Log[]> {
  const { address, event, fromBlock, toBlock } = params;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return (await client.getLogs({
        address,
        event,
        fromBlock,
        toBlock,
      })) as Log[];
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/rate limit|429|timeout/i.test(msg) && attempt < 3) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      // block range too large → caller should shrink; rethrow
      throw e;
    }
  }
  return [];
}

async function getLogsChunked(
  client: PublicClient,
  params: {
    address: Address;
    event: typeof pledgedEvent | typeof donatedEvent;
    fromBlock: bigint;
    toBlock: bigint;
  }
): Promise<Log[]> {
  const { address, event } = params;
  let from = params.fromBlock;
  const to = params.toBlock;
  if (from > to) return [];
  const out: Log[] = [];
  let chunks = 0;
  let chunk = LOG_CHUNK;
  while (from <= to && chunks < MAX_CHUNKS) {
    const end = from + chunk - 1n > to ? to : from + chunk - 1n;
    try {
      const part = await getLogsOnce(client, {
        address,
        event,
        fromBlock: from,
        toBlock: end,
      });
      out.push(...part);
      from = end + 1n;
      chunks++;
      if (from <= to) await sleep(CHUNK_DELAY_MS);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/range|prun|limit|too large|10.?000/i.test(msg) && chunk > 500n) {
        chunk = chunk / 2n;
        if (chunk < 500n) chunk = 500n;
        continue;
      }
      throw e;
    }
  }
  return out;
}

function aggregate(
  logs: Log[],
  roleKey: "backer" | "donor"
): { address: Address; total: bigint; lastBlock: bigint }[] {
  const map = new Map<
    string,
    { address: Address; total: bigint; lastBlock: bigint }
  >();
  for (const log of logs) {
    const args = (log as { args?: Record<string, unknown> }).args || {};
    const who = args[roleKey] as Address | undefined;
    const amount = args.amount as bigint | undefined;
    if (!who || amount == null) continue;
    const key = who.toLowerCase();
    const bn = log.blockNumber ?? 0n;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { address: who, total: amount, lastBlock: bn });
    } else {
      map.set(key, {
        address: prev.address,
        total: prev.total + amount,
        lastBlock: bn > prev.lastBlock ? bn : prev.lastBlock,
      });
    }
  }
  return [...map.values()].sort((a, b) => {
    if (a.total === b.total) {
      return a.lastBlock === b.lastBlock
        ? 0
        : a.lastBlock > b.lastBlock
          ? -1
          : 1;
    }
    return a.total > b.total ? -1 : 1;
  });
}

async function loadProfiles(
  client: PublicClient,
  addrs: Address[]
): Promise<Map<string, UserProfile>> {
  const out = new Map<string, UserProfile>();
  if (addrs.length === 0) return out;
  try {
    const results = await client.multicall({
      allowFailure: true,
      contracts: addrs.map((a) => ({
        address: PROFILE_ADDRESS,
        abi: PROFILE_ABI,
        functionName: "profileOf" as const,
        args: [a] as const,
      })),
    });
    results.forEach((res, i) => {
      const a = addrs[i];
      if (res.status === "success" && Array.isArray(res.result)) {
        const r = res.result as unknown[];
        out.set(a.toLowerCase(), {
          name: String(r[0] || ""),
          imageURI: String(r[1] || ""),
          xHandle: String(r[2] || ""),
        });
      } else {
        out.set(a.toLowerCase(), emptyProfile());
      }
    });
  } catch {
    for (const a of addrs) out.set(a.toLowerCase(), emptyProfile());
  }
  return out;
}

async function fetchWithClient(
  client: PublicClient,
  campaign: Address,
  kind: "crowdfund" | "charity" | "unknown"
): Promise<ContributorRow[]> {
  const latest = await client.getBlockNumber();
  // Free RPCs often prune ancient history. Prefer factory deploy when still
  // in-window; otherwise slide a recent lookback (~few days of Polygon blocks).
  const LOOKBACK = 150_000n;
  let fromBlock = FACTORY_DEPLOY_BLOCK > 0n ? FACTORY_DEPLOY_BLOCK : 0n;
  if (latest > LOOKBACK && fromBlock < latest - LOOKBACK) {
    fromBlock = latest - LOOKBACK;
  }
  if (fromBlock > latest) fromBlock = latest > 10_000n ? latest - 10_000n : 0n;

  const isCharity = kind === "charity";
  const event = isCharity ? donatedEvent : pledgedEvent;
  const roleKey = isCharity ? "donor" : "backer";

  let logs: Log[];
  try {
    logs = await getLogsChunked(client, {
      address: campaign,
      event,
      fromBlock,
      toBlock: latest,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/prun|history has been pruned/i.test(msg)) {
      // Retry from recent window only
      const recentFrom = latest > 20_000n ? latest - 20_000n : 0n;
      logs = await getLogsChunked(client, {
        address: campaign,
        event,
        fromBlock: recentFrom,
        toBlock: latest,
      });
    } else {
      throw e;
    }
  }

  const agg = aggregate(logs, roleKey);
  const profiles = await loadProfiles(
    client,
    agg.map((r) => r.address)
  );
  return agg.map((r) => ({
    address: r.address,
    total: r.total,
    lastBlock: r.lastBlock,
    profile: profiles.get(r.address.toLowerCase()) || emptyProfile(),
  }));
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

  let lastErr: unknown;
  for (const url of LOG_RPC_CANDIDATES) {
    try {
      const client = makeClient(url);
      const rows = await fetchWithClient(client, campaign, kind);
      writeCache(campaign, kind, rows);
      return rows;
    } catch (e) {
      lastErr = e;
      // try next RPC
      await sleep(150);
    }
  }
  throw friendlyRpcError(lastErr);
}

/** Clear session cache (e.g. after own pledge) for one campaign */
export function invalidateContributorCache(
  campaign: Address,
  kind?: string
) {
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
