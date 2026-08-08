# Sukedachi Polygon RPC Worker

JSON-RPC proxy so the **Alchemy key never ships in the browser bundle**.

- Live: `https://sukedachi-polygon-rpc.bushidao.workers.dev`
- Secret: `POLYGON_RPC_URL` (wrangler secret)
- CORS allowlist: `ALLOWED_ORIGINS` in `wrangler.toml`

## Deploy

```bash
cd workers/polygon-rpc
npx wrangler secret put POLYGON_RPC_URL   # paste Alchemy polygon URL
npx wrangler deploy
```

## Security notes

- Only `POST` JSON-RPC; allowlisted `eth_*` read methods (no `eth_sendRawTransaction`)
- Browser `Origin` must match allowlist (or localhost)
- Rotate Alchemy key in dashboard if it was ever pasted in chat; update secret
