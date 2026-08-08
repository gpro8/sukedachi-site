/**
 * Sukedachi Polygon RPC proxy + /contributors aggregator.
 * Secret POLYGON_RPC_URL = Alchemy (reads). Logs use public full-range node
 * because Alchemy free eth_getLogs max range is 10 blocks.
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
]);

const LOG_RPC_DEFAULT = "https://polygon-bor.publicnode.com";
/** publicnode-friendly chunk under 10k */
const LOG_CHUNK = 9000;
const LOOKBACK_BLOCKS = 200000;
const FACTORY_DEPLOY_BLOCK = 91568548;
const PROFILE = "0xA8C536c4f555CA5F8b7Ff549F95D3c599FDB0FBE";
const PROFILE_OF_SELECTOR = "2f8eb9cb";

const TOPIC_PLEDGED =
  "0xb8765119b6cc15a7b5d15b95f6c505f2f3c24754824af1892788aad4c0e9945f";
const TOPIC_DONATED =
  "0x4928895ba6723e8e27b15f32e4c3054a1b6c7f8c03f133558d6fa42b3928d14c";

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

function topicAddress(topic) {
  if (!topic || topic.length < 66) return null;
  return ("0x" + topic.slice(26)).toLowerCase();
}

function decodeAmountData(data) {
  if (!data || data.length < 66) return 0n;
  return BigInt("0x" + data.slice(2, 66));
}

async function getLogsChunked(logRpc, address, topic0, fromBlock, toBlock) {
  const out = [];
  let from = fromBlock;
  while (from <= toBlock) {
    const end = Math.min(from + LOG_CHUNK - 1, toBlock);
    let attempt = 0;
    for (;;) {
      try {
        const logs = await rpc(logRpc, "eth_getLogs", [
          {
            address,
            fromBlock: "0x" + from.toString(16),
            toBlock: "0x" + end.toString(16),
            topics: [topic0],
          },
        ]);
        if (Array.isArray(logs)) out.push(...logs);
        break;
      } catch (e) {
        attempt++;
        if (attempt >= 4) throw e;
        await new Promise((r) => setTimeout(r, 200 * attempt));
      }
    }
    from = end + 1;
  }
  return out;
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
    const raw = await rpc(alchemy, "eth_call", [{ to: PROFILE, data }, "latest"]);
    return decodeAbiStringTuple3(raw);
  } catch {
    return { name: "", imageURI: "", xHandle: "" };
  }
}

function encodeAggregate3(calls) {
  // aggregate3((address target, bool allowFailure, bytes callData)[])
  const sel = "82ad56cb";
  const headSize = 32; // offset to array
  // dynamic array at 0x20
  let data = sel;
  data += "20".padStart(64, "0"); // offset
  data += calls.length.toString(16).padStart(64, "0");
  // each tuple is head: target, allowFailure, offset-to-bytes — then tails
  // Standard ABI encoding for dynamic array of (address,bool,bytes)
  const heads = [];
  const tails = [];
  let tailOffset = calls.length * 32 * 3; // relative to start of tuple array content... 
  // Simpler approach: build with known layout
  // For each call, tuple head is 3 words; bytes are dynamic
  // Array of tuples with dynamic bytes: each element offset first
  const elHeads = [];
  const elTails = [];
  let elTailPos = 32 * calls.length; // offsets relative to start of array data (after length)
  for (const c of calls) {
    elHeads.push(elTailPos.toString(16).padStart(64, "0"));
    const target = c.target.toLowerCase().replace(/^0x/, "").padStart(64, "0");
    const allow = (c.allowFailure ? 1 : 0).toString(16).padStart(64, "0");
    const cd = c.callData.replace(/^0x/, "");
    const cdLen = (cd.length / 2).toString(16).padStart(64, "0");
    const cdPad = cd + "0".repeat((64 - (cd.length % 64)) % 64);
    // tuple body: address, bool, offset(0x60), length, data
    const tuple =
      target +
      allow +
      "60".padStart(64, "0") +
      cdLen +
      cdPad;
    elTails.push(tuple);
    elTailPos += tuple.length / 2;
  }
  data += elHeads.join("") + elTails.join("");
  return "0x" + data;
}

