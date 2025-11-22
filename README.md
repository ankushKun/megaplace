# MegaETH ChatRoom DApp

A full-stack decentralized chat application built on the MegaETH Testnet. This monorepo contains both the Solidity smart contracts and a React-based frontend for interacting with the blockchain.

## Project Structure

```
megaeth-chatroom/
├── contracts/              # Smart contract workspace
│   ├── contracts/         # Solidity source files
│   │   └── ChatRoom.sol  # Main chat contract
│   ├── scripts/          # Deployment scripts
│   │   └── deploy.ts     # Auto-updates frontend config
│   ├── test/             # Contract tests (Hardhat)
│   │   └── ChatRoom.test.ts
│   ├── hardhat.config.ts # Hardhat configuration
│   ├── tsconfig.json     # TypeScript config for contracts
│   ├── package.json      # Contract workspace dependencies
│   └── .env.example      # Environment variables template
│
├── frontend/             # React frontend workspace
│   ├── src/
│   │   ├── App.tsx       # Main application
│   │   ├── components/   # React components
│   │   ├── hooks/        # Custom Web3 hooks
│   │   └── contracts/    # Auto-generated from deployment
│   │       ├── config.ts       # Contract address & network
│   │       └── ChatRoomABI.json # Contract ABI
│   ├── package.json      # Frontend dependencies
│   └── vite.config.ts    # Vite build configuration
│
├── package.json          # Root workspace orchestration
└── README.md            # This file
```

## Technology Stack

### Smart Contracts
- **Solidity** 0.8.30 - Smart contract language
- **Hardhat** 2.19.0 - Development framework
- **OpenZeppelin** 5.0.0 - Contract standards
- **TypeScript** - Type-safe scripting
- **Mocha + Chai** - Testing framework

### Frontend
- **React** 18.3.1 - UI framework
- **TypeScript** 5.9.3 - Type safety
- **Vite** 7.2.4 - Build tool
- **Wagmi** 3.0.1 - React hooks for Web3
- **Viem** 2.39.3 - Ethereum utilities
- **React Query** - Data fetching & caching

### Network
- **MegaETH Testnet** (Chain ID: 6343)
- **RPC**: https://timothy.megaeth.com/rpc
- **Explorer**: https://megaexplorer.xyz

## Quick Start

### Prerequisites
- **Bun** (recommended) or Node.js v18+
- MetaMask or compatible Web3 wallet
- MegaETH testnet ETH (for deployment)

### Installation

```bash
# Install all dependencies (root + contracts + frontend)
bun install

# Or install individually
cd contracts && bun install
cd ../frontend && bun install
```

### Environment Setup

1. Create environment file in contracts directory:
```bash
cd contracts
cp .env.example .env
```

2. Edit `.env` and add your private key:
```env
PRIVATE_KEY=your_private_key_here
```

> ⚠️ **Never commit your `.env` file!** It's already in `.gitignore`

## Development Workflow

### Option 1: Using Root Scripts (Recommended)

All commands run from the project root:

```bash
# Compile contracts
bun run contracts:compile

# Run contract tests
bun run contracts:test

# Deploy to MegaETH (auto-updates frontend config)
bun run contracts:deploy

# Start frontend dev server
bun run dev
# or
bun run frontend:dev

# Build everything (contracts + frontend)
bun run build

# Clean build artifacts
bun run clean
```

### Option 2: Direct Workspace Commands

#### Smart Contracts (in `/contracts`)

```bash
cd contracts

# Compile contracts
bun run compile

# Run tests
bun run test

# Deploy to MegaETH testnet
bun run deploy

# Deploy to local Hardhat network
bun run deploy:local

# Verify contract on explorer
bun run verify

# Clean artifacts
bun run clean
```

#### Frontend (in `/frontend`)

```bash
cd frontend

# Start development server
bun run dev

# Build for production
bun run build

# Preview production build
bun run preview
```

## Deployment Process

The deployment script automatically handles frontend configuration:

1. **Compile Contracts**
   ```bash
   bun run contracts:compile
   ```

2. **Deploy to MegaETH**
   ```bash
   bun run contracts:deploy
   ```

   This will:
   - Deploy the ChatRoom contract
   - Copy the ABI to `frontend/src/contracts/ChatRoomABI.json`
   - Update the contract address in `frontend/src/contracts/config.ts`
   - Display the verification command

