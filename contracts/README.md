# ChatRoom Smart Contracts

Smart contracts for the MegaETH ChatRoom DApp.

## Directory Structure

```
contracts/
├── contracts/         # Solidity source files
│   └── ChatRoom.sol  # Main chat room contract
├── scripts/          # Deployment and utility scripts
│   └── deploy.ts     # Deployment script with frontend auto-update
├── test/             # Contract tests
│   └── ChatRoom.test.ts
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

## Smart Contract: ChatRoom.sol

A permissionless on-chain chat room that allows anyone to send and read messages.

### Key Features

- **Public Messaging**: Anyone can send messages
- **Message History**: Query all messages or filter by sender
- **Event Emission**: All messages emit events for off-chain indexing
- **Validation**: Enforces 1-500 character message length
- **Timestamps**: Each message includes block timestamp

### Core Functions

```solidity
// Send a message to the chat room
function sendMessage(string memory content) external

// Get all messages in the chat
function getAllMessages() external view returns (Message[] memory)

// Get a specific message by index
function getMessage(uint256 index) external view returns (address sender, string memory content, uint256 timestamp)

// Get the latest N messages
function getRecentMessages(uint256 count) external view returns (Message[] memory)

// Get all messages from a specific sender
function getMessagesBySender(address sender) external view returns (Message[] memory)

// Get total message count
function getMessageCount() external view returns (uint256)
```

### Events

```solidity
event MessageSent(
    address indexed sender,
    string content,
    uint256 timestamp,
    uint256 messageIndex
);
```

### Data Structures

```solidity
struct Message {
    address sender;
    string content;
    uint256 timestamp;
}
```

## Testing

The test suite includes comprehensive coverage:

- Contract deployment validation
- Message sending and validation
- Message length constraints
- Empty message rejection
- Message retrieval (all, by index, by sender, recent)
- Multiple user scenarios
- Event emission verification

Run tests:
```bash
bun run test
```

## Deployment

The deployment script automatically:
1. Deploys the ChatRoom contract
2. Copies the ABI to `../frontend/src/contracts/ChatRoomABI.json`
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

- Messages are permanent and cannot be deleted
- No access control - anyone can send messages
- No profanity filtering or content moderation
- Consider rate limiting in production versions
- Validate all inputs before calling contract functions

## Gas Optimization

The contract uses:
- Storage arrays for message history
- Events for off-chain indexing
- View functions for free reads
- Efficient struct packing

For production, consider:
- Pagination limits
- IPFS storage for large messages
- Merkle tree verification for message history

## License

MIT
