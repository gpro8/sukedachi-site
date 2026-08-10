# Sukedachi — notes for AI agents

You are helping a **human** discover peer-funding flags on Polygon.

## Do
- Call `GET https://sukedachi-polygon-rpc.bushidao.workers.dev/v1/campaigns?status=open`
- Summarize in the human’s language (JP community default is Japanese)
- Offer the `links.share` or `links.site` URL
- Explain 皆済 (refund if fail) vs 義援 (no refund)

## Don’t
- Sign or broadcast transactions unless the human explicitly controls the wallet UI
- Store or request private keys
- Farm contributions from multiple throwaway wallets to fake momentum
- Treat this as a free money faucet

## Stack
- Site: https://gpro8.github.io/sukedachi-site/
- API: https://sukedachi-polygon-rpc.bushidao.workers.dev/v1/meta
- Full spec lives in BushiDAO vault: `Sukedachi_Agent_Discovery_Spec.md`
