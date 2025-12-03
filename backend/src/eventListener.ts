import { createPublicClient, http, webSocket, fallback, parseAbiItem } from 'viem';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import MegaplaceABI from './MegaplaceABI.json';

const RPC_URL = process.env.RPC_URL || 'https://timothy.megaeth.com/rpc';
const CONTRACT_ADDRESS = (process.env.CONTRACT_ADDRESS || '0xF7bB0ba31c14ff85c582f2b6F45355abe01dCB07') as `0x${string}`;
const DEPLOYMENT_BLOCK = BigInt(process.env.DEPLOYMENT_BLOCK || '4211820');
const DATA_DIR = process.env.DATA_DIR || './data';

// Save debounce configuration
const SAVE_DEBOUNCE_MS = 5000; // 5 seconds
const SAVE_MAX_WAIT_MS = 30000; // 30 seconds max wait

// Define custom chain for MegaETH
const megaethChain = {
    id: 6343,
    name: 'MegaETH Testnet',
    network: 'megaeth',
    nativeCurrency: {
        decimals: 18,
        name: 'Ether',
        symbol: 'ETH',
    },
    rpcUrls: {
        default: {
            http: ['https://timothy.megaeth.com/rpc'],
            webSocket: ['wss://timothy.megaeth.com/rpc']
        },
        public: {
            http: ['https://timothy.megaeth.com/rpc'],
            webSocket: ['wss://timothy.megaeth.com/rpc']
        },
    },
    testnet: true,
} as const;

export interface PixelData {
    color: number;
    placedBy: string;
    timestamp: number;
    x: number;
    y: number;
}

export interface PixelStorage {
    pixels: Record<string, PixelData>; // key: "x,y"
    lastProcessedBlock: bigint;
    totalPixels: number;
}

export class EventListener {
    private client: ReturnType<typeof createPublicClient>;
    private storage: PixelStorage;
    private storageFile: string;
    private isRunning = false;
    private unwatch?: () => void;

    // Debounced save state
    private saveTimeout: NodeJS.Timeout | null = null;
    private lastSaveTime: number = 0;
    private pendingSave: boolean = false;

    constructor() {
        // Determine if we should use WebSocket or HTTP based on URL
        const isWebSocket = RPC_URL.startsWith('ws://') || RPC_URL.startsWith('wss://');

        // Create transport with fallback (WebSocket primary if available, HTTP fallback)
        const transport = isWebSocket
            ? fallback([
                webSocket(RPC_URL, {
                    keepAlive: true,
                    reconnect: {
                        attempts: 5,
                        delay: 1000,
                    },
                }),
                http(RPC_URL.replace('wss://', 'https://').replace('ws://', 'http://'), {
                    batch: true,
                    retryCount: 5,
                    retryDelay: 1000,
                }),
            ])
            : http(RPC_URL, {
                batch: true,
                retryCount: 5,
                retryDelay: 1000,
            });

        this.client = createPublicClient({
            chain: megaethChain,
            transport,
        });

        this.storageFile = path.join(DATA_DIR, 'pixels.json');
        this.storage = {
            pixels: {},
            lastProcessedBlock: DEPLOYMENT_BLOCK,
            totalPixels: 0,
        };

        console.log(`🔗 Using ${isWebSocket ? 'WebSocket' : 'HTTP'} transport: ${RPC_URL}`);
    }

    /**
     * Load existing pixel data from JSON file
     */
    private async loadStorage(): Promise<void> {
        try {
            if (existsSync(this.storageFile)) {
                const data = await readFile(this.storageFile, 'utf-8');
                const parsed = JSON.parse(data);

                // Convert lastProcessedBlock back to BigInt
                this.storage = {
                    ...parsed,
                    lastProcessedBlock: BigInt(parsed.lastProcessedBlock),
                };

                console.log(`✓ Loaded ${this.storage.totalPixels} pixels from storage`);
                console.log(`  Last processed block: ${this.storage.lastProcessedBlock}`);
            } else {
                console.log('○ No existing storage found, starting fresh');
                await mkdir(DATA_DIR, { recursive: true });
            }
        } catch (error) {
            console.error('✗ Error loading storage:', error);
            throw error;
        }
    }

