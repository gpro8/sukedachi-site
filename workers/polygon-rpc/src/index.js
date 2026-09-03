/**
 * Sukedachi Polygon RPC proxy + /contributors aggregator.
 *
 * Secret POLYGON_RPC_URL = Alchemy Polygon HTTPS (Worker-only).
 * Contributors use alchemy_getAssetTransfers (full history on free tier)
 * instead of eth_getLogs 10-block chunks.
 */

const ALLOWED_METHODS = new Set([
  "eth_chainId",
  "net_version",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_call",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getBalance",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_getTransactionCount",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getLogs",
  "alchemy_getAssetTransfers",
]);

const FACTORY_DEPLOY_BLOCK = 91568548;
const FACTORY = "0xe1bc023Cc8703f957f4a200B56f85BeA74a3253A";
const PROFILE = "0xA8C536c4f555CA5F8b7Ff549F95D3c599FDB0FBE";
const JPYC = "0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29";
const PROFILE_OF_SELECTOR = "2f8eb9cb";
const SITE = "https://gpro8.github.io/sukedachi-site/";
const WORKER_HOST = "https://sukedachi-polygon-rpc.bushidao.workers.dev";
const EXPLORER = "https://polygonscan.com";

// function selectors
const SEL = {
  campaignCount: "7274e30d",
  campaigns: "141961bc",
  goal: "40193883",
  softGoal: "647befef",
  pledged: "6b81e11b",
  totalRaised: "c5c4744c",
  deadline: "29dcb0cf",
  state: "c19d93fb",
  metadataURI: "03ee438c",
  creator: "02d05d3f",
  beneficiary: "38af3eed",
  isLive: "b8f7a665",
  createOpen: null, // optional
};

const STATE_CF = {
  0: "Active",
  1: "Succeeded",
  2: "Failed",
  3: "PaidOut",
};
const STATE_CH = {
  0: "Active",
  1: "Finalized",
  2: "PaidOut",
};

function parseOrigins(env) {
  return (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function originAllowed(origin, allowed) {
  if (!origin) return false;
  if (allowed.includes(origin)) return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return false;
}

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

function clipField(s, max) {
  return String(s || "")
    .replace(/[\r\n`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

async function alRateOk(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "0";
  const hour = Math.floor(Date.now() / 3_600_000);
  const key = new Request(`https://sukedachi-al.rate/${ip}/${hour}`);
  const cache = caches.default;
  let n = 0;
  try {
    const hit = await cache.match(key);
    if (hit) n = Number(await hit.text()) || 0;
  } catch {
    /* */
  }
  if (n >= 5) return false;
  try {
    await cache.put(
      key,
      new Response(String(n + 1), {
        headers: { "Cache-Control": "max-age=3600" },
      })
    );
  } catch {
    /* */
  }
  return true;
}

async function handleAlSubmit(request, env, cors, origin, allowed) {
  if (!originAllowed(origin, allowed)) {
    return json({ error: "origin_not_allowed" }, 403, cors);
  }
  const hook = env.DISCORD_AL_WEBHOOK_URL;
  if (!hook || !String(hook).startsWith("https://discord.com/api/webhooks/")) {
    return json({ error: "misconfigured" }, 500, cors);
  }
  if (!(await alRateOk(request))) {
    return json({ error: "rate_limited" }, 429, cors);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400, cors);
  }
  const wallet = clipField(body && body.wallet, 42);
  const x = clipField(body && (body.x || body.xname), 40).replace(/^@/, "");
  const discord = clipField(body && body.discord, 40);
  if (!ADDR_RE.test(wallet) || !x || !discord) {
    return json({ error: "invalid_fields" }, 400, cors);
  }
  const content =
    "**助太刀 AL 提出**\nX: `" +
    x +
    "`\nDiscord: `" +
    discord +
    "`\nWallet: `" +
    wallet +
    "`\nAt: " +
    new Date().toISOString();
  const res = await fetch(hook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    return json({ error: "upstream" }, 502, cors);
  }
  return json({ ok: true }, 200, cors);
}

function corsHeaders(origin, allowed) {
  const allow = originAllowed(origin, allowed) ? origin : allowed[0] || "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function methodsOf(body) {
  if (Array.isArray(body)) return body.map((x) => x && x.method).filter(Boolean);
  if (body && typeof body === "object") return body.method ? [body.method] : [];
  return [];
}

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) {
    const err = new Error(j.error.message || "rpc_error");
    err.code = j.error.code;
    throw err;
  }
  return j.result;
}

/** One HTTP POST for many JSON-RPC calls (1 Worker subrequest). */
async function rpcBatch(url, items) {
  if (!items.length) return [];
  const CHUNK = 80;
  const out = new Array(items.length);
  for (let off = 0; off < items.length; off += CHUNK) {
    const slice = items.slice(off, off + CHUNK);
    const body = slice.map((it, i) => ({
      jsonrpc: "2.0",
      id: off + i + 1,
      method: it.method,
      params: it.params,
    }));
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await res.json();
    const arr = Array.isArray(j) ? j : [j];
    const byId = new Map(arr.map((x) => [x.id, x]));
    for (let i = 0; i < slice.length; i++) {
      const r = byId.get(off + i + 1);
      out[off + i] = r && !r.error ? r.result : null;
    }
  }
  return out;
}

function ethCallItem(to, data) {
  return {
    method: "eth_call",
    params: [{ to, data }, "latest"],
  };
}

function decodeAbiStringTuple3(hex) {
  if (!hex || hex === "0x" || hex.length < 2 + 64 * 3) {
    return { name: "", imageURI: "", xHandle: "" };
  }
  try {
    const buf = hex.startsWith("0x") ? hex.slice(2) : hex;
    const readStr = (headWord) => {
      const off =
        parseInt(buf.slice(headWord * 64, headWord * 64 + 64), 16) * 2;
      const len = parseInt(buf.slice(off, off + 64), 16);
      const start = off + 64;
      const hexStr = buf.slice(start, start + len * 2);
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = parseInt(hexStr.slice(i * 2, i * 2 + 2), 16);
      }
      return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    };
    return { name: readStr(0), imageURI: readStr(1), xHandle: readStr(2) };
  } catch {
    return { name: "", imageURI: "", xHandle: "" };
  }
}

