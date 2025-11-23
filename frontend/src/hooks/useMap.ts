import { useState, useCallback, useRef, useEffect } from 'react';
import { usePublicClient } from 'wagmi';
import { MEGAPLACE_ADDRESS } from '../contracts/config';
import MegaplaceABI from '../contracts/MegaplaceABI.json';
import { uint32ToRgb, type PixelPlacedEvent } from './useMegaplace';
import type { Map as LeafletMap } from 'leaflet';
import {
    CANVAS_RES,
    TILE_SIZE,
    latLonToGlobalPx,
    globalPxToLatLon,
    getTilesInBounds,
} from '../lib/projection';

interface UseMapState {
    selectedPixel: { px: number; py: number } | null;
    hoveredPixel: { px: number; py: number } | null;
}

const CACHE_KEY = 'megaplace_pixels_cache';
const CACHE_VERSION = 'v1';
const CACHE_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

interface CachedData {
    version: string;
    timestamp: number;
    pixels: Array<[string, number]>; // [key, color]
}

export function useMap() {
    const mapRef = useRef<LeafletMap | null>(null);
    const publicClient = usePublicClient();
    const [state, setState] = useState<UseMapState>({
        selectedPixel: null,
        hoveredPixel: null,
    });
    const [isLoadingTiles, setIsLoadingTiles] = useState(false);
    const [placedPixelCount, setPlacedPixelCount] = useState(0);
    const [isLoadingFromCache, setIsLoadingFromCache] = useState(true);

    // Store pixel colors in a map for efficient updates
    // Key: "px,py", Value: color
    const pixelDataRef = useRef<Map<string, number>>(new Map());
    const loadedTilesRef = useRef<Set<string>>(new Set());
    const markersRef = useRef<Map<string, L.Rectangle | L.CircleMarker>>(new Map());
    const pendingTilesRef = useRef<Set<string>>(new Set());
    const batchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const hoverHighlightRef = useRef<L.Rectangle | null>(null);
    const selectedHighlightRef = useRef<L.Rectangle | null>(null);

    // Load from cache on mount
    useEffect(() => {
        try {
            const cached = localStorage.getItem(CACHE_KEY);
            if (cached) {
                const data: CachedData = JSON.parse(cached);
                const now = Date.now();

                // Check if cache is valid
                if (data.version === CACHE_VERSION && (now - data.timestamp) < CACHE_EXPIRY) {
                    console.log(`Loading ${data.pixels.length} pixels from cache...`);

                    // Restore pixels from cache
                    data.pixels.forEach(([key, color]) => {
                        pixelDataRef.current.set(key, color);

                        // Create markers for cached pixels
                        const [pxStr, pyStr] = key.split(',');
                        const px = parseInt(pxStr, 10);
                        const py = parseInt(pyStr, 10);
                        if (!isNaN(px) && !isNaN(py)) {
                            updateMarker(px, py, color);
                        }
                    });

                    setPlacedPixelCount(pixelDataRef.current.size);
                    console.log('Cache loaded successfully');
                } else {
                    console.log('Cache expired or invalid version, will fetch fresh data');
                    localStorage.removeItem(CACHE_KEY);
                }
            }
        } catch (error) {
            console.error('Failed to load from cache:', error);
            localStorage.removeItem(CACHE_KEY);
        } finally {
            setIsLoadingFromCache(false);
        }
    }, []);

    // Save to cache whenever pixels change
    useEffect(() => {
        if (isLoadingFromCache) return; // Don't save while loading from cache

        try {
            const data: CachedData = {
                version: CACHE_VERSION,
                timestamp: Date.now(),
                pixels: Array.from(pixelDataRef.current.entries()),
            };
            localStorage.setItem(CACHE_KEY, JSON.stringify(data));
            console.log(`Saved ${data.pixels.length} pixels to cache`);
        } catch (error) {
            console.error('Failed to save to cache:', error);
            // If quota exceeded, clear old cache
            if (error instanceof Error && error.name === 'QuotaExceededError') {
                localStorage.removeItem(CACHE_KEY);
            }
        }
    }, [placedPixelCount, isLoadingFromCache]);

    // Batch load multiple tiles in a single RPC call
    const loadTilesBatch = useCallback(
        async (tiles: Array<{ tileX: number; tileY: number }>) => {
            if (!publicClient || tiles.length === 0) return;

            try {
                // Generate all pixel coordinates for the tiles
                const pixelCoords: Array<{ px: number; py: number }> = [];
                const tilePixelMap = new Map<string, Array<{ px: number; py: number }>>();

                for (const { tileX, tileY } of tiles) {
                    const tileKey = `${tileX},${tileY}`;
                    loadedTilesRef.current.add(tileKey);

                    const startPx = tileX * TILE_SIZE;
                    const startPy = tileY * TILE_SIZE;

                    // Skip tiles outside canvas bounds
                    if (startPx >= CANVAS_RES || startPy >= CANVAS_RES) continue;

                    // Sample pixels from the tile (not all 512x512, but a reasonable sample)
                    const SAMPLE_SIZE = 32; // Sample every 32nd pixel in each direction
                    const tilePixels: Array<{ px: number; py: number }> = [];

                    for (let dy = 0; dy < TILE_SIZE && startPy + dy < CANVAS_RES; dy += SAMPLE_SIZE) {
                        for (let dx = 0; dx < TILE_SIZE && startPx + dx < CANVAS_RES; dx += SAMPLE_SIZE) {
                            const coords = { px: startPx + dx, py: startPy + dy };
                            pixelCoords.push(coords);
                            tilePixels.push(coords);
                        }
                    }

                    tilePixelMap.set(tileKey, tilePixels);
                }

                if (pixelCoords.length === 0) return;

                // Contract limit is 1000 pixels per batch, so split if needed
                const MAX_BATCH_SIZE = 1000;
                let totalCount = 0;

                for (let i = 0; i < pixelCoords.length; i += MAX_BATCH_SIZE) {
                    const batchCoords = pixelCoords.slice(i, i + MAX_BATCH_SIZE);
                    const pxArray = batchCoords.map(c => BigInt(c.px));
                    const pyArray = batchCoords.map(c => BigInt(c.py));

                    // @ts-expect-error - viem type mismatch
                    const result = await publicClient.readContract({
                        address: MEGAPLACE_ADDRESS,
                        abi: MegaplaceABI,
                        functionName: 'getPixelBatch',
                        args: [pxArray, pyArray],
                    });

                    const colors = result[0] as number[];

                    console.log(`Loaded batch of ${batchCoords.length} pixels, found ${colors.filter((c: number) => c !== 0).length} non-zero`);

                    // Process results
                    for (let j = 0; j < batchCoords.length; j++) {
                        const { px, py } = batchCoords[j];
                        const pixelKey = `${px},${py}`;
                        const colorRaw = colors[j];
                        const color = typeof colorRaw === 'bigint' ? Number(colorRaw) : (colorRaw ?? 0);

                        if (color !== 0) {
                            console.log(`Found pixel at (${px}, ${py}) with color ${color}`);
                            pixelDataRef.current.set(pixelKey, color);
                            updateMarker(px, py, color);
                            totalCount++;
                        } else {
                            pixelDataRef.current.delete(pixelKey);
                            removeMarker(pixelKey);
                        }
                    }
                }

                setPlacedPixelCount(pixelDataRef.current.size);
                console.log(`Loaded ${tiles.length} tiles (${pixelCoords.length} pixels sampled): ${totalCount} placed`);
            } catch (error) {
                console.error(`Failed to load tiles batch:`, error);
                // Mark tiles as not loaded so they can be retried
                tiles.forEach(({ tileX, tileY }) => {
                    loadedTilesRef.current.delete(`${tileX},${tileY}`);
                });
            }
        },
        [publicClient]
    );

    // Update or create a marker on the map
    const updateMarker = useCallback((px: number, py: number, color: number) => {
        if (!mapRef.current) {
            console.warn(`Cannot update marker at (${px}, ${py}): mapRef not ready`);
            return;
        }

        const pixelKey = `${px},${py}`;
        const rgb = uint32ToRgb(color);
        const hexColor = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;

        let marker = markersRef.current.get(pixelKey);
        if (marker) {
            console.log(`Updating existing marker at (${px}, ${py}) with color ${hexColor}`);
            marker.setStyle({ fillColor: hexColor, color: hexColor });
        } else {
            console.log(`Creating new marker at (${px}, ${py}) with color ${hexColor}`);
            // Dynamically import Leaflet to create marker
            import('leaflet').then((L) => {
                if (!mapRef.current) {
                    console.warn(`Map no longer available when creating marker at (${px}, ${py})`);
                    return;
                }

                // Calculate exact pixel bounds - each pixel occupies 1/CANVAS_RES of the normalized space
                const { lat: lat1, lon: lon1 } = globalPxToLatLon(px, py);
                const { lat: lat2, lon: lon2 } = globalPxToLatLon(px + 1, py + 1);

                // Create bounds ensuring no overlap - pixels tile perfectly
                const bounds: [[number, number], [number, number]] = [
                    [Math.min(lat1, lat2), Math.min(lon1, lon2)],
                    [Math.max(lat1, lat2), Math.max(lon1, lon2)]
                ];

                const newMarker = L.rectangle(bounds, {
                    fillColor: hexColor,
                    color: hexColor,
                    weight: 0, // No border to avoid overlap artifacts
                    opacity: 1,
                    fillOpacity: 1,
                });

                newMarker.on('click', () => {
                    setState((prev) => ({ ...prev, selectedPixel: { px, py } }));
                });

                newMarker.on('mouseover', () => {
                    setState((prev) => ({ ...prev, hoveredPixel: { px, py } }));
                });

                newMarker.on('mouseout', () => {
                    setState((prev) => ({ ...prev, hoveredPixel: null }));
                });

                if (mapRef.current) {
                    newMarker.addTo(mapRef.current);
                    markersRef.current.set(pixelKey, newMarker);
                    console.log(`Marker created and added to map at (${px}, ${py})`);
                } else {
                    console.warn(`Map ref lost while creating marker at (${px}, ${py})`);
                }
            }).catch(error => {
                console.error(`Failed to import Leaflet for marker at (${px}, ${py}):`, error);
            });
        }
    }, []);

    // Remove a marker from the map
    const removeMarker = useCallback((pixelKey: string) => {
        const marker = markersRef.current.get(pixelKey);
        if (marker && mapRef.current) {
            mapRef.current.removeLayer(marker);
            markersRef.current.delete(pixelKey);
        }
    }, []);

    // Load initial tiles (loads a small sample around world center)
    const loadInitialTiles = useCallback(async () => {
        if (!publicClient || isLoadingTiles) return;

        // Wait for cache to load first
        if (isLoadingFromCache) {
            console.log('Waiting for cache to load before fetching fresh data...');
            return;
        }

        setIsLoadingTiles(true);

        try {
            // Load center tiles around equator/prime meridian for demo
            const centerTiles = [
                { tileX: 1024, tileY: 1024 }, // Center
                { tileX: 1023, tileY: 1024 },
                { tileX: 1025, tileY: 1024 },
                { tileX: 1024, tileY: 1023 },
                { tileX: 1024, tileY: 1025 },
            ];

            await loadTilesBatch(centerTiles);
        } finally {
            setIsLoadingTiles(false);
        }
    }, [publicClient, isLoadingTiles, isLoadingFromCache, loadTilesBatch]);

    // Load visible tiles based on map bounds
    const loadVisibleTiles = useCallback(() => {
        if (!mapRef.current || isLoadingTiles) return;

        // Clear existing timeout
        if (batchTimeoutRef.current) {
            clearTimeout(batchTimeoutRef.current);
        }

        // Debounce tile loading to batch multiple requests
        batchTimeoutRef.current = setTimeout(() => {
            if (!mapRef.current) return;

            const bounds = mapRef.current.getBounds();
            const tiles = getTilesInBounds({
                north: bounds.getNorth(),
                south: bounds.getSouth(),
                east: bounds.getEast(),
                west: bounds.getWest(),
            });

            // Filter out already loaded and pending tiles
            const tilesToLoad = tiles.filter(({ tileX, tileY }) => {
                const tileKey = `${tileX},${tileY}`;
                return !loadedTilesRef.current.has(tileKey) && !pendingTilesRef.current.has(tileKey);
            });

            if (tilesToLoad.length === 0) return;

            // Add to pending
            tilesToLoad.forEach(({ tileX, tileY }) => {
                pendingTilesRef.current.add(`${tileX},${tileY}`);
            });

            // Load in chunks of max 20 tiles (about 400-800 pixels sampled)
            const CHUNK_SIZE = 20;
            const loadChunks = async () => {
                for (let i = 0; i < tilesToLoad.length; i += CHUNK_SIZE) {
                    const chunk = tilesToLoad.slice(i, i + CHUNK_SIZE);
                    await loadTilesBatch(chunk);
                    // Remove from pending after loading
                    chunk.forEach(({ tileX, tileY }) => {
                        pendingTilesRef.current.delete(`${tileX},${tileY}`);
                    });
                }
            };

            loadChunks();
        }, 500); // Increased debounce delay to 500ms
    }, [loadTilesBatch, isLoadingTiles]);

    // Focus on a specific pixel
    const focusOnPixel = useCallback((px: number, py: number, zoom?: number) => {
        if (!mapRef.current) return;

        const { lat, lon } = globalPxToLatLon(px, py);
        const currentZoom = mapRef.current.getZoom();
        const targetZoom = zoom !== undefined ? zoom : (currentZoom < 15 ? 15 : currentZoom);
        mapRef.current.setView([lat, lon], targetZoom);
        setState((prev) => ({ ...prev, selectedPixel: { px, py } }));
    }, []);

    // Handle pixel placed event
    const handlePixelPlaced = useCallback(
        (event: PixelPlacedEvent) => {
            const px = Number(event.x);
            const py = Number(event.y);
            const color = Number(event.color);
            const pixelKey = `${px},${py}`;

            console.log(`[handlePixelPlaced] Processing pixel at (${px}, ${py}) with color ${color} by ${event.user}`);

            if (color === 0) {
                console.log(`[handlePixelPlaced] Removing pixel at (${px}, ${py})`);
                pixelDataRef.current.delete(pixelKey);
                removeMarker(pixelKey);
            } else {
                console.log(`[handlePixelPlaced] Adding/updating pixel at (${px}, ${py})`);
                pixelDataRef.current.set(pixelKey, color);
                updateMarker(px, py, color);
            }

            const newCount = pixelDataRef.current.size;
            console.log(`[handlePixelPlaced] Total placed pixels: ${newCount}`);
            setPlacedPixelCount(newCount);
        },
        [updateMarker, removeMarker]
    );

    // Handle map hover to show pixel highlight
    const handleMapHover = useCallback((lat: number, lng: number, selectedColor?: string) => {
        if (!mapRef.current) return;

        const { px, py } = latLonToGlobalPx(lat, lng);
        setState((prev) => ({ ...prev, hoveredPixel: { px, py } }));

        // Dynamically import Leaflet to create/update hover highlight
        import('leaflet').then((L) => {
            if (!mapRef.current) return;

            // Calculate exact pixel bounds
            const { lat: lat1, lon: lon1 } = globalPxToLatLon(px, py);
            const { lat: lat2, lon: lon2 } = globalPxToLatLon(px + 1, py + 1);

            const bounds: [[number, number], [number, number]] = [
                [Math.min(lat1, lat2), Math.min(lon1, lon2)],
                [Math.max(lat1, lat2), Math.max(lon1, lon2)]
            ];

            // Convert hex color to rgba with opacity
            let fillColor = 'rgba(255, 255, 255, 0.3)';
            let borderColor = '#ffffff';

            if (selectedColor) {
                // Parse hex color and convert to rgba
                const hex = selectedColor.replace('#', '');
                const r = parseInt(hex.substring(0, 2), 16);
                const g = parseInt(hex.substring(2, 4), 16);
                const b = parseInt(hex.substring(4, 6), 16);
                fillColor = `rgba(${r}, ${g}, ${b}, 0.5)`;
                borderColor = selectedColor;
            }

            if (hoverHighlightRef.current) {
                // Update existing highlight
                hoverHighlightRef.current.setBounds(bounds);
                hoverHighlightRef.current.setStyle({
                    fillColor,
                    color: borderColor,
                    fillOpacity: 0.5,
                });
            } else {
                // Create new highlight rectangle
                const highlight = L.rectangle(bounds, {
                    fillColor,
                    color: borderColor,
                    weight: 2,
                    opacity: 0.8,
                    fillOpacity: 0.5,
                    interactive: false, // Don't interfere with map interactions
                });

                highlight.addTo(mapRef.current);
                hoverHighlightRef.current = highlight;
            }
        });
    }, []);

    // Handle map hover out
    const handleMapHoverOut = useCallback(() => {
        setState((prev) => ({ ...prev, hoveredPixel: null }));

        if (hoverHighlightRef.current && mapRef.current) {
            mapRef.current.removeLayer(hoverHighlightRef.current);
            hoverHighlightRef.current = null;
        }
    }, []);

    // Handle map click to select pixel
    const handleMapClick = useCallback((lat: number, lng: number, selectedColor?: string) => {
        const { px, py } = latLonToGlobalPx(lat, lng);
        setState((prev) => ({ ...prev, selectedPixel: { px, py } }));

        // Zoom to 15 if current zoom is less than 15
        if (mapRef.current) {
            const currentZoom = mapRef.current.getZoom();
            if (currentZoom < 15) {
                mapRef.current.setView([lat, lng], 15);
            }
        }

        // Create/update selected pixel highlight
        import('leaflet').then((L) => {
            if (!mapRef.current) return;

            // Calculate exact pixel bounds
            const { lat: lat1, lon: lon1 } = globalPxToLatLon(px, py);
            const { lat: lat2, lon: lon2 } = globalPxToLatLon(px + 1, py + 1);

            const bounds: [[number, number], [number, number]] = [
                [Math.min(lat1, lat2), Math.min(lon1, lon2)],
                [Math.max(lat1, lat2), Math.max(lon1, lon2)]
            ];

            // Get the color of the existing pixel if any
            const pixelKey = `${px},${py}`;
            const existingColor = pixelDataRef.current.get(pixelKey);
            let fillColor = 'rgba(255, 255, 255, 0.3)';
            let borderColor = '#ffffff';

            // Use selectedColor if provided
            if (selectedColor) {
                const hex = selectedColor.replace('#', '');
                const r = parseInt(hex.substring(0, 2), 16);
                const g = parseInt(hex.substring(2, 4), 16);
                const b = parseInt(hex.substring(4, 6), 16);
                fillColor = `rgba(${r}, ${g}, ${b}, 0.5)`;
                borderColor = selectedColor;
            }

            if (selectedHighlightRef.current) {
                // Update existing highlight
                selectedHighlightRef.current.setBounds(bounds);
                selectedHighlightRef.current.setStyle({
                    fillColor,
                    color: borderColor,
                    weight: 2,
                    opacity: 0.8,
                    fillOpacity: 0.5,
                });
            } else {
                // Create new highlight rectangle
                const highlight = L.rectangle(bounds, {
                    fillColor,
                    color: borderColor,
                    weight: 2,
                    opacity: 0.8,
                    fillOpacity: 0.5,
                    interactive: false,
                });

                highlight.addTo(mapRef.current);
                selectedHighlightRef.current = highlight;
            }
        });
    }, []);

    // Get the color of the selected pixel
    const getSelectedPixelColor = useCallback(() => {
        if (!state.selectedPixel) return null;
        const pixelKey = `${state.selectedPixel.px},${state.selectedPixel.py}`;
        return pixelDataRef.current.get(pixelKey) || null;
    }, [state.selectedPixel]);

    // Update selected pixel highlight color
    const updateSelectedHighlightColor = useCallback((newColor: string) => {
        if (!selectedHighlightRef.current || !state.selectedPixel) return;

        const hex = newColor.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        const fillColor = `rgba(${r}, ${g}, ${b}, 0.5)`;

        selectedHighlightRef.current.setStyle({
            fillColor,
            color: newColor,
            weight: 2,
            opacity: 0.8,
            fillOpacity: 0.5,
        });
    }, [state.selectedPixel]);

    return {
        mapRef,
        selectedPixel: state.selectedPixel,
        hoveredPixel: state.hoveredPixel,
        handlePixelPlaced,
        placedPixelCount,
        focusOnPixel,
        loadVisibleTiles,
        handleMapClick,
        handleMapHover,
        handleMapHoverOut,
        loadInitialTiles,
        getSelectedPixelColor,
        updateSelectedHighlightColor,
    };
}
