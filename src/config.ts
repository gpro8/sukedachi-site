import type { Address } from "viem";
import { polygonAmoy } from "viem/chains";
import factoryAbi from "./abi/SukedachiFactory.json";
import crowdfundAbi from "./abi/SukedachiCrowdfund.json";
import charityAbi from "./abi/SukedachiCharity.json";
import erc20Abi from "./abi/MockJPYC.json";

/** Polygon Amoy (80002) — Phase 2 */
export const CHAIN = polygonAmoy;

export const FACTORY_ADDRESS =
  "0xBE58e02115F053F9e90f6936CFFB4c05b335c70B" as Address;
export const JPYC_ADDRESS =
  "0x996727D565dFC452491f961Ad370fe3F0B5dD124" as Address;

/** Future mainnet official JPYC (do not use on Amoy UI) */
export const MAINNET_JPYC =
  "0x8549E82239a88f463ab6E55Ad1895b629a00Def3" as Address;

export const FACTORY_ABI = factoryAbi as any;
export const CROWDFUND_ABI = crowdfundAbi as any;
export const CHARITY_ABI = charityAbi as any;
export const ERC20_ABI = erc20Abi as any;

export const RPC_URL =
  (import.meta.env.VITE_RPC_URL as string | undefined) ||
  "https://polygon-amoy-bor-rpc.publicnode.com";

export const EXPLORER = "https://amoy.polygonscan.com";

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