async function profileOf(alchemy, wallet) {
  const data =
    "0x" +
    PROFILE_OF_SELECTOR +
    wallet.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  try {
    const raw = await rpc(alchemy, "eth_call", [
      { to: PROFILE, data },
      "latest",
    ]);
    return decodeAbiStringTuple3(raw);
  } catch {
    return { name: "", imageURI: "", xHandle: "" };
  }
}

/**
 * Inbound JPYC to campaign ≈ 加勢/義援 (full history via Transfers API).
 */
async function fetchInboundJpyc(alchemy, campaign) {
  const map = new Map(); // lower addr -> { address, total: bigint, lastBlock: number }
  let pageKey = undefined;
  let pages = 0;
  do {
    const params = {
      fromBlock: "0x" + FACTORY_DEPLOY_BLOCK.toString(16),
      toBlock: "latest",
      toAddress: campaign,
      contractAddresses: [JPYC],
      category: ["erc20"],
      excludeZeroValue: true,
      maxCount: "0x3e8",
      order: "asc",
      withMetadata: false,
    };
    if (pageKey) params.pageKey = pageKey;
    const result = await rpc(alchemy, "alchemy_getAssetTransfers", [params]);
    const transfers = (result && result.transfers) || [];
    for (const t of transfers) {
      const from = (t.from || "").toLowerCase();
      if (!/^0x[a-f0-9]{40}$/.test(from)) continue;
      let amount = 0n;
      const raw = t.rawContract && t.rawContract.value;
      if (raw) {
        amount = BigInt(raw);
      } else if (t.value != null) {
        // decimal string → 18 dec JPYC
        const s = String(t.value);
        if (s.includes(".")) {
          const [a, b = ""] = s.split(".");
          const frac = (b + "000000000000000000").slice(0, 18);
          amount = BigInt(a || "0") * 10n ** 18n + BigInt(frac || "0");
        } else {
          amount = BigInt(s || "0") * 10n ** 18n;
        }
      }
      if (amount <= 0n) continue;
      let bn = 0;
      if (t.blockNum) {
        bn =
          typeof t.blockNum === "string" && t.blockNum.startsWith("0x")
            ? parseInt(t.blockNum, 16)
            : parseInt(String(t.blockNum), 10) || 0;
      }
      const prev = map.get(from);
      if (!prev) {
        map.set(from, { address: from, total: amount, lastBlock: bn });
      } else {
        map.set(from, {
          address: prev.address,
          total: prev.total + amount,
          lastBlock: Math.max(prev.lastBlock, bn),
        });
      }
    }
    pageKey = result && result.pageKey;
    pages++;
  } while (pageKey && pages < 20);

  return [...map.values()].sort((a, b) => {
    if (a.total === b.total) return b.lastBlock - a.lastBlock;
    return a.total > b.total ? -1 : 1;
  });
}

