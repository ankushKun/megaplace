import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import compression from 'compression';
import { EventListener, PixelData } from './eventListener.js';

// Validation helpers (lightweight alternative to zod for simple cases)
function isValidCoordinate(value: unknown): value is number {
    const num = Number(value);
    return !isNaN(num) && Number.isInteger(num) && num >= 0 && num < 1048576;
}

function isValidDimension(value: unknown, max: number = 1000): value is number {
    const num = Number(value);
    return !isNaN(num) && Number.isInteger(num) && num > 0 && num <= max;
}

// Error response helper
function errorResponse(res: Response, status: number, message: string) {
    return res.status(status).json({
        success: false,
        error: message,
    });
}

export function createApp(eventListener: EventListener) {
    const app = express();

    // Middleware
    app.use(cors());
    app.use(compression());
    app.use(express.json());

    // Request logging middleware (optional, useful for debugging)
    app.use((req: Request, res: Response, next: NextFunction) => {
        const start = Date.now();
        res.on('finish', () => {
            const duration = Date.now() - start;
            if (duration > 100) { // Only log slow requests
                console.log(`[${req.method}] ${req.path} - ${res.statusCode} (${duration}ms)`);
            }
        });
        next();
    });

    // Health check
    app.get('/health', (req: Request, res: Response) => {
        const stats = eventListener.getStats();
        const memoryUsage = process.memoryUsage();

        res.json({
            status: stats.isWatching ? 'healthy' : 'degraded',
            uptime: process.uptime(),
            memory: {
                heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + 'MB',
                heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + 'MB',
                rss: Math.round(memoryUsage.rss / 1024 / 1024) + 'MB',
            },
            ...stats,
        });
    });

    // Get all pixels
    app.get('/api/pixels', (req: Request, res: Response) => {
        try {
            const pixels = eventListener.getPixels();
            const pixelArray = Object.values(pixels);

            // Add cache header - data is relatively static
            res.set('Cache-Control', 'public, max-age=5');

            res.json({
                success: true,
                count: pixelArray.length,
                pixels: pixelArray,
            });
        } catch (error) {
            console.error('Error fetching pixels:', error);
            return errorResponse(res, 500, 'Failed to fetch pixels');
        }
    });

    // Get pixel at specific coordinates
    app.get('/api/pixels/:x/:y', (req: Request, res: Response) => {
        try {
            const x = parseInt(req.params.x);
            const y = parseInt(req.params.y);

            if (!isValidCoordinate(x) || !isValidCoordinate(y)) {
                return errorResponse(res, 400, 'Invalid coordinates. Must be integers between 0 and 1048575.');
            }

            const pixel = eventListener.getPixel(x, y);

            if (!pixel) {
                return errorResponse(res, 404, 'Pixel not found');
            }

            // Add cache header
            res.set('Cache-Control', 'public, max-age=2');

            res.json({
                success: true,
                pixel,
            });
        } catch (error) {
            console.error('Error fetching pixel:', error);
            return errorResponse(res, 500, 'Failed to fetch pixel');
        }
    });

    // Get pixels in a region
    app.get('/api/pixels/region/:startX/:startY/:width/:height', (req: Request, res: Response) => {
        try {
            const startX = parseInt(req.params.startX);
            const startY = parseInt(req.params.startY);
            const width = parseInt(req.params.width);
            const height = parseInt(req.params.height);

            // Validate coordinates
            if (!isValidCoordinate(startX) || !isValidCoordinate(startY)) {
                return errorResponse(res, 400, 'Invalid start coordinates. Must be integers between 0 and 1048575.');
            }

            // Validate dimensions
            if (!isValidDimension(width, 1000) || !isValidDimension(height, 1000)) {
                return errorResponse(res, 400, 'Invalid dimensions. Must be integers between 1 and 1000.');
            }

            // Check total size
            if (width * height > 10000) {
                return errorResponse(res, 400, 'Region too large. Maximum 10,000 pixels (e.g., 100x100).');
            }

            const pixels: PixelData[] = [];
            const allPixels = eventListener.getPixels();

            // Find pixels in the specified region
            for (let y = startY; y < startY + height; y++) {
                for (let x = startX; x < startX + width; x++) {
                    const key = `${x},${y}`;
                    if (allPixels[key]) {
                        pixels.push(allPixels[key]);
                    }
                }
            }

            // Add cache header
            res.set('Cache-Control', 'public, max-age=5');

            res.json({
                success: true,
                count: pixels.length,
                pixels,
            });
        } catch (error) {
            console.error('Error fetching region:', error);
            return errorResponse(res, 500, 'Failed to fetch region');
        }
    });

    // Get stats
    app.get('/api/stats', (req: Request, res: Response) => {
        try {
            const stats = eventListener.getStats();

            // Add cache header
            res.set('Cache-Control', 'public, max-age=10');

            res.json({
                success: true,
                ...stats,
            });
        } catch (error) {
            console.error('Error fetching stats:', error);
            return errorResponse(res, 500, 'Failed to fetch stats');
        }
    });

    // 404 handler
    app.use((req: Request, res: Response) => {
        return errorResponse(res, 404, 'Endpoint not found');
    });

    // Global error handler
    app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
        console.error('Unhandled error:', err);
        return errorResponse(res, 500, 'Internal server error');
    });

    return app;
}
