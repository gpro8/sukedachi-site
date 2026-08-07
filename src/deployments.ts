import type { Address } from "viem";
import { polygon } from "viem/chains";
import type { Chain } from "viem";

/**
 * Deployment registry — append only for P2 multi-chain (never drop rows).
 * Money history lives on each factory forever; UI unions this list.
 */
export type SukedachiDeployment = {
  id: string;
  chainId: number;
  chain: Chain;
  label: string;
  jpyc: Address;
  jpycDecimals: number;
  tokenSymbol: string;
  factory: Address;
  profile: Address;
  factoryDeployBlock: bigint;
  status: "canonical" | "legacy" | "testnet";
  minGoalWhole: number;
  minDurationDays: number;
  createOpenDefault: boolean;
};

/** Polygon · JPYC — live */
export const POLYGON_MAINNET: SukedachiDeployment = {
  id: "polygon-jpyc-v1",
  chainId: 137,
  chain: polygon,
  label: "Polygon · JPYC",
  jpyc: "0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29",
  jpycDecimals: 18,
  tokenSymbol: "JPYC",
  factory: "0xe1bc023Cc8703f957f4a200B56f85BeA74a3253A",
  profile: "0xA8C536c4f555CA5F8b7Ff549F95D3c599FDB0FBE",
  factoryDeployBlock: 91_568_548n,
  status: "canonical",
  minGoalWhole: 1000,
  minDurationDays: 1,
  createOpenDefault: false,
};

/** Active list — canonical first; never drop historical rows when adding chains. */
export const DEPLOYMENTS: SukedachiDeployment[] = [POLYGON_MAINNET];

export function activeDeployments(): SukedachiDeployment[] {
  return DEPLOYMENTS.filter(
    (d) => d.factory !== "0x0000000000000000000000000000000000000000"
  );
}

export function deploymentByChainId(chainId: number): SukedachiDeployment | undefined {
  return activeDeployments().find((d) => d.chainId === chainId);
}

export function defaultDeployment(): SukedachiDeployment {
  const live = activeDeployments();
  const canonical = live.find((d) => d.status === "canonical");
  return canonical || live[0] || POLYGON_MAINNET;
}