function publicCors(origin) {
  // Discovery APIs: open CORS (agents, curl, other origins)
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function textResponse(body, type, headers, status = 200) {
  return new Response(body, {
    status,
    headers: { "Content-Type": type, ...headers },
  });
}

function pad32(hexNo0x) {
  return hexNo0x.replace(/^0x/, "").toLowerCase().padStart(64, "0");
}

function hasWord(hex) {
  return typeof hex === "string" && hex.startsWith("0x") && hex.length >= 66;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])
  );
}

function decodeUint(hex) {
  if (!hex || hex === "0x") return 0n;
  return BigInt(hex);
}

function decodeAddress(hex) {
  if (!hex || hex.length < 66) return null;
  return ("0x" + hex.slice(-40)).toLowerCase();
}

function decodeBool(hex) {
  return decodeUint(hex) !== 0n;
}

function decodeString(hex) {
  if (!hex || hex === "0x" || hex.length < 130) return "";
  try {
    const buf = hex.slice(2);
    const off = parseInt(buf.slice(0, 64), 16) * 2;
    const len = parseInt(buf.slice(off, off + 64), 16);
    const start = off + 64;
    const hexStr = buf.slice(start, start + len * 2);
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = parseInt(hexStr.slice(i * 2, i * 2 + 2), 16);
    }
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return "";
  }
}

