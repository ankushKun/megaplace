import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { defineChain } from 'viem';
import { http, webSocket, fallback } from 'wagmi';

// Get Alchemy WebSocket URL from environment variable
const alchemyWsUrl = import.meta.env.VITE_ALCHEMY_WS_URL;

if (!alchemyWsUrl) {
  console.warn('VITE_ALCHEMY_WS_URL not set. Please add it to your .env file for WebSocket support.');
}

// Define MegaETH network
export const megaeth = defineChain({
  id: 6343,
  name: 'MegaETH Testnet',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ['https://timothy.megaeth.com/rpc'],
      webSocket: alchemyWsUrl ? [alchemyWsUrl] : undefined,
    },
  },
  blockExplorers: {
    default: {
      name: 'MegaETH Explorer',
      url: 'https://megaeth-testnet-v2.blockscout.com',
    },
  },
  testnet: true,
});

export const config = getDefaultConfig({
  appName: 'MegaPlace',
  projectId: 'deca5efd6ce631635e677fc6bb3d75ef',
  chains: [megaeth],
  transports: {
    [megaeth.id]: fallback(
      alchemyWsUrl
        ? [
            // Primary: Alchemy WebSocket (supports MegaETH realtime API)
            webSocket(alchemyWsUrl, {
              keepAlive: true,
              reconnect: {
                attempts: 5,
                delay: 1000,
              },
            }),
            // Fallback: HTTP
            http('https://timothy.megaeth.com/rpc', {
              batch: true,
            }),
          ]
        : [
            // If no Alchemy URL: HTTP only
            http('https://timothy.megaeth.com/rpc', {
              batch: true,
            }),
          ]
    ),
  },
  ssr: false,
});
