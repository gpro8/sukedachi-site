import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "./wagmi";
import App from "./App";
import { ToastHost } from "./Toast";
import { initTheme } from "./theme";
import "./styles.css";

/** Apply theme before paint to avoid flash */
initTheme("light");

/**
 * 七宝 pattern URL must be absolute.
 * Relative urls inside CSS custom properties resolve against the *stylesheet*
 * (…/assets/*.css), not the page — so "./patterns/…" becomes assets/patterns/ and 404s on GH Pages.
 */
function shippoBackgroundUrl(): string {
  try {
    return new URL("../patterns/shippo.svg", import.meta.url).href;
  } catch {
    const base = window.location.href.replace(/\/?([^/]*\.[^/]*)?$/, "/");
    return new URL("patterns/shippo.svg", base).href;
  }
}

document.documentElement.style.setProperty(
  "--shippo-bg",
  `url("${shippoBackgroundUrl()}")`
);

const qc = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={qc}>
        <App />
        <ToastHost />
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>
);