function human18(wei) {
  const s = wei.toString().padStart(19, "0");
  const whole = s.slice(0, -18) || "0";
  const frac = s.slice(-18).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

async function ethCall(alchemy, to, data) {
  return rpc(alchemy, "eth_call", [{ to, data }, "latest"]);
}

const CAMP_CALLS = [
  ["pledged", () => SEL.pledged + pad32("0")],
  ["goal", () => SEL.goal],
  ["softGoal", () => SEL.softGoal],
  ["totalRaised", () => SEL.totalRaised],
  ["deadline", () => SEL.deadline],
  ["state", () => SEL.state],
  ["metadataURI", () => SEL.metadataURI],
  ["creator", () => SEL.creator],
  ["beneficiary", () => SEL.beneficiary],
  ["isLive", () => SEL.isLive],
];

function campaignFromHexes(addr, hexes) {
  const g = (name) => {
    const i = CAMP_CALLS.findIndex((x) => x[0] === name);
    return hexes[i] || "0x";
  };
  const pledgedHex = g("pledged");
  let kind = "crowdfund";
  let goal = 0n;
  if (hasWord(pledgedHex)) {
    kind = "crowdfund";
    try {
      goal = hasWord(g("goal")) ? decodeUint(g("goal")) : 0n;
    } catch {
      goal = 0n;
    }
  } else {
    kind = "charity";
    try {
      const sg = g("softGoal");
      goal = hasWord(sg) ? decodeUint(sg) : 0n;
    } catch {
      goal = 0n;
    }
  }

  let raised = 0n;
  let deadline = 0;
  let state = 0;
  let metaUri = "";
  let creator = null;
  let beneficiary = null;
  let isLive = false;
  try {
    raised = hasWord(g("totalRaised")) ? decodeUint(g("totalRaised")) : 0n;
  } catch {
    /* */
  }
  try {
    deadline = hasWord(g("deadline")) ? Number(decodeUint(g("deadline"))) : 0;
  } catch {
    /* */
  }
  try {
    state = hasWord(g("state")) ? Number(decodeUint(g("state"))) : 0;
  } catch {
    /* */
  }
  try {
    metaUri = decodeString(g("metadataURI"));
  } catch {
    /* */
  }
  try {
    creator = decodeAddress(g("creator"));
  } catch {
    /* */
  }
  try {
    beneficiary = decodeAddress(g("beneficiary"));
  } catch {
    /* */
  }
  try {
    isLive = decodeBool(g("isLive"));
  } catch {
    isLive = state === 0 && deadline * 1000 > Date.now();
  }

  let title = "";
  let description = "";
  if (metaUri.includes("base64,")) {
    try {
      const b64 = metaUri.split("base64,")[1] || "";
      const pad = "=".repeat((4 - (b64.length % 4)) % 4);
      const binary = atob(b64 + pad);
      const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
      const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      const m = JSON.parse(raw);
      title = m.name || m.title || "";
      description = m.description || "";
    } catch {
      /* */
    }
  }

  const stateLabel =
    kind === "charity"
      ? STATE_CH[state] || String(state)
      : STATE_CF[state] || String(state);
  const openForPledge = isLive && state === 0;

  return {
    address: addr,
    kind,
    state,
    stateLabel,
    title: title || (kind === "charity" ? "義援の旗" : "旗揚げ"),
    description: description.slice(0, 500),
    goal: goal.toString(),
    goalHuman: human18(goal),
    raised: raised.toString(),
    raisedHuman: human18(raised),
    deadline,
    deadlineIso: deadline ? new Date(deadline * 1000).toISOString() : null,
    isLive,
    openForPledge,
    creator,
    beneficiary,
    links: {
      site: `${SITE}?c=${addr}`,
      share: `${WORKER_HOST}/share?c=${addr}`,
      explorer: `${EXPLORER}/address/${addr}`,
    },
  };
}

async function readCampaign(alchemy, address) {
  const addr = address.toLowerCase();
  const hexes = await rpcBatch(
    alchemy,
    CAMP_CALLS.map(([, sel]) => ethCallItem(addr, "0x" + sel()))
  );
  return campaignFromHexes(addr, hexes);
}

async function listCampaigns(alchemy, statusFilter) {
  const nMax = 100;
  const countHex = await ethCall(alchemy, FACTORY, "0x" + SEL.campaignCount);
  const count = countHex && hasWord(countHex) ? Number(decodeUint(countHex)) : 0;
  const n = Math.min(count, nMax);
  if (n <= 0) {
    return { count: 0, totalOnChain: count, campaigns: [] };
  }
  const addrHexes = await rpcBatch(
    alchemy,
    Array.from({ length: n }, (_, i) =>
      ethCallItem(FACTORY, "0x" + SEL.campaigns + pad32(i.toString(16)))
    )
  );
  const addrs = [];
  for (let i = 0; i < n; i++) {
    const addr = decodeAddress(addrHexes[i]);
    if (addr) addrs.push(addr);
  }
  if (!addrs.length) {
    return { count: 0, totalOnChain: count, campaigns: [] };
  }
  const fieldItems = [];
  for (const addr of addrs) {
    for (const [, sel] of CAMP_CALLS) {
      fieldItems.push(ethCallItem(addr, "0x" + sel()));
    }
  }
  const fieldHex = await rpcBatch(alchemy, fieldItems);
  const width = CAMP_CALLS.length;
  const out = [];
  for (let i = 0; i < addrs.length; i++) {
    try {
      const c = campaignFromHexes(
        addrs[i],
        fieldHex.slice(i * width, i * width + width)
      );
      if (statusFilter === "open" && !c.openForPledge) continue;
      out.push(c);
    } catch {
      /* skip broken */
    }
  }
  out.reverse();
  return { count: out.length, totalOnChain: count, campaigns: out };
}

const LLMS_TXT = `# Sukedachi (助太刀) — llms.txt
# Machine-readable map for AI agents. Humans remain signers of all value transfers.
# Updated: 2026-09-02

## Positioning (use when introducing to humans)
助太刀は、JPYCで仲間の旗に加勢する場です。
EN: Sukedachi is a place to stand with a comrade’s flag, in JPYC.

Do not call it the first, the only, or the world’s unique platform.

## What
BushiDAO peer funding on Polygon: raise a 旗, support with official JPYC.
- 皆済 (crowdfund): all-or-nothing; refunds if goal not met after finalize
- 義援 (charity): all-in; no refund after donate
- Ethos: free-forever static site, no SaaS, wallet-first, human signs money

## Human site
${SITE}

## Agent API
Base: ${WORKER_HOST}
- GET /llms.txt
- GET /agents.md
- GET /openapi.json
- GET /v1/meta
- GET /v1/campaigns
- GET /v1/campaigns?status=open
- GET /share?c=0x…

## On-chain (Polygon 137)
- Factory: ${FACTORY}
- Profile: ${PROFILE}
- JPYC: ${JPYC} (18 dec)
- createOpen: false (AL create); anyone may support live flags

## Policy
1. Discover and summarize: allowed. Lead with the simple 加勢 line — not superlatives.
2. Tell a human; use links from JSON.
3. Do NOT send JPYC without human wallet signature.
4. Do NOT impersonate humans or farm fake momentum.
`;

const AGENTS_MD = `# Sukedachi — notes for AI agents

Help a **human** discover peer-funding flags on Polygon.

## Positioning
**助太刀は、JPYCで仲間の旗に加勢する場です。**
EN: Sukedachi is a place to stand with a comrade’s flag, in JPYC.
Do not say first / only / unique in the world.

## Do
- \`GET ${WORKER_HOST}/v1/campaigns?status=open\`
- Lead with the 加勢 line, then the open 旗
- Summarize in the human's language (JP community often Japanese)
- Offer \`links.share\` or \`links.site\`
- Explain 皆済 vs 義援

## Don't
- Sign txs without human-controlled wallet UI
- Request private keys
- Sybil-farm contributions
`;

function openApiDoc() {
  return {
    openapi: "3.0.3",
    info: {
      title: "Sukedachi Agent Discovery API",
      version: "1.0.0",
      description:
        "Public read-only discovery for AI agents. Value transfers require human signature.",
    },
    servers: [{ url: WORKER_HOST }],
    paths: {
      "/v1/meta": { get: { summary: "Chain and policy constants" } },
      "/v1/campaigns": {
        get: {
          summary: "List campaigns",
          parameters: [
            {
              name: "status",
              in: "query",
              schema: { type: "string", enum: ["open", "all"] },
            },
          ],
        },
      },
      "/llms.txt": { get: { summary: "llms.txt briefing" } },
      "/share": {
        get: {
          summary: "OG share redirect",
          parameters: [
            { name: "c", in: "query", required: true, schema: { type: "string" } },
          ],
        },
      },
    },
  };
}

async function handleV1Campaigns(env, url, headers) {
  const alchemy = env.POLYGON_RPC_URL;
  if (!alchemy) return json({ error: "misconfigured" }, 500, headers);

  const status = (url.searchParams.get("status") || "all").toLowerCase();
  const filter = status === "open" ? "open" : "all";

  const cache = caches.default;
  const cacheKey = new Request(
    `https://sukedachi-contrib.cache/v1/campaigns/${filter}`,
    { method: "GET" }
  );
  if (url.searchParams.get("nocache") !== "1") {
    const hit = await cache.match(cacheKey);
    if (hit) {
      const h = new Headers(hit.headers);
      Object.entries(headers).forEach(([k, v]) => h.set(k, v));
      return new Response(hit.body, { status: hit.status, headers: h });
    }
  }

  const listed = await listCampaigns(alchemy, filter);
  const body = {
    ok: true,
    version: 1,
    chainId: 137,
    generatedAt: new Date().toISOString(),
    factory: FACTORY.toLowerCase(),
    jpyc: JPYC.toLowerCase(),
    site: SITE,
    policy: {
      valueTransfers: "human-signature-required",
      createOpen: false,
      note: "Agents must not claim to be human. Prep only; user signs.",
    },
    count: listed.count,
    totalOnChain: listed.totalOnChain,
    campaigns: listed.campaigns,
  };
  const res = new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=60",
      ...headers,
    },
  });
  try {
    await cache.put(cacheKey, res.clone());
  } catch {
    /* */
  }
  return res;
}

