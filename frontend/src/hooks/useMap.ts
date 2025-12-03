import { useState, useCallback, useRef, useEffect } from 'react';
import { uint32ToRgb, type PixelPlacedEvent } from './useMegaplace';
import type { Map as LeafletMap } from 'leaflet';
import * as L from 'leaflet';
import { latLonToGlobalPx, globalPxToLatLon } from '../lib/projection';
import { fetchAllPixels, checkBackendHealth } from '../services/backendApi';
import { PIXEL_SELECT_ZOOM } from '../constants';

interface UseMapState {
    selectedPixel: { px: number; py: number } | null;
    hoveredPixel: { px: number; py: number } | null;
}

export function useMap() {
    const mapRef = useRef<LeafletMap | null>(null);
    const [state, setState] = useState<UseMapState>({
        selectedPixel: null,
        hoveredPixel: null,
    });
    const [placedPixelCount, setPlacedPixelCount] = useState(0);
    const [isLoadingFromBackend, setIsLoadingFromBackend] = useState(true);
    const [backendPixels, setBackendPixels] = useState<PixelPlacedEvent[]>([]);
    const hasLoadedFromBackendRef = useRef(false);
    const mapReadyRef = useRef(false);

    // Store pixel colors in a map for efficient updates
    // Key: "px,py", Value: color
    const pixelDataRef = useRef<Map<string, number>>(new Map());
    const markersRef = useRef<Map<string, L.Rectangle | L.CircleMarker>>(new Map());
    const hoverHighlightRef = useRef<L.Rectangle | null>(null);
    const selectedHighlightRef = useRef<L.Rectangle | null>(null);

    // Load initial data from backend on mount
    useEffect(() => {
        const loadFromBackend = async () => {
            if (hasLoadedFromBackendRef.current) return;

            const isBackendAvailable = await checkBackendHealth();

            if (!isBackendAvailable) {
                setIsLoadingFromBackend(false);
                return;
            }

            hasLoadedFromBackendRef.current = true;

            try {
                const pixels = await fetchAllPixels();

                // Convert to PixelPlacedEvent format for the UI list
                const pixelEvents: PixelPlacedEvent[] = pixels.map(pixel => ({
                    user: pixel.placedBy,
                    x: BigInt(pixel.x),
                    y: BigInt(pixel.y),
                    color: pixel.color,
                    timestamp: BigInt(pixel.timestamp),
                }));
                setBackendPixels(pixelEvents);

                // Populate pixel data
                for (const pixel of pixels) {
                    const pixelKey = `${pixel.x},${pixel.y}`;
                    pixelDataRef.current.set(pixelKey, pixel.color);
                }

                setPlacedPixelCount(pixels.length);

                // If map is already ready, create markers now
                if (mapReadyRef.current && mapRef.current) {
                    for (const [key, color] of pixelDataRef.current.entries()) {
                        const [px, py] = key.split(',').map(Number);
                        updateMarkerInternal(px, py, color);
                    }
                }
            } catch (error) {
                console.error('Failed to load from backend:', error);
            } finally {
                setIsLoadingFromBackend(false);
            }
        };

        loadFromBackend();
    }, []);

    // Internal marker update function
    const updateMarkerInternal = useCallback((px: number, py: number, color: number) => {
        if (!mapRef.current) return;

        const pixelKey = `${px},${py}`;
        const rgb = uint32ToRgb(color);
        const hexColor = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;

        let marker = markersRef.current.get(pixelKey);
        if (marker) {
            // Update existing marker
            marker.setStyle({ fillColor: hexColor, color: hexColor });
        } else {
            // Create new marker
            const { lat: lat1, lon: lon1 } = globalPxToLatLon(px, py);
            const { lat: lat2, lon: lon2 } = globalPxToLatLon(px + 1, py + 1);

            const bounds: [[number, number], [number, number]] = [
                [Math.min(lat1, lat2), Math.min(lon1, lon2)],
                [Math.max(lat1, lat2), Math.max(lon1, lon2)]
            ];

            const newMarker = L.rectangle(bounds, {
                fillColor: hexColor,
                color: hexColor,
                weight: 0,
                opacity: 1,
                fillOpacity: 1,
            });

            newMarker.on('click', () => {
                setState((prev) => ({ ...prev, selectedPixel: { px, py } }));
            });

            try {
                newMarker.addTo(mapRef.current!);
                markersRef.current.set(pixelKey, newMarker);
            } catch (err) {
                console.error(`❌ Failed to add marker at (${px}, ${py}):`, err);
            }
        }
    }, []);

    // Public marker update function (for optimistic updates)
    const updateMarker = useCallback((px: number, py: number, color: number) => {
        pixelDataRef.current.set(`${px},${py}`, color);
        updateMarkerInternal(px, py, color);
    }, [updateMarkerInternal]);

    // Remove marker
    const removeMarker = useCallback((pixelKey: string) => {
        const marker = markersRef.current.get(pixelKey);
        if (marker && mapRef.current) {
            mapRef.current.removeLayer(marker);
            markersRef.current.delete(pixelKey);
        }
        pixelDataRef.current.delete(pixelKey);
    }, []);

    // Initialize map and create markers for pre-loaded pixels
    const initializeMap = useCallback((map: LeafletMap) => {
        mapRef.current = map;
        mapReadyRef.current = true;

        // Create markers for all loaded pixels
        if (pixelDataRef.current.size > 0) {
            for (const [key, color] of pixelDataRef.current.entries()) {
                const [px, py] = key.split(',').map(Number);
                updateMarkerInternal(px, py, color);
            }
        }
    }, [updateMarkerInternal]);

    // Handle pixel placed event from contract
    const handlePixelPlaced = useCallback(
        (event: PixelPlacedEvent) => {
            const px = Number(event.x);
            const py = Number(event.y);
            const color = Number(event.color);
            const pixelKey = `${px},${py}`;

            if (color === 0) {
                pixelDataRef.current.delete(pixelKey);
                removeMarker(pixelKey);
            } else {
                pixelDataRef.current.set(pixelKey, color);
                updateMarkerInternal(px, py, color);
            }

            setPlacedPixelCount(pixelDataRef.current.size);
        },
        [updateMarkerInternal, removeMarker]
    );

    // Helper to show/update the selection highlight
    const showSelectionHighlight = useCallback((px: number, py: number, selectedColor?: string) => {
        if (!mapRef.current) return;

        const { lat: lat1, lon: lon1 } = globalPxToLatLon(px, py);
        const { lat: lat2, lon: lon2 } = globalPxToLatLon(px + 1, py + 1);

        const bounds: [[number, number], [number, number]] = [
            [Math.min(lat1, lat2), Math.min(lon1, lon2)],
            [Math.max(lat1, lat2), Math.max(lon1, lon2)]
        ];

        let fillColor = 'rgba(255, 255, 255, 0.3)';

        if (selectedColor) {
            const hex = selectedColor.replace('#', '');
            const r = parseInt(hex.substring(0, 2), 16);
            const g = parseInt(hex.substring(2, 4), 16);
            const b = parseInt(hex.substring(4, 6), 16);
            fillColor = `rgba(${r}, ${g}, ${b}, 0.5)`;
        }

        if (selectedHighlightRef.current) {
            selectedHighlightRef.current.setBounds(bounds);
            selectedHighlightRef.current.setStyle({
                fillColor,
                stroke: false,
                fillOpacity: 0.5,
            });
        } else {
            const highlight = L.rectangle(bounds, {
                fillColor,
                stroke: false,
                fillOpacity: 0.5,
                interactive: false,
            });
            highlight.addTo(mapRef.current);
            selectedHighlightRef.current = highlight;
        }
    }, []);

    // Focus on a specific pixel with smooth animation
    const focusOnPixel = useCallback((px: number, py: number, zoom?: number) => {
        if (!mapRef.current) return;

        const { lat, lon } = globalPxToLatLon(px, py);
        const currentZoom = mapRef.current.getZoom();
        const targetZoom = zoom !== undefined ? zoom : (currentZoom < PIXEL_SELECT_ZOOM ? PIXEL_SELECT_ZOOM : currentZoom);

        // Hide existing highlight during animation
        if (selectedHighlightRef.current) {
            mapRef.current.removeLayer(selectedHighlightRef.current);
            selectedHighlightRef.current = null;
        }

        // Use flyTo for smooth animated transition
        mapRef.current.flyTo([lat, lon], targetZoom, {
            duration: 1.2,
            easeLinearity: 0.25,
        });

        // Show highlight after animation completes
        const onMoveEnd = () => {
            showSelectionHighlight(px, py);
            mapRef.current?.off('moveend', onMoveEnd);
        };
        mapRef.current.on('moveend', onMoveEnd);

        setState((prev) => ({ ...prev, selectedPixel: { px, py } }));
    }, [showSelectionHighlight]);

    // Handle map hover
    const handleMapHover = useCallback((lat: number, lng: number, selectedColor?: string) => {
        if (!mapRef.current) return;

        const { px, py } = latLonToGlobalPx(lat, lng);
        setState((prev) => ({ ...prev, hoveredPixel: { px, py } }));

        const { lat: lat1, lon: lon1 } = globalPxToLatLon(px, py);
        const { lat: lat2, lon: lon2 } = globalPxToLatLon(px + 1, py + 1);

        const bounds: [[number, number], [number, number]] = [
            [Math.min(lat1, lat2), Math.min(lon1, lon2)],
            [Math.max(lat1, lat2), Math.max(lon1, lon2)]
        ];

        let fillColor = 'rgba(255, 255, 255, 0.3)';

        if (selectedColor) {
            const hex = selectedColor.replace('#', '');
            const r = parseInt(hex.substring(0, 2), 16);
            const g = parseInt(hex.substring(2, 4), 16);
            const b = parseInt(hex.substring(4, 6), 16);
            fillColor = `rgba(${r}, ${g}, ${b}, 0.5)`;
        }

        if (hoverHighlightRef.current) {
            hoverHighlightRef.current.setBounds(bounds);
            hoverHighlightRef.current.setStyle({ fillColor, stroke: false, fillOpacity: 0.5 });
        } else {
            const highlight = L.rectangle(bounds, {
                fillColor,
                stroke: false,
                fillOpacity: 0.5,
                interactive: false,
            });
            highlight.addTo(mapRef.current);
            hoverHighlightRef.current = highlight;
        }
    }, []);

    // Handle map hover out
    const handleMapHoverOut = useCallback(() => {
        setState((prev) => ({ ...prev, hoveredPixel: null }));

        if (hoverHighlightRef.current && mapRef.current) {
            mapRef.current.removeLayer(hoverHighlightRef.current);
            hoverHighlightRef.current = null;
        }
    }, []);

    // Handle map click
    const handleMapClick = useCallback((lat: number, lng: number, selectedColor?: string) => {
        const { px, py } = latLonToGlobalPx(lat, lng);
        setState((prev) => ({ ...prev, selectedPixel: { px, py } }));

        if (!mapRef.current) return;

        const currentZoom = mapRef.current.getZoom();
        const needsZoom = currentZoom < PIXEL_SELECT_ZOOM;

        if (needsZoom) {
            // Hide existing highlight during animation
            if (selectedHighlightRef.current) {
                mapRef.current.removeLayer(selectedHighlightRef.current);
                selectedHighlightRef.current = null;
            }

            // Smooth animated zoom to pixel, then show highlight
            mapRef.current.flyTo([lat, lng], PIXEL_SELECT_ZOOM, {
                duration: 0.8,
                easeLinearity: 0.25,
            });

            // Show highlight after animation completes
            const onMoveEnd = () => {
                showSelectionHighlight(px, py, selectedColor);
                mapRef.current?.off('moveend', onMoveEnd);
            };
            mapRef.current.on('moveend', onMoveEnd);
        } else {
            // Already zoomed in, show highlight immediately
            showSelectionHighlight(px, py, selectedColor);
        }
    }, [showSelectionHighlight]);

    // Get selected pixel color
    const getSelectedPixelColor = useCallback(() => {
        if (!state.selectedPixel) return null;
        const pixelKey = `${state.selectedPixel.px},${state.selectedPixel.py}`;
        return pixelDataRef.current.get(pixelKey) || null;
    }, [state.selectedPixel]);

    // Update selected highlight color
    const updateSelectedHighlightColor = useCallback((newColor: string) => {
        if (!selectedHighlightRef.current || !state.selectedPixel) return;

        const hex = newColor.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        const fillColor = `rgba(${r}, ${g}, ${b}, 0.5)`;

        selectedHighlightRef.current.setStyle({
            fillColor,
            stroke: false,
            fillOpacity: 0.5,
        });
    }, [state.selectedPixel]);

    // Dummy functions for compatibility
    const loadVisibleTiles = useCallback(() => {
        // No longer needed - all data from backend + live events
    }, []);

    const loadInitialTiles = useCallback(async () => {
        // No longer needed - backend loads on mount
    }, []);

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
        isLoadingFromBackend,
        initializeMap,
        backendPixels,
        // Exposed for optimistic UI updates
        updateMarker,
        removeMarker,
    };
}
