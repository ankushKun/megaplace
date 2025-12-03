import 'dotenv/config'; // Must be first import to load env vars before other modules
import { createApp } from './app.js';
import { EventListener } from './eventListener.js';

const PORT = process.env.PORT!;

async function main() {
    try {
        // Initialize event listener
        const eventListener = new EventListener();

        // Start API server immediately
        const app = createApp(eventListener);

        app.listen(PORT, () => {
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log(`  🚀 API Server listening on port ${PORT}`);
            console.log(`  📍 http://localhost:${PORT}`);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            console.log('Endpoints:');
            console.log(`  GET  /health                    - Health check & stats`);
            console.log(`  GET  /stats                     - Sync stats`);
            console.log(`  GET  /pixels                    - All pixels (JSON, paginated)`);
            console.log(`  GET  /pixels?limit=N&offset=M   - Paginated pixels`);
            console.log(`  GET  /pixels/binary             - All pixels (binary, 12 bytes/pixel)`);
            console.log(`  GET  /pixels/stream             - SSE real-time pixel updates`);
            console.log(`  GET  /pixels/:x/:y              - Single pixel`);
            console.log(`  GET  /pixels/region/:x/:y/:w/:h - Region of pixels`);
            console.log();
        });

        // Initialize event listener in background (load storage, sync, watch)
        eventListener.initialize().catch(err => {
            console.error('Failed to initialize event listener:', err);
        });

        // Graceful shutdown
        const shutdown = async () => {
            console.log('\n\n=== Shutting down gracefully ===');
            eventListener.stopWatching();
            process.exit(0);
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

main();