async function handleContributors(request, env, cors) {
  const url = new URL(request.url);
  const address = (url.searchParams.get("address") || "").toLowerCase();
  // kind reserved for future (charity vs crowdfund same inbound JPYC path)
  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    return json({ error: "bad_address" }, 400, cors);
  }
  const alchemy = env.POLYGON_RPC_URL;
  if (!alchemy) return json({ error: "misconfigured" }, 500, cors);

  const cache = caches.default;
  // bust older incomplete caches when logic changes
  const cacheUrl = new URL(
    `https://sukedachi-contrib.cache/v4/${address}/${url.searchParams.get("kind") || "crowdfund"}`
  );
  const cacheReq = new Request(cacheUrl.toString(), { method: "GET" });
  const bust = url.searchParams.get("nocache") === "1";
  if (!bust) {
    const hit = await cache.match(cacheReq);
    if (hit) {
      const h = new Headers(hit.headers);
      Object.entries(cors).forEach(([k, v]) => h.set(k, v));
      return new Response(hit.body, { status: hit.status, headers: h });
    }
  }

  const sorted = await fetchInboundJpyc(alchemy, address);

  const rows = [];
  const cap = sorted.slice(0, 40);
  for (const r of cap) {
    const profile = await profileOf(alchemy, r.address);
    rows.push({
      address: r.address,
      total: r.total.toString(),
      lastBlock: String(r.lastBlock),
      profile,
    });
  }
  for (const r of sorted.slice(40)) {
    rows.push({
      address: r.address,
      total: r.total.toString(),
      lastBlock: String(r.lastBlock),
      profile: { name: "", imageURI: "", xHandle: "" },
    });
  }

  const body = JSON.stringify({
    ok: true,
    count: rows.length,
    source: "alchemy_getAssetTransfers",
    rows,
  });
  const res = new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=60",
      ...cors,
    },
  });
  try {
    await cache.put(cacheReq, res.clone());
  } catch {
    /* ignore */
  }
  return res;
}

