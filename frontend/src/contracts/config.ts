export const CHATROOM_ADDRESS = "0xA5867068403404Af2A91956CB48731968c927a78" as const;

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
