import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("Deploying Megaplace contract to MegaETH...");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "ETH");

  // Get network info
  const network = await ethers.provider.getNetwork();
  console.log("Network:", network.name, "Chain ID:", network.chainId.toString());

  const Megaplace = await ethers.getContractFactory("Megaplace");

  console.log("\nDeploying contract...");

  // Deploy with manual gas limit to bypass estimation
  const megaplace = await Megaplace.deploy({
    gasLimit: 600000000  // 600M gas
  });

  console.log("Waiting for deployment...");
  await megaplace.waitForDeployment();

  const contractAddress = await megaplace.getAddress();
  console.log("\n✅ Megaplace contract deployed to:", contractAddress);
  console.log("Contract owner:", await megaplace.owner());

  // Update frontend configuration
  console.log("\nUpdating frontend configuration...");
  await updateFrontendConfig(contractAddress);

  console.log("\nVerification command:");
  console.log(`npx hardhat verify --network megaeth ${contractAddress}`);
}

async function updateFrontendConfig(contractAddress: string) {
  try {
    // Paths
    const artifactPath = path.join(__dirname, "../artifacts/contracts/Megaplace.sol/Megaplace.json");
    const frontendContractsDir = path.join(__dirname, "../../frontend/src/contracts");
    const abiOutputPath = path.join(frontendContractsDir, "MegaplaceABI.json");
    const configPath = path.join(frontendContractsDir, "config.ts");

    // Read the artifact
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

    // Ensure frontend contracts directory exists
    if (!fs.existsSync(frontendContractsDir)) {
      fs.mkdirSync(frontendContractsDir, { recursive: true });
    }

    // Write ABI to frontend
    fs.writeFileSync(abiOutputPath, JSON.stringify(artifact.abi, null, 2));
    console.log("✅ ABI copied to:", abiOutputPath);

    // Update config file
    const configContent = `// Contract addresses
export const MEGAPLACE_ADDRESS = "${contractAddress}" as const;
export const CHATROOM_ADDRESS = "0x8D6a1b047BC7578A284b6f23394D0C1e579daCD2" as const;

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
`;

    fs.writeFileSync(configPath, configContent);
    console.log("✅ Contract address updated in:", configPath);
    console.log("✅ Frontend configuration updated successfully!");

  } catch (error) {
    console.warn("⚠️  Warning: Failed to update frontend config");
    console.warn("   You may need to manually update the contract address");
    console.warn("   Error:", error instanceof Error ? error.message : String(error));
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Deployment failed:");
    console.error(error);
    process.exit(1);
  });
