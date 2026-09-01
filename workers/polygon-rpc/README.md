# Sukedachi Polygon RPC Worker

JSON-RPC proxy so the **Alchemy key never ships in the browser bundle**.

- Live: `https://sukedachi-polygon-rpc.bushidao.workers.dev`
- Secret: `POLYGON_RPC_URL` (wrangler secret)
- Secret: `DISCORD_AL_WEBHOOK_URL` (AL form → Discord; never in the site)
- CORS allowlist: `ALLOWED_ORIGINS` in `wrangler.toml`

## Deploy

```bash
cd workers/polygon-rpc
npx wrangler secret put POLYGON_RPC_URL   # paste Alchemy polygon URL
npx wrangler secret put DISCORD_AL_WEBHOOK_URL
npx wrangler deploy
```

## Security notes

- Only `POST` JSON-RPC; allowlisted `eth_*` read methods (no `eth_sendRawTransaction`)
- Browser `Origin` must match allowlist (or localhost)
- `POST /v1/al` — origin allowlist · 5/IP/hour · webhook stays in Worker secret
- Rotate Alchemy key in dashboard if it was ever pasted in chat; update secret
- After a leaked page webhook: Discord regenerate, then `secret put DISCORD_AL_WEBHOOK_URL`
