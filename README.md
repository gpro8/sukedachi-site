# Sukedachi Site (Phase 2)

JP-first UI for BushiDAO **助太刀** on Polygon Amoy.

## Amoy addresses

| | |
|--|--|
| Factory | `0xBE58e02115F053F9e90f6936CFFB4c05b335c70B` |
| tJPYC | `0x996727D565dFC452491f961Ad370fe3F0B5dD124` |

Mainnet JPYC (future): `0x8549E82239a88f463ab6E55Ad1895b629a00Def3`

## Dev

```bash
cd sukedachi-site
npm install
npm run dev
```

Wallet: MetaMask → Polygon Amoy. Need tJPYC (minted to deployer) + POL.

## Features

- List campaigns from factory  
- Detail: cover · title · description · リターン · pledge/donate · finalize · claim  
- **Create form:** タイトル / 説明 / リターン / 画像URL → **data URI** (free forever, no Pinata)  
- Advanced: paste raw metadata URI if needed  
- JP-first · AoN vs All-in clarity  

## Build (GitHub Pages / static)

```bash
npm run build
# output: dist/  (base: ./  → project pages OK)
# 七宝: public/patterns/shippo.svg via BASE_URL
```

### Publish to GitHub Pages

1. Create public repo e.g. `sukedachi-site` under your GitHub user  
2. Push `main`  
3. **Settings → Pages → Source: GitHub Actions**  
4. Optional secret: `VITE_RPC_URL`  
5. Site: `https://<user>.github.io/sukedachi-site/`

```bash
cd sukedachi-site
git remote add origin git@github.com:YOUR_USER/sukedachi-site.git
git push -u origin main
```
