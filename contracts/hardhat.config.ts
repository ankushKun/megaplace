import { HardhatUserConfig } from "hardhat/config.js";
import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";

// Validate environment variables
if (!process.env.PRIVATE_KEY && process.argv.includes('--network') && process.argv.includes('megaeth')) {
  console.warn('⚠️  Warning: PRIVATE_KEY not found in environment variables.');
  console.warn('   Deployment to megaeth network will fail.');
  console.warn('   Please create a .env file with PRIVATE_KEY=your_private_key');
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.30",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: {
      chainId: 6343
    },
    megaeth: {
      url: "https://timothy.megaeth.com/rpc",
      chainId: 6343,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gas: "auto",
      gasPrice: "auto",
      blockGasLimit: 10000000000  // 10B gas - MegaETH's max block size is 2 Giga gas
    }
  },
  mocha: {
    timeout: 40000
  },
  etherscan: {
    apiKey: {
      megaeth: "no-api-key-needed"
    },
    customChains: [
      {
        network: "megaeth",
        chainId: 6343,
        urls: {
          apiURL: "https://megaeth-testnet-v2.blockscout.com/api",
          browserURL: "https://megaeth-testnet-v2.blockscout.com"
        }
      }
    ]
  }
};

export default config;