3. **Start Frontend**
   ```bash
   bun run dev
   ```

### One-Command Deploy & Run

```bash
# From root: compile, deploy, and update frontend config
bun run deploy

# Then start the dev server
bun run dev
```

## Smart Contract Features

### ChatRoom.sol

**Core Functions:**
- `sendMessage(string memory content)` - Send a message (1-500 characters)
- `getAllMessages()` - Retrieve all chat messages
- `getMessage(uint256 index)` - Get specific message
- `getMessageCount()` - Get total message count
- `getRecentMessages(uint256 count)` - Get latest N messages
- `getMessagesBySender(address sender)` - Filter messages by sender

**Events:**
- `MessageSent(address indexed sender, string content, uint256 timestamp, uint256 messageIndex)`

**Constraints:**
- Message length: 1-500 characters
- Permissionless (anyone can send messages)
- Permanent storage (messages cannot be deleted)

## Frontend Features

- **Wallet Connection** - MetaMask integration via Wagmi
- **Real-time Updates** - WebSocket event listeners
- **Message History** - Scrollable chat interface
- **Transaction Status** - Live deployment feedback
- **User Highlighting** - Distinguish your own messages
- **Character Counter** - 500 character limit validation

## Testing

```bash
# Run all contract tests
bun run test

# Run tests with gas reporting
cd contracts
bun run test
```

**Test Coverage:**
- Contract deployment
- Message sending & validation
- Message retrieval (all, by index, by sender)
- Edge cases (empty messages, length limits)
- Multiple users
- Event emission

## Network Configuration

### MegaETH Testnet

- **Chain ID**: 6343
- **RPC URL**: https://timothy.megaeth.com/rpc
- **WebSocket**: wss://timothy.megaeth.com/rpc
- **Explorer**: https://megaexplorer.xyz
- **Block Explorer**: https://megaeth-testnet-v2.blockscout.com

### Add to MetaMask

1. Open MetaMask
2. Click network dropdown → Add Network
3. Enter:
   - Network Name: `MegaETH Testnet`
   - RPC URL: `https://timothy.megaeth.com/rpc`
   - Chain ID: `6343`
   - Symbol: `ETH`
   - Explorer: `https://megaexplorer.xyz`

## Troubleshooting

### Common Issues

**"PRIVATE_KEY not found"**
- Create a `.env` file in the `contracts/` directory
- Add your private key (without `0x` prefix)

**"Insufficient funds"**
- Get testnet ETH from the MegaETH faucet
- Check your balance on the explorer

**"Contract not deployed"**
- Run `bun run contracts:deploy` first
- Check that `frontend/src/contracts/config.ts` has the correct address

**"Wrong network"**
- Ensure MetaMask is connected to MegaETH Testnet (Chain ID: 6343)
- Check network configuration in MetaMask

**Build errors**
- Clear artifacts: `bun run clean`
- Reinstall dependencies: `rm -rf node_modules && bun install`

## Scripts Reference

### Root Package Scripts

| Command | Description |
|---------|-------------|
| `bun run contracts:compile` | Compile smart contracts |
| `bun run contracts:test` | Run contract tests |
| `bun run contracts:deploy` | Deploy to MegaETH + update frontend |
| `bun run contracts:verify` | Verify contract on explorer |
| `bun run frontend:dev` | Start frontend dev server |
| `bun run frontend:build` | Build frontend for production |
| `bun run dev` | Start frontend (alias) |
| `bun run build` | Build contracts + frontend |
| `bun run deploy` | Compile + deploy contracts |
| `bun run test` | Run contract tests |
| `bun run clean` | Clean all build artifacts |

## Project Highlights

- **Monorepo Structure** - Organized workspace management
- **Auto-Configuration** - Deployment script updates frontend automatically
- **Type Safety** - Full TypeScript support across the stack
- **Modern Tooling** - Vite, Wagmi, React Query
- **Comprehensive Testing** - Full contract test coverage
- **Real-time Updates** - WebSocket event subscriptions
- **Developer Experience** - Hot reload, fast builds, clear error messages

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see LICENSE file for details

## Support

For issues and questions:
- Check the [Troubleshooting](#troubleshooting) section
- Review MegaETH documentation
- Open an issue on GitHub

---

Built with ❤️ for the MegaETH ecosystem
