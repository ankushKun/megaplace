// Backend API service for fetching pixel data
import { DEFAULT_BACKEND_URL, BACKEND_HEALTH_TIMEOUT_MS } from '../constants';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || DEFAULT_BACKEND_URL;

export interface BackendPixelData {
    x: number;
    y: number;
    color: number;
    placedBy: string;
    timestamp: number;
}

export interface BackendResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
}

export interface PixelsResponse {
    success: boolean;
    count: number;
    pixels: BackendPixelData[];
}

export interface PixelResponse {
    success: boolean;
    pixel: BackendPixelData;
}

export interface StatsResponse {
    success: boolean;
    totalPixels: number;
    lastProcessedBlock: string;
    isWatching: boolean;
}

export interface RegionResponse {
    success: boolean;
    count: number;
    pixels: BackendPixelData[];
}

/**
 * Fetch all pixels from backend
 */
export async function fetchAllPixels(): Promise<BackendPixelData[]> {
    try {
        const response = await fetch(`${BACKEND_URL}/api/pixels`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data: PixelsResponse = await response.json();
        return data.pixels || [];
    } catch (error) {
        console.error('Failed to fetch pixels from backend:', error);
        return [];
    }
}

/**
 * Fetch a specific pixel from backend
 */
export async function fetchPixel(x: number, y: number): Promise<BackendPixelData | null> {
    try {
        const response = await fetch(`${BACKEND_URL}/api/pixels/${x}/${y}`);
        if (!response.ok) {
            if (response.status === 404) return null;
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data: PixelResponse = await response.json();
        return data.pixel;
    } catch (error) {
        console.error(`Failed to fetch pixel (${x}, ${y}) from backend:`, error);
        return null;
    }
}

/**
 * Fetch pixels in a region from backend
 */
export async function fetchRegion(
    startX: number,
    startY: number,
    width: number,
    height: number
): Promise<BackendPixelData[]> {
    try {
        const response = await fetch(
            `${BACKEND_URL}/api/pixels/region/${startX}/${startY}/${width}/${height}`
        );
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data: RegionResponse = await response.json();
        return data.pixels || [];
    } catch (error) {
        console.error(`Failed to fetch region from backend:`, error);
        return [];
    }
}

/**
 * Fetch stats from backend
 */
export async function fetchStats(): Promise<StatsResponse | null> {
    try {
        const response = await fetch(`${BACKEND_URL}/api/stats`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data: StatsResponse = await response.json();
        return data;
    } catch (error) {
        console.error('Failed to fetch stats from backend:', error);
        return null;
    }
}

/**
 * Check if backend is available
 */
export async function checkBackendHealth(): Promise<boolean> {
    try {
        const response = await fetch(`${BACKEND_URL}/health`, {
            method: 'GET',
            signal: AbortSignal.timeout(BACKEND_HEALTH_TIMEOUT_MS),
        });
        return response.ok;
    } catch (error) {
        console.warn('Backend is not available:', error);
        return false;
    }
}