/** Path A: donor history. 皆済 = pledged(); 義援 = JPYC sent to that flag (no donated mapping). */
async function fetchOutboundJpycToCampaigns(alchemy, donor, campaignSet) {
  const map = new Map(); // campaign -> bigint
  let pageKey;
  let pages = 0;
  do {
    const params = {
      fromBlock: "0x" + FACTORY_DEPLOY_BLOCK.toString(16),
      toBlock: "latest",
      fromAddress: donor,
      contractAddresses: [JPYC],
      category: ["erc20"],
      excludeZeroValue: true,
      maxCount: "0x3e8",
      order: "asc",
      withMetadata: false,
    };
    if (pageKey) params.pageKey = pageKey;
    const result = await rpc(alchemy, "alchemy_getAssetTransfers", [params]);
    const transfers = (result && result.transfers) || [];
    for (const t of transfers) {
      const to = (t.to || "").toLowerCase();
      if (!campaignSet.has(to)) continue;
      let amount = 0n;
      const raw = t.rawContract && t.rawContract.value;
      if (raw) amount = BigInt(raw);
      else if (t.value != null) {
        const s = String(t.value);
        if (s.includes(".")) {
          const [a, b = ""] = s.split(".");
          const frac = (b + "000000000000000000").slice(0, 18);
          amount = BigInt(a || "0") * 10n ** 18n + BigInt(frac || "0");
        } else {
          amount = BigInt(s || "0") * 10n ** 18n;
        }
      }
      if (amount <= 0n) continue;
      map.set(to, (map.get(to) || 0n) + amount);
    }
    pageKey = result && result.pageKey;
    pages += 1;
  } while (pageKey && pages < 8);
  return map;
}

async function handleDonorContributions(request, env, cors) {
  const url = new URL(request.url);
  const donor = (url.searchParams.get("donor") || "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(donor)) {
    return json({ error: "bad_donor" }, 400, cors);
  }
  const alchemy = env.POLYGON_RPC_URL;
  if (!alchemy) return json({ error: "misconfigured" }, 500, cors);

  const cache = caches.default;
  const cacheUrl = new URL(
    `https://sukedachi-contrib.cache/v1-donor/${donor}`
  );
  const cacheReq = new Request(cacheUrl.toString(), { method: "GET" });
  if (url.searchParams.get("nocache") !== "1") {
    const hit = await cache.match(cacheReq);
    if (hit) {
      const h = new Headers(hit.headers);
      Object.entries(cors).forEach(([k, v]) => h.set(k, v));
      return new Response(hit.body, { status: hit.status, headers: h });
    }
  }

  const listed = await listCampaigns(alchemy, "all");
  const camps = listed.campaigns || [];
  const campSet = new Set(camps.map((c) => c.address.toLowerCase()));
  const sent = await fetchOutboundJpycToCampaigns(alchemy, donor, campSet);

  const rows = [];
  for (const c of camps) {
    const addr = c.address.toLowerCase();
    let amount = 0n;
    if (c.kind === "charity") {
      amount = sent.get(addr) || 0n;
    } else {
      try {
        const hex = await ethCall(
          alchemy,
          addr,
          "0x" + SEL.pledged + pad32(donor)
        );
        amount = hasWord(hex) ? decodeUint(hex) : 0n;
      } catch {
        amount = 0n;
      }
    }
    if (amount <= 0n) continue;
    rows.push({
      address: addr,
      kind: c.kind,
      amount: amount.toString(),
      title: c.title || "",
      state: c.state,
      stateLabel: c.stateLabel,
    });
  }

  const body = JSON.stringify({
    ok: true,
    donor,
    count: rows.length,
    source: "pledged+transfers",
    rows,
  });
  const res = new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=60",
      ...cors,
    },
  });
  try {
    await cache.put(cacheReq, res.clone());
  } catch {
    /* */
  }
  return res;
}