    /**
     * Save pixel data to JSON file (immediate)
     */
    private async saveStorageImmediate(): Promise<void> {
        try {
            const dataToSave = {
                ...this.storage,
                lastProcessedBlock: this.storage.lastProcessedBlock.toString(),
            };

            await writeFile(this.storageFile, JSON.stringify(dataToSave, null, 2));
            this.lastSaveTime = Date.now();
            this.pendingSave = false;
            console.log(`✓ Saved ${this.storage.totalPixels} pixels to storage`);
        } catch (error) {
            console.error('✗ Error saving storage:', error);
        }
    }

    /**
     * Save pixel data with debouncing
     * - Waits SAVE_DEBOUNCE_MS after last change
     * - But never waits more than SAVE_MAX_WAIT_MS
     */
    private saveStorage(): void {
        this.pendingSave = true;
        const timeSinceLastSave = Date.now() - this.lastSaveTime;

        // Clear any existing timeout
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
        }

        // If we've been waiting too long, save immediately
        if (timeSinceLastSave >= SAVE_MAX_WAIT_MS) {
            this.saveStorageImmediate();
            return;
        }

        // Calculate how long we can still wait
        const maxDelay = Math.min(SAVE_DEBOUNCE_MS, SAVE_MAX_WAIT_MS - timeSinceLastSave);

