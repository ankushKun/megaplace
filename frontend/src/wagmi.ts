import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { http, webSocket, fallback } from 'wagmi';
import { megaethChain } from './contracts/config';

// Get Alchemy WebSocket URL from environment variable
const alchemyWsUrl = import.meta.env.VITE_ALCHEMY_WS_URL;

if (!alchemyWsUrl) {
  console.warn('VITE_ALCHEMY_WS_URL not set. Please add it to your .env file for WebSocket support.');
}

export const config = getDefaultConfig({
  appName: 'MegaPlace',
  projectId: 'deca5efd6ce631635e677fc6bb3d75ef',
  chains: [megaethChain],
  transports: {
    [megaethChain.id]: fallback(
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

// Re-export the chain for convenience
export { megaethChain };
