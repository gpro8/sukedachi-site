import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "./wagmi";
import App from "./App";
import "./styles.css";

// 七宝 pattern — BASE_URL-safe for GitHub project Pages (base: ./)
const shippo = `${import.meta.env.BASE_URL}patterns/shippo.svg`.replace(
  /([^:]\/)\/+/g,
  "$1"
);
document.documentElement.style.setProperty(
  "--shippo-bg",
  `url("${shippo}")`
);

const qc = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={qc}>
        <App />
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>
);
