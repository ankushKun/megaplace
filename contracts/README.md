# Megaplace Smart Contracts

Smart contracts for the MegaETH Megaplace DApp - a decentralized pixel canvas.

## Directory Structure

```
contracts/
├── contracts/         # Solidity source files
│   └── Megaplace.sol # Main pixel canvas contract
├── scripts/          # Deployment and utility scripts
│   └── deploy.ts     # Deployment script with frontend auto-update
├── test/             # Contract tests
├── hardhat.config.ts # Hardhat configuration
├── tsconfig.json     # TypeScript configuration
├── package.json      # Dependencies
└── .env.example      # Environment variables template
```

## Quick Start

### Setup

1. Install dependencies:
```bash
bun install
```

2. Configure environment:
```bash
cp .env.example .env
# Edit .env and add your PRIVATE_KEY
```

### Development

```bash
# Compile contracts
bun run compile

# Run tests
bun run test

# Deploy to MegaETH testnet
bun run deploy

# Deploy to local network
bun run deploy:local

# Clean build artifacts
bun run clean
```

## Smart Contract: Megaplace.sol

A decentralized pixel canvas where users can collaboratively place colored pixels on a shared canvas.

### Key Features

- **Collaborative Canvas**: Users can place pixels on a shared canvas
- **Color Customization**: Each pixel can be set to any 24-bit RGB color
- **Ownership Tracking**: Track who placed each pixel
- **Event Emission**: All pixel placements emit events for off-chain indexing
- **Timestamps**: Each pixel includes placement timestamp

### Core Functions

```solidity
// Place a pixel on the canvas
function placePixel(uint256 x, uint256 y, uint24 color) external

// Get pixel data at specific coordinates
function getPixel(uint256 x, uint256 y) external view returns (Pixel memory)

// Get the entire canvas state
function getCanvas() external view returns (Pixel[][] memory)
```

### Events

```solidity
event PixelPlaced(
    address indexed placer,
    uint256 x,
    uint256 y,
    uint24 color,
    uint256 timestamp
);
```

### Data Structures

```solidity
struct Pixel {
    address placer;
    uint24 color;
    uint256 timestamp;
}
```

## Testing

The test suite includes comprehensive coverage:

- Contract deployment validation
- Pixel placement functionality
- Coordinate validation
- Pixel retrieval
- Multiple user scenarios
- Event emission verification

Run tests:
```bash
bun run test
```

## Deployment

The deployment script automatically:
1. Deploys the Megaplace contract
2. Copies the ABI to `../frontend/src/contracts/MegaplaceABI.json`
3. Updates the contract address in `../frontend/src/contracts/config.ts`
4. Provides the verification command

```bash
bun run deploy
```

After deployment, verify on Blockscout:
```bash
bun run verify <CONTRACT_ADDRESS>
```

## Network Configuration

### MegaETH Testnet

- **Chain ID**: 6343
- **RPC URL**: https://timothy.megaeth.com/rpc
- **Explorer**: https://megaexplorer.xyz
- **Block Explorer**: https://megaeth-testnet-v2.blockscout.com

Configuration is in `hardhat.config.ts`.

## Dependencies

- **Hardhat**: Ethereum development environment
- **Ethers.js**: Ethereum library
- **TypeScript**: Type safety
- **OpenZeppelin**: Secure contract libraries
- **Chai**: Assertion library for testing

## Security Considerations

- Pixels are permanent and can be overwritten by anyone
- No access control - anyone can place pixels
- Consider rate limiting in production versions
- Validate all inputs before calling contract functions
- Canvas dimensions should be reasonable to avoid excessive gas costs

## Gas Optimization

The contract uses:
- Efficient storage for pixel data
- Events for off-chain indexing
- View functions for free reads
- Optimized struct packing for pixel data

For production, consider:
- Canvas size limits
- Rate limiting per address
- Cooldown periods between placements

## License

MIT
