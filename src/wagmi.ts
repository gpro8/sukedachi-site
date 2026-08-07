import { http, createConfig } from "wagmi";
import { polygon } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { RPC_URL } from "./config";

export const wagmiConfig = createConfig({
  chains: [polygon],
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    [polygon.id]: http(RPC_URL),
  },
});