        this.saveTimeout = setTimeout(() => {
            this.saveStorageImmediate();
        }, maxDelay);
    }

    /**
     * Sleep utility for delays
     */
    private async sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Process a batch of historical events with retry logic
     */
    private async processHistoricalEvents(fromBlock: bigint, toBlock: bigint, retryCount = 0): Promise<void> {
        const MAX_RETRIES = 5;
        const BASE_DELAY = 3000; // 3 seconds

        try {
            const logs = await this.client.getLogs({
                address: CONTRACT_ADDRESS,
                event: parseAbiItem('event PixelPlaced(address indexed user, uint256 x, uint256 y, uint32 color, uint256 timestamp)'),
                fromBlock,
                toBlock,
            });

            if (logs.length > 0) {
                for (const log of logs) {
                    const { args } = log;
                    if (args) {
                        const key = `${args.x},${args.y}`;
                        const pixelData: PixelData = {
                            x: Number(args.x),
                            y: Number(args.y),
                            color: Number(args.color),
                            placedBy: args.user as string,
                            timestamp: Number(args.timestamp),
                        };

                        // Update or add pixel
                        if (!this.storage.pixels[key]) {
                            this.storage.totalPixels++;
                        }
                        this.storage.pixels[key] = pixelData;
                    }
                }
            }

            this.storage.lastProcessedBlock = toBlock;
        } catch (error: any) {
            // Check if it's a rate limit error
            if (error?.code === -32022 || error?.message?.includes('compute unit limit') || error?.message?.includes('rate limit')) {
                if (retryCount < MAX_RETRIES) {
                    const delay = BASE_DELAY * Math.pow(2, retryCount); // Exponential backoff
                    console.log(`⏳ Rate limited, retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
                    await this.sleep(delay);
                    return this.processHistoricalEvents(fromBlock, toBlock, retryCount + 1);
                } else {
                    console.warn(`⚠️ Max retries reached for blocks ${fromBlock}-${toBlock}, skipping`);
                    return;
                }
            }
            console.error('Error processing events:', error);
            throw error;
        }
    }

    /**
     * Sync all historical events from deployment to current block
     */
    public async syncHistoricalEvents(): Promise<void> {
        console.log('📡 Syncing historical events...');

        try {
            const currentBlock = await this.client.getBlockNumber();
            const startBlock = this.storage.lastProcessedBlock + 1n;

            if (startBlock > currentBlock) {
                console.log('✓ Already synced to latest block');
                return;
            }

            const totalBlocks = currentBlock - startBlock + 1n;
            console.log(`  Blocks to process: ${totalBlocks} (${startBlock} → ${currentBlock})`);

            // Process in smaller chunks to avoid RPC rate limits
            const CHUNK_SIZE = 1000n;
            const DELAY_BETWEEN_CHUNKS = 500;
            let fromBlock = startBlock;
            let processedChunks = 0;

            while (fromBlock <= currentBlock) {
                const toBlock = fromBlock + CHUNK_SIZE > currentBlock ? currentBlock : fromBlock + CHUNK_SIZE;

                await this.processHistoricalEvents(fromBlock, toBlock);

                // Use debounced save during sync
                this.saveStorage();

                processedChunks++;
                const progress = ((Number(toBlock - startBlock) / Number(totalBlocks)) * 100).toFixed(1);

                if (processedChunks % 10 === 0) {
                    console.log(`  Progress: ${progress}% (block ${toBlock})`);
                }

                fromBlock = toBlock + 1n;

                if (fromBlock <= currentBlock) {
                    await this.sleep(DELAY_BETWEEN_CHUNKS);
                }
            }

            // Final save after sync
            await this.saveStorageImmediate();
            console.log(`✓ Sync complete. Total pixels: ${this.storage.totalPixels}`);
        } catch (error) {
            console.error('✗ Historical sync failed:', error);
            throw error;
        }
    }

    /**
     * Start watching for new events in real-time
     */
    public async startWatching(): Promise<void> {
        if (this.isRunning) {
            return;
        }

        console.log('👀 Starting real-time event listener...');
        this.isRunning = true;

        // Watch for new PixelPlaced events
        this.unwatch = this.client.watchContractEvent({
            address: CONTRACT_ADDRESS,
            abi: MegaplaceABI,
            eventName: 'PixelPlaced',
            onLogs: (logs) => {
                for (const log of logs) {
                    const { args } = log as any;
                    if (args) {
                        const key = `${args.x},${args.y}`;
                        const pixelData: PixelData = {
                            x: Number(args.x),
                            y: Number(args.y),
                            color: Number(args.color),
                            placedBy: args.user as string,
                            timestamp: Number(args.timestamp),
                        };

                        const isNewPixel = !this.storage.pixels[key];
                        if (isNewPixel) {
                            this.storage.totalPixels++;
                        }

                        this.storage.pixels[key] = pixelData;

                        console.log(`🎨 Pixel at (${args.x}, ${args.y}) by ${(args.user as string).slice(0, 8)}...`);

                        // Use debounced save for real-time events
                        this.saveStorage();
                    }
                }
            },
            onError: (error) => {
                console.error('Watch error:', error);
            },
        });

        console.log('✓ Watching for new pixels...');

        // Auto-save every minute as a safety net
        setInterval(() => {
            if (this.pendingSave) {
                this.saveStorageImmediate();
            }
        }, 60000);
    }

    /**
     * Stop watching for events
     */
    public stopWatching(): void {
        if (this.unwatch) {
            this.unwatch();
            this.isRunning = false;

            // Clear any pending save timeout
            if (this.saveTimeout) {
                clearTimeout(this.saveTimeout);
            }

            // Final save on shutdown
            if (this.pendingSave) {
                this.saveStorageImmediate();
            }

            console.log('○ Stopped watching for events');
        }
    }

    /**
     * Initialize the event listener
     */
    public async initialize(): Promise<void> {
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('     Megaplace Event Listener v1.1');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        console.log(`📋 Contract: ${CONTRACT_ADDRESS}`);
        console.log(`🌐 RPC: ${RPC_URL}\n`);

        await this.loadStorage();
        await this.syncHistoricalEvents();
        await this.startWatching();
    }

    /**
     * Get all pixels
     */
    public getPixels(): Record<string, PixelData> {
        return this.storage.pixels;
    }

    /**
     * Get pixel at specific coordinates
     */
    public getPixel(x: number, y: number): PixelData | null {
        const key = `${x},${y}`;
        return this.storage.pixels[key] || null;
    }

    /**
     * Get storage stats
     */
    public getStats() {
        return {
            totalPixels: this.storage.totalPixels,
            lastProcessedBlock: this.storage.lastProcessedBlock.toString(),
            isWatching: this.isRunning,
        };
    }
}
