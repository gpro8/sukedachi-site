/**
 * Event-sourced contributor list (Pledged / Donated) + Profile chips.
 * No on-chain enumerable backer array — same approach as auction bid history.
 */
import {
  createPublicClient,
  http,
  parseAbiItem,
  type Address,
  type Log,
} from "viem";
import {
  CHAIN,
  FACTORY_DEPLOY_BLOCK,
  PROFILE_ABI,
  PROFILE_ADDRESS,
  RPC_URL,
} from "./config";
import { emptyProfile, type UserProfile } from "./profile";

const LOG_CHUNK = 2_000n;
const CHUNK_DELAY_MS = 80;
const MAX_CHUNKS = 400;

const pledgedEvent = parseAbiItem(
  "event Pledged(address indexed backer, uint256 amount, uint256 totalRaised)"
);
const donatedEvent = parseAbiItem(
  "event Donated(address indexed donor, uint256 amount, uint256 totalRaised)"
);

const client = createPublicClient({
  chain: CHAIN,
  transport: http(RPC_URL, { retryCount: 2, retryDelay: 500 }),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type ContributorRow = {
  address: Address;
  total: bigint;
  lastBlock: bigint;
  profile: UserProfile;
};

async function getLogsOnce(params: {
  address: Address;
  event: typeof pledgedEvent | typeof donatedEvent;
  fromBlock: bigint;
  toBlock: bigint;
}): Promise<Log[]> {
  const { address, event, fromBlock, toBlock } = params;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return (await client.getLogs({
        address,
        event,
        fromBlock,
        toBlock,
      })) as Log[];
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/rate limit|429|timeout|limit|range/i.test(msg) && attempt < 4) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      throw e;
    }
  }
  return [];
}

async function getLogsChunked(params: {
  address: Address;
  event: typeof pledgedEvent | typeof donatedEvent;
  fromBlock: bigint;
  toBlock: bigint;
}): Promise<Log[]> {
  const { address, event } = params;
  let from = params.fromBlock;
  const to = params.toBlock;
  if (from > to) return [];
  const out: Log[] = [];
  let chunks = 0;
  while (from <= to && chunks < MAX_CHUNKS) {
    const end = from + LOG_CHUNK - 1n > to ? to : from + LOG_CHUNK - 1n;
    const part = await getLogsOnce({
      address,
      event,
      fromBlock: from,
      toBlock: end,
    });
    out.push(...part);
    from = end + 1n;
    chunks++;
    if (from <= to) await sleep(CHUNK_DELAY_MS);
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

export async function fetchContributors(
  campaign: Address,
  kind: "crowdfund" | "charity" | "unknown"
): Promise<ContributorRow[]> {
  const latest = await client.getBlockNumber();
  const fromBlock =
    FACTORY_DEPLOY_BLOCK > 0n ? FACTORY_DEPLOY_BLOCK : latest > 50_000n ? latest - 50_000n : 0n;
  const isCharity = kind === "charity";
  const event = isCharity ? donatedEvent : pledgedEvent;
  const roleKey = isCharity ? "donor" : "backer";
  const logs = await getLogsChunked({
    address: campaign,
    event,
    fromBlock,
    toBlock: latest,
  });
  const agg = aggregate(logs, roleKey);
  const profiles = await loadProfiles(agg.map((r) => r.address));
  return agg.map((r) => ({
    address: r.address,
    total: r.total,
    lastBlock: r.lastBlock,
    profile: profiles.get(r.address.toLowerCase()) || emptyProfile(),
  }));
}
