import { http, webSocket, createConfig, fallback } from "wagmi";
import { MEGAETH_CHAIN } from "./contracts/config";
import { injected } from "wagmi/connectors";

// MegaETH RPC endpoints
const httpRpcUrl = "https://timothy.megaeth.com/rpc";
const wsRpcUrl = "wss://timothy.megaeth.com/rpc";

// Optional: Alchemy WebSocket endpoint (requires API key)
const alchemyWsUrl = import.meta.env.VITE_ALCHEMY_WS_URL;

/**
 * Transport configuration with fallback strategy:
 * 1. Try WebSocket first for real-time updates (when fully supported)
 * 2. Fallback to HTTP for reliability
 *
 * Note: Currently MegaETH WebSocket has limitations - most methods
 * except eth_chainId are restricted. This configuration is future-proof
 * for when full WebSocket support is available.
 */
const transports = [];

// Add Alchemy WebSocket if API key is provided
if (alchemyWsUrl) {
  transports.push(
    webSocket(alchemyWsUrl, {
      keepAlive: true,
      reconnect: {
        attempts: 5,
        delay: 1000,
      },
    })
  );
}

// Add MegaETH WebSocket endpoint
transports.push(
  webSocket(wsRpcUrl, {
    keepAlive: true,
    reconnect: {
      attempts: 5,
      delay: 1000,
    },
  })
);

// Always include HTTP as final fallback
transports.push(http(httpRpcUrl));

export const config = createConfig({
  chains: [MEGAETH_CHAIN],
  connectors: [injected()],
  transports: {
    [MEGAETH_CHAIN.id]: fallback(transports),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
