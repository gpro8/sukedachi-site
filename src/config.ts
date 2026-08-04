import type { Address } from "viem";
import factoryAbi from "./abi/SukedachiFactory.json";
import crowdfundAbi from "./abi/SukedachiCrowdfund.json";
import charityAbi from "./abi/SukedachiCharity.json";
import erc20Abi from "./abi/MockJPYC.json";
import profileAbi from "./abi/SukedachiProfile.json";
import { defaultDeployment } from "./deployments";

const d = defaultDeployment();

/** Active deployment (P1 single row). Prefer reading from deployments.ts. */
export const CHAIN = d.chain;
export const FACTORY_ADDRESS = d.factory as Address;
export const JPYC_ADDRESS = d.jpyc as Address;
export const PROFILE_ADDRESS = d.profile as Address;
export const TOKEN_SYMBOL = d.tokenSymbol;
export const JPYC_DECIMALS_FALLBACK = d.jpycDecimals;
export const FACTORY_DEPLOY_BLOCK = d.factoryDeployBlock;
export const MIN_GOAL_WHOLE = d.minGoalWhole;
export const MIN_DURATION_DAYS = d.minDurationDays;

/** @deprecated wrong CA — no code on Polygon. Kept so old notes grep clean. */
export const LEGACY_WRONG_JPYC =
  "0x8549E82239a88f463ab6E55Ad1895b629a00Def3" as Address;

/** Official Polygon JPYC (verified) */
export const MAINNET_JPYC =
  "0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29" as Address;

export const FACTORY_ABI = factoryAbi as any;
export const CROWDFUND_ABI = crowdfundAbi as any;
export const CHARITY_ABI = charityAbi as any;
export const ERC20_ABI = erc20Abi as any;
export const PROFILE_ABI = profileAbi as any;

export const RPC_URL =
  (import.meta.env.VITE_RPC_URL as string | undefined) ||
  (d.chainId === 137
    ? "https://polygon-bor-rpc.publicnode.com"
    : "https://polygon-amoy-bor-rpc.publicnode.com");

export const EXPLORER =
  d.chainId === 137
    ? "https://polygonscan.com"
    : "https://amoy.polygonscan.com";

export function arweaveToHttp(uri: string): string {
  if (!uri) return "";
  if (uri.startsWith("ar://")) return `https://arweave.net/${uri.slice(5)}`;
  if (uri.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${uri.slice(7)}`;
  return uri;
}

export function shortAddr(a?: string) {
  if (!a || a === "0x0000000000000000000000000000000000000000") return "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function formatTokenAmount(whole: string | number, symbol = TOKEN_SYMBOL) {
  const n = typeof whole === "number" ? whole : Number(whole);
  if (!Number.isFinite(n)) return `${whole} ${symbol}`;
  return `${n.toLocaleString("ja-JP")} ${symbol}`;
}
