import { createPublicClient, http, webSocket, fallback, parseAbiItem } from 'viem';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import MegaplaceABI from './MegaplaceABI.json';

// All config from .env - no fallbacks
const RPC_URL = process.env.RPC_URL!;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS! as `0x${string}`;
const DEPLOYMENT_BLOCK = BigInt(process.env.DEPLOYMENT_BLOCK!);
const DATA_DIR = process.env.DATA_DIR!;

// Sync configuration from .env
const CHUNK_SIZE = BigInt(process.env.CHUNK_SIZE!);
const PARALLEL_CHUNKS = Number(process.env.PARALLEL_CHUNKS!);
const DELAY_BETWEEN_BATCHES = Number(process.env.DELAY_BETWEEN_BATCHES!);

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

// Callback type for new pixel events
export type PixelCallback = (pixel: PixelData) => void;

export class EventListener {
    private client: ReturnType<typeof createPublicClient>;
    private storage: PixelStorage;
    private storageFile: string;
    private isRunning = false;
    private unwatch?: () => void;
    private isSyncing = false;
    private syncProgress = 0;

    // Debounced save state
    private saveTimeout: NodeJS.Timeout | null = null;
    private lastSaveTime: number = 0;
    private pendingSave: boolean = false;

    // Callbacks for real-time updates (SSE)
    private pixelCallbacks: Set<PixelCallback> = new Set();

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
     * Register a callback for new pixel events (for SSE)
     */
    public onPixel(callback: PixelCallback): () => void {
        this.pixelCallbacks.add(callback);
        return () => this.pixelCallbacks.delete(callback);
    }

