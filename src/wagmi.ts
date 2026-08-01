import { http, createConfig } from "wagmi";
import { polygonAmoy } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { RPC_URL } from "./config";

export const wagmiConfig = createConfig({
  chains: [polygonAmoy],
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    [polygonAmoy.id]: http(RPC_URL),
  },
});
