import type { Address } from "viem";
import { polygon, polygonAmoy } from "viem/chains";
import type { Chain } from "viem";

/**
 * Deployment registry — P1 length 1; P2 append only (never drop rows).
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

/** Polygon mainnet — live 2026-08-06 */
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

/** Amoy dogfood — kept in registry; not default */
export const AMOY_TESTNET: SukedachiDeployment = {
  id: "amoy-tjpyc-v2",
  chainId: 80002,
  chain: polygonAmoy,
  label: "Amoy · tJPYC (test)",
  jpyc: "0x996727D565dFC452491f961Ad370fe3F0B5dD124",
  jpycDecimals: 18,
  tokenSymbol: "tJPYC",
  factory: "0x4290d1C5252E62EF2633EB1adB4584De3EEbE0CD",
  profile: "0x5260D0782137A8B014979754756D5e9e6EF0287F",
  factoryDeployBlock: 43_970_575n,
  status: "testnet",
  minGoalWhole: 100,
  minDurationDays: 0,
  createOpenDefault: true,
};

/** Active list — canonical mainnet first; never drop rows. */
export const DEPLOYMENTS: SukedachiDeployment[] = [
  POLYGON_MAINNET,
  // AMOY_TESTNET, // re-enable only for dogfood UI
];

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
