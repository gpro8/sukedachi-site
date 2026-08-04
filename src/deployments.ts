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
  /** Official / mock payment token */
  jpyc: Address;
  /** Whole-token decimals — prefer live read; this is fallback */
  jpycDecimals: number;
  tokenSymbol: string;
  factory: Address;
  profile: Address;
  /** First factory create block — getLogs window */
  factoryDeployBlock: bigint;
  status: "canonical" | "legacy" | "testnet";
  /** Human params for UI */
  minGoalWhole: number;
  minDurationDays: number;
  createOpenDefault: boolean;
};

/** Polygon mainnet — fill factory/profile/block after deploy */
export const POLYGON_MAINNET_PLACEHOLDER: SukedachiDeployment = {
  id: "polygon-jpyc-v1",
  chainId: 137,
  chain: polygon,
  label: "Polygon · JPYC",
  // Live JPYC — owner-confirmed 0xE7C3… (2026-08)
  jpyc: "0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29",
  jpycDecimals: 18,
  tokenSymbol: "JPYC",
  factory: "0x0000000000000000000000000000000000000000",
  profile: "0x0000000000000000000000000000000000000000",
  factoryDeployBlock: 0n,
  status: "canonical",
  minGoalWhole: 1000,
  minDurationDays: 1,
  createOpenDefault: false,
};

/** Amoy dogfood — clone factory + profile v2 */
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
  minDurationDays: 0, // factory may still be 1h on old Amoy
  createOpenDefault: true,
};

/**
 * Active list. Until mainnet factory is set, site uses Amoy only.
 * After deploy: put mainnet first as canonical; keep Amoy if desired.
 */
export const DEPLOYMENTS: SukedachiDeployment[] = [
  // POLYGON_MAINNET_PLACEHOLDER, // enable when factory !== zero
  AMOY_TESTNET,
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
  return canonical || live[0] || AMOY_TESTNET;
}