function decodeAggregate3(hex, n) {
  // returns Result[] (bool success, bytes returnData)[]
  const profiles = [];
  if (!hex || hex === "0x") {
    for (let i = 0; i < n; i++) profiles.push({ name: "", imageURI: "", xHandle: "" });
    return profiles;
  }
  try {
    const buf = hex.slice(2);
    const arrOff = parseInt(buf.slice(0, 64), 16) * 2;
    const len = parseInt(buf.slice(arrOff, arrOff + 64), 16);
    const base = arrOff + 64;
    for (let i = 0; i < Math.min(len, n); i++) {
      const tupOff =
        base + parseInt(buf.slice(base + i * 64, base + i * 64 + 64), 16) * 2;
      // success at tupOff, bytes offset at tupOff+64
      const success = parseInt(buf.slice(tupOff, tupOff + 64), 16) === 1;
      const bytesOff =
        tupOff + parseInt(buf.slice(tupOff + 64, tupOff + 128), 16) * 2;
      const blen = parseInt(buf.slice(bytesOff, bytesOff + 64), 16);
      const bhex = "0x" + buf.slice(bytesOff + 64, bytesOff + 64 + blen * 2);
      profiles.push(
        success ? decodeAbiStringTuple3(bhex) : { name: "", imageURI: "", xHandle: "" }
      );
    }
    while (profiles.length < n) profiles.push({ name: "", imageURI: "", xHandle: "" });
    return profiles;
  } catch {
    return Array.from({ length: n }, () => ({
      name: "",
      imageURI: "",
      xHandle: "",
    }));
  }
}

async function handleContributors(request, env, cors) {
  const url = new URL(request.url);
  const address = (url.searchParams.get("address") || "").toLowerCase();
  const kind = url.searchParams.get("kind") || "crowdfund";
  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    return json({ error: "bad_address" }, 400, cors);
  }
  const alchemy = env.POLYGON_RPC_URL;
  const logRpc = env.LOG_RPC_URL || LOG_RPC_DEFAULT;
  if (!alchemy) return json({ error: "misconfigured" }, 500, cors);

  const cache = caches.default;
  const cacheReq = new Request(url.toString(), { method: "GET" });
  const hit = await cache.match(cacheReq);
  if (hit) {
    const h = new Headers(hit.headers);
    Object.entries(cors).forEach(([k, v]) => h.set(k, v));
    return new Response(hit.body, { status: hit.status, headers: h });
  }

  const latestHex = await rpc(logRpc, "eth_blockNumber", []);
  const latest = parseInt(latestHex, 16);
  // Free log nodes prune; keep a sliding window that still covers live campaigns.
  const LOOKBACK = 100000;
  let from = Math.max(FACTORY_DEPLOY_BLOCK, latest - LOOKBACK);
  if (from > latest) from = Math.max(0, latest - 10000);
  const topic = kind === "charity" ? TOPIC_DONATED : TOPIC_PLEDGED;

  let logs;
  try {
    logs = await getLogsChunked(logRpc, address, topic, from, latest);
  } catch (e) {
    const msg = e && e.message ? e.message : "";
    if (/prun|history/i.test(msg)) {
      from = Math.max(0, latest - 40000);
      logs = await getLogsChunked(logRpc, address, topic, from, latest);
    } else {
      throw e;
    }
  }
  const map = new Map();
  for (const log of logs) {
    const who = topicAddress(log.topics && log.topics[1]);
    if (!who) continue;
    const amount = decodeAmountData(log.data);
    const bn = parseInt(log.blockNumber, 16);
    const prev = map.get(who);
    if (!prev) map.set(who, { address: who, total: amount, lastBlock: bn });
    else
      map.set(who, {
        address: who,
        total: prev.total + amount,
        lastBlock: Math.max(prev.lastBlock, bn),
      });
  }

  const sorted = [...map.values()].sort((a, b) => {
    if (a.total === b.total) return b.lastBlock - a.lastBlock;
    return a.total > b.total ? -1 : 1;
  });

  // Profiles via Alchemy eth_call (cap 20 to stay under Worker subrequest limits)
  const rows = [];
  const cap = sorted.slice(0, 20);
  for (const r of cap) {
    const profile = await profileOf(alchemy, r.address);
    rows.push({
      address: r.address,
      total: r.total.toString(),
      lastBlock: String(r.lastBlock),
      profile,
    });
  }
  for (const r of sorted.slice(20)) {
    rows.push({
      address: r.address,
      total: r.total.toString(),
      lastBlock: String(r.lastBlock),
      profile: { name: "", imageURI: "", xHandle: "" },
    });
  }

  const body = JSON.stringify({ ok: true, count: rows.length, rows });
  const res = new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=90",
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

export default {
  async fetch(request, env) {
    const allowed = parseOrigins(env);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, allowed);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method === "GET" && url.pathname.replace(/\/$/, "") === "/contributors") {
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

    if (request.method === "GET") {
      return json(
        {
          ok: true,
          service: "sukedachi-polygon-rpc",
          routes: ["POST / json-rpc", "GET /contributors?address=0x&kind=crowdfund"],
        },
        200,
        cors
      );
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
        { jsonrpc: "2.0", id: null, error: { code: -32000, message: "upstream_failed" } },
        502,
        cors
      );
    }
  },
};