    /**
     * Notify all registered callbacks of a new pixel
     */
    private notifyPixel(pixel: PixelData): void {
        for (const callback of this.pixelCallbacks) {
            try {
                callback(pixel);
            } catch (err) {
                console.error('Error in pixel callback:', err);
            }
        }
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
     */
    private saveStorage(): void {
        this.pendingSave = true;
        const timeSinceLastSave = Date.now() - this.lastSaveTime;

        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
        }

        if (timeSinceLastSave >= SAVE_MAX_WAIT_MS) {
            this.saveStorageImmediate();
            return;
        }

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
    private async processHistoricalEvents(fromBlock: bigint, toBlock: bigint, retryCount = 0): Promise<PixelData[]> {
        const MAX_RETRIES = 5;
        const BASE_DELAY = 3000;

        try {
            const logs = await this.client.getLogs({
                address: CONTRACT_ADDRESS,
                event: parseAbiItem('event PixelPlaced(address indexed user, uint256 x, uint256 y, uint32 color, uint256 timestamp)'),
                fromBlock,
                toBlock,
            });

            const pixels: PixelData[] = [];

            if (logs.length > 0) {
                for (const log of logs) {
                    const { args } = log;
                    if (args) {
                        const key = `${args.x},${args.y}`;
                        const color = Number(args.color);
                        const pixelData: PixelData = {
                            x: Number(args.x),
                            y: Number(args.y),
                            color,
                            placedBy: args.user as string,
                            timestamp: Number(args.timestamp),
                        };

                        // Color 0 means erase/transparent - remove the pixel from storage
                        if (color === 0) {
                            if (this.storage.pixels[key]) {
                                delete this.storage.pixels[key];
                                this.storage.totalPixels--;
                            }
                        } else {
                            if (!this.storage.pixels[key]) {
                                this.storage.totalPixels++;
                            }
                            this.storage.pixels[key] = pixelData;
                        }
                        pixels.push(pixelData);
                    }
                }
            }

            return pixels;
        } catch (error: any) {
            if (error?.code === -32022 || error?.message?.includes('compute unit limit') || error?.message?.includes('rate limit')) {
                if (retryCount < MAX_RETRIES) {
                    const delay = BASE_DELAY * Math.pow(2, retryCount);
                    console.log(`⏳ Rate limited, retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
                    await this.sleep(delay);
                    return this.processHistoricalEvents(fromBlock, toBlock, retryCount + 1);
                } else {
                    console.warn(`⚠️ Max retries reached for blocks ${fromBlock}-${toBlock}, skipping`);
                    return [];
                }
            }
            console.error('Error processing events:', error);
            throw error;
        }
    }

    /**
     * Process multiple chunk ranges in parallel
     */
    private async processChunksParallel(chunks: Array<{ from: bigint; to: bigint }>): Promise<void> {
        const results = await Promise.allSettled(
            chunks.map(chunk => this.processHistoricalEvents(chunk.from, chunk.to))
        );

        for (const result of results) {
            if (result.status === 'rejected') {
                console.error('Chunk processing failed:', result.reason);
            }
        }

        // Update last processed block to the highest processed
        const maxBlock = chunks.reduce((max, chunk) => chunk.to > max ? chunk.to : max, 0n);
        if (maxBlock > this.storage.lastProcessedBlock) {
            this.storage.lastProcessedBlock = maxBlock;
        }
    }

    /**
     * Sync all historical events from deployment to current block
     * Uses parallel processing for faster sync
     */
    public async syncHistoricalEvents(): Promise<void> {
        console.log('📡 Syncing historical events...');
        this.isSyncing = true;
        this.syncProgress = 0;

        try {
            const currentBlock = await this.client.getBlockNumber();
            const startBlock = this.storage.lastProcessedBlock + 1n;

            if (startBlock > currentBlock) {
                console.log('✓ Already synced to latest block');
                this.isSyncing = false;
                this.syncProgress = 100;
                return;
            }

            const totalBlocks = currentBlock - startBlock + 1n;
            console.log(`  Blocks to process: ${totalBlocks} (${startBlock} → ${currentBlock})`);
            console.log(`  Using ${PARALLEL_CHUNKS} parallel workers with ${CHUNK_SIZE} blocks per chunk`);

            let fromBlock = startBlock;
            let processedBlocks = 0n;

            while (fromBlock <= currentBlock) {
                // Build array of chunks to process in parallel
                const chunks: Array<{ from: bigint; to: bigint }> = [];

                for (let i = 0; i < PARALLEL_CHUNKS && fromBlock <= currentBlock; i++) {
                    const toBlock = fromBlock + CHUNK_SIZE > currentBlock ? currentBlock : fromBlock + CHUNK_SIZE - 1n;
                    chunks.push({ from: fromBlock, to: toBlock });
                    fromBlock = toBlock + 1n;
                }

                // Process chunks in parallel
                await this.processChunksParallel(chunks);

                // Update progress
                processedBlocks = this.storage.lastProcessedBlock - startBlock + 1n;
                this.syncProgress = Math.min(100, Math.round((Number(processedBlocks) / Number(totalBlocks)) * 100));

                // Debounced save
                this.saveStorage();

                // Log progress periodically
                if (this.syncProgress % 10 === 0 || this.syncProgress === 100) {
                    console.log(`  Progress: ${this.syncProgress}% (block ${this.storage.lastProcessedBlock}, ${this.storage.totalPixels} pixels)`);
                }

                // Small delay between batches to avoid overwhelming RPC
                if (fromBlock <= currentBlock) {
                    await this.sleep(DELAY_BETWEEN_BATCHES);
                }
            }

            // Final save after sync
            await this.saveStorageImmediate();
            this.isSyncing = false;
            this.syncProgress = 100;
            console.log(`✓ Sync complete. Total pixels: ${this.storage.totalPixels}`);
        } catch (error) {
            this.isSyncing = false;
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

        this.unwatch = this.client.watchContractEvent({
            address: CONTRACT_ADDRESS,
            abi: MegaplaceABI,
            eventName: 'PixelPlaced',
            onLogs: (logs) => {
                for (const log of logs) {
                    const { args } = log as any;
                    if (args) {
                        const key = `${args.x},${args.y}`;
                        const color = Number(args.color);
                        const pixelData: PixelData = {
                            x: Number(args.x),
                            y: Number(args.y),
                            color,
                            placedBy: args.user as string,
                            timestamp: Number(args.timestamp),
                        };

                        // Color 0 means erase/transparent - remove the pixel from storage
                        if (color === 0) {
                            if (this.storage.pixels[key]) {
                                delete this.storage.pixels[key];
                                this.storage.totalPixels--;
                            }
                            console.log(`🧹 Pixel erased at (${args.x}, ${args.y}) by ${(args.user as string).slice(0, 8)}...`);
                        } else {
                            const isNewPixel = !this.storage.pixels[key];
                            if (isNewPixel) {
                                this.storage.totalPixels++;
                            }
                            this.storage.pixels[key] = pixelData;
                            console.log(`🎨 Pixel at (${args.x}, ${args.y}) by ${(args.user as string).slice(0, 8)}...`);
                        }

                        // Notify SSE clients (they need to know about erases too)
                        this.notifyPixel(pixelData);

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

            if (this.saveTimeout) {
                clearTimeout(this.saveTimeout);
            }

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
        console.log('     Megaplace Event Listener v1.2');
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
     * Get pixels as array (sorted by timestamp, newest first)
     */
    public getPixelsArray(limit?: number, offset?: number): PixelData[] {
        const pixelsArray = Object.values(this.storage.pixels)
            .sort((a, b) => b.timestamp - a.timestamp);

        if (limit !== undefined && offset !== undefined) {
            return pixelsArray.slice(offset, offset + limit);
        }
        if (limit !== undefined) {
            return pixelsArray.slice(0, limit);
        }
        return pixelsArray;
    }

    /**
     * Get pixel at specific coordinates
     */
    public getPixel(x: number, y: number): PixelData | null {
        const key = `${x},${y}`;
        return this.storage.pixels[key] || null;
    }

    /**
     * Get pixels in a region
     */
    public getRegion(startX: number, startY: number, width: number, height: number): PixelData[] {
        const pixels: PixelData[] = [];

        for (let y = startY; y < startY + height; y++) {
            for (let x = startX; x < startX + width; x++) {
                const key = `${x},${y}`;
                if (this.storage.pixels[key]) {
                    pixels.push(this.storage.pixels[key]);
                }
            }
        }

        return pixels;
    }

    /**
     * Get storage stats
     */
    public getStats() {
        return {
            totalPixels: this.storage.totalPixels,
            lastProcessedBlock: this.storage.lastProcessedBlock.toString(),
            isWatching: this.isRunning,
            isSyncing: this.isSyncing,
            syncProgress: this.syncProgress,
            connectedClients: this.pixelCallbacks.size,
        };
    }

    /**
     * Get pixels as compact binary buffer
     * Format: [x (4 bytes), y (4 bytes), color (4 bytes)] per pixel = 12 bytes each
     * Much more efficient than JSON for large datasets
     */
    public getPixelsBinary(): Buffer {
        const pixels = Object.values(this.storage.pixels);
        const buffer = Buffer.alloc(pixels.length * 12);

        let offset = 0;
        for (const pixel of pixels) {
            buffer.writeUInt32LE(pixel.x, offset);
            buffer.writeUInt32LE(pixel.y, offset + 4);
            buffer.writeUInt32LE(pixel.color, offset + 8);
            offset += 12;
        }

        return buffer;
    }
}