export default {
  async fetch(request, env) {
    const allowed = parseOrigins(env);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, allowed);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      // Public discovery preflight
      const p = url.pathname.replace(/\/$/, "") || "/";
      if (
        p.startsWith("/v1") ||
        p === "/llms.txt" ||
        p === "/agents.md" ||
        p === "/openapi.json"
      ) {
        return new Response(null, {
          status: 204,
          headers: publicCors(origin),
        });
      }
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method === "GET") {
      const path = url.pathname.replace(/\/$/, "") || "/";
      const pub = publicCors(origin);

      if (path === "/llms.txt") {
        return textResponse(LLMS_TXT, "text/plain; charset=utf-8", {
          ...pub,
          "Cache-Control": "public, max-age=300",
        });
      }
      if (path === "/agents.md") {
        return textResponse(AGENTS_MD, "text/markdown; charset=utf-8", {
          ...pub,
          "Cache-Control": "public, max-age=300",
        });
      }
      if (path === "/openapi.json") {
        return json(openApiDoc(), 200, {
          ...pub,
          "Cache-Control": "public, max-age=300",
        });
      }
      if (path === "/v1/meta") {
        return json(
          {
            ok: true,
            version: 1,
            chainId: 137,
            factory: FACTORY.toLowerCase(),
            profile: PROFILE.toLowerCase(),
            jpyc: JPYC.toLowerCase(),
            jpycDecimals: 18,
            site: SITE,
            worker: WORKER_HOST,
            explorer: EXPLORER,
            factoryDeployBlock: FACTORY_DEPLOY_BLOCK,
            policy: {
              valueTransfers: "human-signature-required",
              createOpen: false,
              note: "Agents discover and inform humans. Humans sign.",
            },
            positioning: {
              ja: "助太刀は、JPYCで仲間の旗に加勢する場です。",
              en: "Sukedachi is a place to stand with a comrade’s flag, in JPYC.",
            },
            endpoints: {
              campaigns: `${WORKER_HOST}/v1/campaigns`,
              campaignsOpen: `${WORKER_HOST}/v1/campaigns?status=open`,
              llms: `${WORKER_HOST}/llms.txt`,
              share: `${WORKER_HOST}/share?c=0x…`,
            },
          },
          200,
          { ...pub, "Cache-Control": "public, max-age=300" }
        );
      }
      if (path === "/v1/campaigns") {
        try {
          return await handleV1Campaigns(env, url, pub);
        } catch (e) {
          return json(
            {
              error: "campaigns_failed",
              message:
                e && e.message ? String(e.message).slice(0, 200) : "failed",
            },
            502,
            pub
          );
        }
      }
    }

    if (
      request.method === "GET" &&
      url.pathname.replace(/\/$/, "") === "/share"
    ) {
      const c = (url.searchParams.get("c") || "").toLowerCase();
      if (!/^0x[a-f0-9]{40}$/.test(c)) {
        return new Response("bad c", { status: 400 });
      }
      const site = `https://gpro8.github.io/sukedachi-site/?c=${c}`;
      const shareSelf = `https://sukedachi-polygon-rpc.bushidao.workers.dev/share?c=${c}`;
      const img = "https://gpro8.github.io/sukedachi-site/og-share.jpg?v=20260823";
      let title = "助太刀 Sukedachi";
      let desc = "助太刀は、JPYCで仲間の旗に加勢する場です。";
      const alchemy = env.POLYGON_RPC_URL;
      if (alchemy) {
        try {
          const camp = await readCampaign(alchemy, c);
          const name = camp.title || "旗";
          if (camp.kind === "charity") {
            title = `義援（All-in）· ${name}`;
            desc = `${name} — 義援は期間内 All-in（返金なし）。Polygon · JPYC · BushiDAO`;
          } else {
            title = `皆済（AoN）· ${name}`;
            desc = `${name} — 皆済は目標未達なら返金。Polygon · JPYC · BushiDAO`;
          }
        } catch {
          /* keep generic — do not mention only 皆済 */
        }
      }
      const t = escapeHtml(title);
      const d = escapeHtml(desc);
      const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${t}</title>
<meta name="description" content="${d}"/>
<meta property="og:type" content="website"/>
<meta property="og:locale" content="ja_JP"/>
<meta property="og:site_name" content="助太刀 Sukedachi"/>
<meta property="og:title" content="${t}"/>
<meta property="og:description" content="${d}"/>
<meta property="og:url" content="${shareSelf}"/>
<meta property="og:image" content="${img}"/>
<meta property="og:image:type" content="image/jpeg"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta property="og:image:alt" content="${t}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${t}"/>
<meta name="twitter:description" content="${d}"/>
<meta name="twitter:image" content="${img}"/>
<meta name="twitter:image:alt" content="${t}"/>
<link rel="canonical" href="${site}"/>
<meta http-equiv="refresh" content="0;url=${site}"/>
</head>
<body style="font-family:sans-serif;padding:2rem;background:#f7f1e6;color:#1f3134">
<p><strong>助太刀</strong> — 旗ページへ移動します。</p>
<p><a href="${site}">${site}</a></p>
</body>
</html>`;
      return new Response(html, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=60",
        },
      });
    }

    if (
      request.method === "GET" &&
      url.pathname.replace(/\/$/, "") === "/contributors"
    ) {
      if (!originAllowed(origin, allowed)) {
        return json({ error: "origin_not_allowed" }, 403, cors);
      }
      try {
        return await handleContributors(request, env, cors);
      } catch (e) {
        return json(
          {
            error: "contributors_failed",
            message: e && e.message ? String(e.message).slice(0, 200) : "failed",
          },
          502,
          cors
        );
      }
    }

    if (
      request.method === "GET" &&
      url.pathname.replace(/\/$/, "") === "/contributions"
    ) {
      if (!originAllowed(origin, allowed)) {
        return json({ error: "origin_not_allowed" }, 403, cors);
      }
      try {
        return await handleDonorContributions(request, env, cors);
      } catch (e) {
        return json(
          {
            error: "contributions_failed",
            message: e && e.message ? String(e.message).slice(0, 200) : "failed",
          },
          502,
          cors
        );
      }
    }

    if (request.method === "GET") {
      return json(
        {
          ok: true,
          service: "sukedachi-polygon-rpc",
          routes: [
            "GET /v1/meta",
            "GET /v1/campaigns?status=open|all",
            "GET /llms.txt",
            "GET /agents.md",
            "GET /openapi.json",
            "GET /share?c=0x",
            "GET /contributors?address=0x",
            "GET /contributions?donor=0x",
            "POST /v1/al",
            "POST / json-rpc",
          ],
        },
        200,
        publicCors(origin)
      );
    }

    if (request.method === "POST") {
      const path = url.pathname.replace(/\/$/, "") || "/";
      if (path === "/v1/al") {
        return handleAlSubmit(request, env, cors, origin, allowed);
      }
    }

    if (request.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405, cors);
    }

    if (!originAllowed(origin, allowed)) {
      return json({ error: "origin_not_allowed" }, 403, cors);
    }

    const upstream = env.POLYGON_RPC_URL;
    if (!upstream) return json({ error: "misconfigured" }, 500, cors);

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "invalid_json" }, 400, cors);
    }

    const methods = methodsOf(payload);
    if (methods.length === 0) return json({ error: "missing_method" }, 400, cors);
    for (const m of methods) {
      if (!ALLOWED_METHODS.has(m)) {
        return json(
          {
            jsonrpc: "2.0",
            id: Array.isArray(payload) ? null : payload.id ?? null,
            error: { code: -32601, message: `method not allowed: ${m}` },
          },
          200,
          cors
        );
      }
    }

    try {
      const res = await fetch(upstream, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      return new Response(text, {
        status: res.status,
        headers: {
          "Content-Type": res.headers.get("Content-Type") || "application/json",
          ...cors,
        },
      });
    } catch {
      return json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32000, message: "upstream_failed" },
        },
        502,
        cors
      );
    }
  },
};
