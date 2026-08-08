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
const PROFILE = "0xA8C536c4f555CA5F8b7Ff549F95D3c599FDB0FBE";
const JPYC = "0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29";
const PROFILE_OF_SELECTOR = "2f8eb9cb";

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

export default {
  async fetch(request, env) {
    const allowed = parseOrigins(env);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, allowed);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (
      request.method === "GET" &&
      url.pathname.replace(/\/$/, "") === "/share"
    ) {
      // Public: Twitterbot/Discordbot have no Origin — must not require CORS origin.
      const c = (url.searchParams.get("c") || "").toLowerCase();
      if (!/^0x[a-f0-9]{40}$/.test(c)) {
        return new Response("bad c", { status: 400 });
      }
      const site = `https://gpro8.github.io/sukedachi-site/?c=${c}`;
      const shareSelf = `https://sukedachi-polygon-rpc.bushidao.workers.dev/share?c=${c}`;
      const img = "https://gpro8.github.io/sukedachi-site/og-share.jpg";
      const title = "助太刀 Sukedachi — この旗に加勢";
      const desc =
        "Polygon · JPYC。皆済は目標未達なら返金、義援は All-in。BushiDAO。";
      const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<meta name="description" content="${desc}"/>
<meta property="og:type" content="website"/>
<meta property="og:locale" content="ja_JP"/>
<meta property="og:site_name" content="助太刀 Sukedachi"/>
<meta property="og:title" content="${title}"/>
<meta property="og:description" content="${desc}"/>
<meta property="og:url" content="${shareSelf}"/>
<meta property="og:image" content="${img}"/>
<meta property="og:image:type" content="image/jpeg"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta property="og:image:alt" content="助太刀 Sukedachi · BushiDAO · Polygon · JPYC"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${title}"/>
<meta name="twitter:description" content="${desc}"/>
<meta name="twitter:image" content="${img}"/>
<meta name="twitter:image:alt" content="助太刀 Sukedachi · BushiDAO · Polygon · JPYC"/>
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
          "Cache-Control": "public, max-age=300",
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

    if (request.method === "GET") {
      return json(
        {
          ok: true,
          service: "sukedachi-polygon-rpc",
          routes: [
            "POST / json-rpc",
            "GET /contributors?address=0x&kind=crowdfund",
            "GET /share?c=0x — OG unfurl for X/Discord",
          ],
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
