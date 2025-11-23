// Contract addresses
export const MEGAPLACE_ADDRESS = "0x8777D01C37a59f26bA9739F1b723A24A3A732696" as const;

export const MEGAETH_CHAIN = {
  id: 6343,
  name: "MegaETH Testnet",
  network: "megaeth",
  nativeCurrency: {
    decimals: 18,
    name: "Ether",
    symbol: "ETH",
  },
  rpcUrls: {
    default: {
      http: ["https://timothy.megaeth.com/rpc"],
      webSocket: ["wss://timothy.megaeth.com/rpc"],
    },
    public: {
      http: ["https://timothy.megaeth.com/rpc"],
      webSocket: ["wss://timothy.megaeth.com/rpc"],
    },
  },
  blockExplorers: {
    default: {
      name: "MegaExplorer",
      url: "https://megaexplorer.xyz",
    },
  },
  testnet: true,
} as const;
