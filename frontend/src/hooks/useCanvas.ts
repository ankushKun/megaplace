import { useEffect, useRef, useState, useCallback } from 'react';
import { usePublicClient } from 'wagmi';
import { MEGAPLACE_ADDRESS } from '../contracts/config';
import MegaplaceABI from '../contracts/MegaplaceABI.json';
import { uint32ToRgb, type PixelPlacedEvent } from './useMegaplace';

const CANVAS_SIZE = 1000;
const INITIAL_PIXEL_SIZE = 10; // Each pixel is 10x10 screen pixels at 1x zoom
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 50;
const CHUNK_SIZE = 100; // Load 100x100 pixel chunks

interface CanvasState {
  offsetX: number;
  offsetY: number;
  scale: number;
  isDragging: boolean;
  dragStart: { x: number; y: number };
  hoveredPixel: { x: number; y: number } | null;
  selectedPixel: { x: number; y: number } | null;
}

export function useCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const publicClient = usePublicClient();
  const [state, setState] = useState<CanvasState>({
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    isDragging: false,
    dragStart: { x: 0, y: 0 },
    hoveredPixel: null,
    selectedPixel: null,
  });
  const [isLoadingChunks, setIsLoadingChunks] = useState(false);
  const [placedPixelCount, setPlacedPixelCount] = useState(0);

  // Store pixel colors in a map for efficient updates
  const pixelDataRef = useRef<Map<number, number>>(new Map());
  const loadedChunksRef = useRef<Set<string>>(new Set());

  // Load a specific chunk from the contract
  const loadChunk = useCallback(async (chunkX: number, chunkY: number, force: boolean = false) => {
    const chunkKey = `${chunkX},${chunkY}`;
    if (!force && (loadedChunksRef.current.has(chunkKey) || !publicClient)) return;

    try {
      if (!force) {
        loadedChunksRef.current.add(chunkKey);
      }

      // @ts-expect-error - viem type mismatch
      const colors = await publicClient.readContract({
        address: MEGAPLACE_ADDRESS,
        abi: MegaplaceABI,
        functionName: 'getRegion',
        args: [BigInt(chunkX), BigInt(chunkY), BigInt(CHUNK_SIZE), BigInt(CHUNK_SIZE)],
      }) as number[];

      // Update pixel data - store all non-zero pixels from contract storage
      for (let dy = 0; dy < CHUNK_SIZE && chunkY + dy < CANVAS_SIZE; dy++) {
        for (let dx = 0; dx < CHUNK_SIZE && chunkX + dx < CANVAS_SIZE; dx++) {
          const x = chunkX + dx;
          const y = chunkY + dy;
          const index = y * CANVAS_SIZE + x;
          const colorIndex = dy * CHUNK_SIZE + dx;
          const colorRaw = colors[colorIndex];
          const color = typeof colorRaw === 'bigint' ? Number(colorRaw) : (colorRaw ?? 0);

          // Store all non-zero pixels (0 means unplaced, black is now 0x010101)
          if (color !== 0) {
            pixelDataRef.current.set(index, color);
          } else {
            // Remove from map if it exists but storage shows 0
            pixelDataRef.current.delete(index);
          }
        }
      }

      // Update placed pixel count
      setPlacedPixelCount(pixelDataRef.current.size);

      renderCanvas();
    } catch (error) {
      console.error(`Failed to load chunk at (${chunkX}, ${chunkY}):`, error);
      if (!force) {
        loadedChunksRef.current.delete(chunkKey); // Allow retry
      }
    }
  }, [publicClient]);

  // Load initial canvas data - fetch entire canvas in 100x100 chunks
  const loadCanvasData = useCallback(async () => {
    if (!publicClient || isLoadingChunks) return;

    setIsLoadingChunks(true);

    // Render initial white canvas
    renderCanvas();

    try {
      console.log('Loading entire canvas from contract storage...');

      let totalPixelCount = 0;

      // Load all 100x100 chunks (10,000 pixels each, max allowed by contract)
      // 1000x1000 canvas = 10x10 grid of 100x100 chunks = 100 chunks total
      for (let chunkY = 0; chunkY < CANVAS_SIZE; chunkY += CHUNK_SIZE) {
        for (let chunkX = 0; chunkX < CANVAS_SIZE; chunkX += CHUNK_SIZE) {
          // @ts-expect-error - viem type mismatch
          const colors = await publicClient.readContract({
            address: MEGAPLACE_ADDRESS,
            abi: MegaplaceABI,
            functionName: 'getRegion',
            args: [BigInt(chunkX), BigInt(chunkY), BigInt(CHUNK_SIZE), BigInt(CHUNK_SIZE)],
          }) as number[];

          // Check for pixels that might be black (color=0) and need verification
          const pixelsToVerify: { x: number; y: number; index: number }[] = [];

          // Update pixel data - store all non-zero pixels from this chunk
          for (let dy = 0; dy < CHUNK_SIZE && chunkY + dy < CANVAS_SIZE; dy++) {
            for (let dx = 0; dx < CHUNK_SIZE && chunkX + dx < CANVAS_SIZE; dx++) {
              const x = chunkX + dx;
              const y = chunkY + dy;
              const index = y * CANVAS_SIZE + x;
              const colorIndex = dy * CHUNK_SIZE + dx;
              const colorRaw = colors[colorIndex];
              const color = typeof colorRaw === 'bigint' ? Number(colorRaw) : (colorRaw ?? 0);

              // Store all non-zero pixels (0 means unplaced, black is now 0x010101)
              if (color !== 0) {
                pixelDataRef.current.set(index, color);
                totalPixelCount++;
              }
            }
          }

          // Mark this chunk as loaded
          const chunkKey = `${chunkX},${chunkY}`;
          loadedChunksRef.current.add(chunkKey);
        }
      }

      console.log(`Loaded and stored ${totalPixelCount} placed pixels from storage`);

      // Update placed pixel count
      setPlacedPixelCount(pixelDataRef.current.size);

      renderCanvas();
      console.log('Canvas loaded successfully');
    } catch (error) {
      console.error('Failed to load canvas:', error);
    }

    setIsLoadingChunks(false);
  }, [publicClient, isLoadingChunks]);

  // Use a ref to store the latest state for rendering
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Render the canvas
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const currentState = stateRef.current;

    // Clear canvas with white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Save context
    ctx.save();

    // Calculate the visible region
    const pixelSize = INITIAL_PIXEL_SIZE * currentState.scale;
    const visibleStartX = Math.floor(-currentState.offsetX / pixelSize);
    const visibleStartY = Math.floor(-currentState.offsetY / pixelSize);
    const visibleEndX = Math.ceil((canvas.width - currentState.offsetX) / pixelSize);
    const visibleEndY = Math.ceil((canvas.height - currentState.offsetY) / pixelSize);

    // Clamp to canvas bounds
    const startX = Math.max(0, visibleStartX);
    const startY = Math.max(0, visibleStartY);
    const endX = Math.min(CANVAS_SIZE, visibleEndX);
    const endY = Math.min(CANVAS_SIZE, visibleEndY);

    // Apply transformations
    ctx.translate(currentState.offsetX, currentState.offsetY);
    ctx.scale(currentState.scale, currentState.scale);

    // Draw grid (only if zoomed in enough)
    if (currentState.scale > 3) {
      // Calculate opacity based on zoom level - fade in gradually
      const minZoom = 3;
      const maxZoom = 10;
      const opacity = Math.min(0.25, 0.2 + (currentState.scale - minZoom) / (maxZoom - minZoom) * 0.17);

      ctx.strokeStyle = `rgba(0, 0, 0, ${opacity})`;
      ctx.lineWidth = 1 / currentState.scale;

      for (let x = startX; x <= endX; x++) {
        ctx.beginPath();
        ctx.moveTo(x * INITIAL_PIXEL_SIZE, startY * INITIAL_PIXEL_SIZE);
        ctx.lineTo(x * INITIAL_PIXEL_SIZE, endY * INITIAL_PIXEL_SIZE);
        ctx.stroke();
      }

      for (let y = startY; y <= endY; y++) {
        ctx.beginPath();
        ctx.moveTo(startX * INITIAL_PIXEL_SIZE, y * INITIAL_PIXEL_SIZE);
        ctx.lineTo(endX * INITIAL_PIXEL_SIZE, y * INITIAL_PIXEL_SIZE);
        ctx.stroke();
      }
    }

    // Draw only placed pixels (skip white/unplaced pixels)
    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const index = y * CANVAS_SIZE + x;
        const color = pixelDataRef.current.get(index);

        // Only draw if pixel has been placed
        if (color !== undefined) {
          const rgb = uint32ToRgb(color);
          ctx.fillStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
          ctx.fillRect(
            x * INITIAL_PIXEL_SIZE,
            y * INITIAL_PIXEL_SIZE,
            INITIAL_PIXEL_SIZE,
            INITIAL_PIXEL_SIZE
          );
        }
      }
    }

    // Highlight hovered pixel (only if not the selected pixel)
    if (currentState.hoveredPixel && !(currentState.selectedPixel &&
      currentState.hoveredPixel.x === currentState.selectedPixel.x &&
      currentState.hoveredPixel.y === currentState.selectedPixel.y)) {
      // Draw semi-transparent overlay
      ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.fillRect(
        currentState.hoveredPixel.x * INITIAL_PIXEL_SIZE,
        currentState.hoveredPixel.y * INITIAL_PIXEL_SIZE,
        INITIAL_PIXEL_SIZE,
        INITIAL_PIXEL_SIZE
      );

      // Draw border - scale with zoom level
      // At 1x zoom: 0.2, zoomed in more: thicker, zoomed out: thinner
      const borderWidth = Math.max(0.1, Math.min(1, 0.2 * currentState.scale));
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = borderWidth;
      ctx.strokeRect(
        currentState.hoveredPixel.x * INITIAL_PIXEL_SIZE,
        currentState.hoveredPixel.y * INITIAL_PIXEL_SIZE,
        INITIAL_PIXEL_SIZE,
        INITIAL_PIXEL_SIZE
      );
    }

    // Highlight selected pixel
    if (currentState.selectedPixel) {
      // Draw semi-transparent overlay
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.fillRect(
        currentState.selectedPixel.x * INITIAL_PIXEL_SIZE,
        currentState.selectedPixel.y * INITIAL_PIXEL_SIZE,
        INITIAL_PIXEL_SIZE,
        INITIAL_PIXEL_SIZE
      );

      // Draw thicker border - scale with zoom level
      // At 1x zoom: 0.3, zoomed in more: thicker, zoomed out: thinner
      const borderWidth = Math.max(0.15, Math.min(1.5, 0.3 * currentState.scale));
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = borderWidth;
      ctx.strokeRect(
        currentState.selectedPixel.x * INITIAL_PIXEL_SIZE,
        currentState.selectedPixel.y * INITIAL_PIXEL_SIZE,
        INITIAL_PIXEL_SIZE,
        INITIAL_PIXEL_SIZE
      );
    }

    // Restore context
    ctx.restore();
  }, []);

  // Update a single pixel - stable callback that doesn't depend on anything
  const updatePixel = useCallback((x: number, y: number, color: number) => {
    if (x < 0 || x >= CANVAS_SIZE || y < 0 || y >= CANVAS_SIZE) {
      console.warn(`[Canvas] Invalid pixel coordinates: (${x}, ${y})`);
      return;
    }
    const index = y * CANVAS_SIZE + x;
    console.log(`[Canvas] Updating pixel at (${x}, ${y}) with color ${color}`);

    pixelDataRef.current.set(index, color);

    // Update placed pixel count
    setPlacedPixelCount(pixelDataRef.current.size);

    // Call renderCanvas directly since it's stable
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const currentState = stateRef.current;

    // Clear canvas with white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Save context
    ctx.save();

    // Calculate the visible region
    const pixelSize = INITIAL_PIXEL_SIZE * currentState.scale;
    const visibleStartX = Math.floor(-currentState.offsetX / pixelSize);
    const visibleStartY = Math.floor(-currentState.offsetY / pixelSize);
    const visibleEndX = Math.ceil((canvas.width - currentState.offsetX) / pixelSize);
    const visibleEndY = Math.ceil((canvas.height - currentState.offsetY) / pixelSize);

    // Clamp to canvas bounds
    const startX = Math.max(0, visibleStartX);
    const startY = Math.max(0, visibleStartY);
    const endX = Math.min(CANVAS_SIZE, visibleEndX);
    const endY = Math.min(CANVAS_SIZE, visibleEndY);

    // Apply transformations
    ctx.translate(currentState.offsetX, currentState.offsetY);
    ctx.scale(currentState.scale, currentState.scale);

    // Draw grid (only if zoomed in enough)
    if (currentState.scale > 3) {
      const minZoom = 3;
      const maxZoom = 10;
      const opacity = Math.min(0.25, 0.2 + (currentState.scale - minZoom) / (maxZoom - minZoom) * 0.17);

      ctx.strokeStyle = `rgba(0, 0, 0, ${opacity})`;
      ctx.lineWidth = 1 / currentState.scale;

      for (let gridX = startX; gridX <= endX; gridX++) {
        ctx.beginPath();
        ctx.moveTo(gridX * INITIAL_PIXEL_SIZE, startY * INITIAL_PIXEL_SIZE);
        ctx.lineTo(gridX * INITIAL_PIXEL_SIZE, endY * INITIAL_PIXEL_SIZE);
        ctx.stroke();
      }

      for (let gridY = startY; gridY <= endY; gridY++) {
        ctx.beginPath();
        ctx.moveTo(startX * INITIAL_PIXEL_SIZE, gridY * INITIAL_PIXEL_SIZE);
        ctx.lineTo(endX * INITIAL_PIXEL_SIZE, gridY * INITIAL_PIXEL_SIZE);
        ctx.stroke();
      }
    }

    // Draw only placed pixels
    for (let py = startY; py < endY; py++) {
      for (let px = startX; px < endX; px++) {
        const pixelIndex = py * CANVAS_SIZE + px;
        const pixelColor = pixelDataRef.current.get(pixelIndex);

        if (pixelColor !== undefined) {
          const rgb = uint32ToRgb(pixelColor);
          ctx.fillStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
          ctx.fillRect(
            px * INITIAL_PIXEL_SIZE,
            py * INITIAL_PIXEL_SIZE,
            INITIAL_PIXEL_SIZE,
            INITIAL_PIXEL_SIZE
          );
        }
      }
    }

    // Highlight hovered pixel
    if (currentState.hoveredPixel && !(currentState.selectedPixel &&
      currentState.hoveredPixel.x === currentState.selectedPixel.x &&
      currentState.hoveredPixel.y === currentState.selectedPixel.y)) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.fillRect(
        currentState.hoveredPixel.x * INITIAL_PIXEL_SIZE,
        currentState.hoveredPixel.y * INITIAL_PIXEL_SIZE,
        INITIAL_PIXEL_SIZE,
        INITIAL_PIXEL_SIZE
      );

      const borderWidth = Math.max(0.1, Math.min(1, 0.2 * currentState.scale));
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = borderWidth;
      ctx.strokeRect(
        currentState.hoveredPixel.x * INITIAL_PIXEL_SIZE,
        currentState.hoveredPixel.y * INITIAL_PIXEL_SIZE,
        INITIAL_PIXEL_SIZE,
        INITIAL_PIXEL_SIZE
      );
    }

    // Highlight selected pixel
    if (currentState.selectedPixel) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.fillRect(
        currentState.selectedPixel.x * INITIAL_PIXEL_SIZE,
        currentState.selectedPixel.y * INITIAL_PIXEL_SIZE,
        INITIAL_PIXEL_SIZE,
        INITIAL_PIXEL_SIZE
      );

      const borderWidth = Math.max(0.15, Math.min(1.5, 0.3 * currentState.scale));
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = borderWidth;
      ctx.strokeRect(
        currentState.selectedPixel.x * INITIAL_PIXEL_SIZE,
        currentState.selectedPixel.y * INITIAL_PIXEL_SIZE,
        INITIAL_PIXEL_SIZE,
        INITIAL_PIXEL_SIZE
      );
    }

    ctx.restore();
  }, []);

  // Handle pixel placed events - refetch chunk from contract storage
  const handlePixelPlaced = useCallback((event: PixelPlacedEvent) => {
    const x = Number(event.x);
    const y = Number(event.y);
    console.log(`[Canvas] handlePixelPlaced called for pixel at (${x}, ${y}) with color ${event.color}`);

    // Calculate which chunk this pixel belongs to
    const chunkX = Math.floor(x / CHUNK_SIZE) * CHUNK_SIZE;
    const chunkY = Math.floor(y / CHUNK_SIZE) * CHUNK_SIZE;

    // Refetch the chunk from contract storage to ensure we have the latest state
    loadChunk(chunkX, chunkY, true);
  }, [loadChunk]);

  // Convert screen coordinates to canvas pixel coordinates
  const screenToCanvas = useCallback((screenX: number, screenY: number) => {
    // Account for canvas transformations (translate and scale)
    const canvasX = (screenX - state.offsetX) / state.scale;
    const canvasY = (screenY - state.offsetY) / state.scale;

    // Convert to pixel grid coordinates
    const x = Math.floor(canvasX / INITIAL_PIXEL_SIZE);
    const y = Math.floor(canvasY / INITIAL_PIXEL_SIZE);

    return { x, y };
  }, [state.offsetX, state.offsetY, state.scale]);

  // Mouse event handlers
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setState(prev => ({
      ...prev,
      isDragging: true,
      dragStart: { x, y },
    }));
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (state.isDragging) {
      const dx = x - state.dragStart.x;
      const dy = y - state.dragStart.y;

      setState(prev => ({
        ...prev,
        offsetX: prev.offsetX + dx,
        offsetY: prev.offsetY + dy,
        dragStart: { x, y },
      }));
    } else {
      const pixel = screenToCanvas(x, y);
      if (pixel.x >= 0 && pixel.x < CANVAS_SIZE && pixel.y >= 0 && pixel.y < CANVAS_SIZE) {
        // Only update if pixel changed to avoid unnecessary re-renders
        setState(prev => {
          if (prev.hoveredPixel?.x === pixel.x && prev.hoveredPixel?.y === pixel.y) {
            return prev;
          }
          return {
            ...prev,
            hoveredPixel: pixel,
          };
        });
      } else {
        setState(prev => {
          if (prev.hoveredPixel === null) {
            return prev;
          }
          return {
            ...prev,
            hoveredPixel: null,
          };
        });
      }
    }
  }, [state.isDragging, state.dragStart, screenToCanvas]);

  const handleMouseUp = useCallback(() => {
    setState(prev => ({
      ...prev,
      isDragging: false,
    }));
  }, []);

  const handleMouseLeave = useCallback(() => {
    setState(prev => ({
      ...prev,
      isDragging: false,
      hoveredPixel: null,
    }));
  }, []);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pixel = screenToCanvas(x, y);

    if (pixel.x >= 0 && pixel.x < CANVAS_SIZE && pixel.y >= 0 && pixel.y < CANVAS_SIZE) {
      setState(prev => ({
        ...prev,
        selectedPixel: pixel,
      }));
    }
  }, [screenToCanvas]);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const delta = e.deltaY > 0 ? 0.9 : 1.1;

    setState(prev => {
      const newScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev.scale * delta));

      // Zoom towards mouse position
      const scaleDiff = newScale / prev.scale;
      const newOffsetX = mouseX - (mouseX - prev.offsetX) * scaleDiff;
      const newOffsetY = mouseY - (mouseY - prev.offsetY) * scaleDiff;

      return {
        ...prev,
        scale: newScale,
        offsetX: newOffsetX,
        offsetY: newOffsetY,
      };
    });
  }, []);

  // Focus on a specific pixel by centering it on the canvas and zooming in
  const focusOnPixel = useCallback((x: number, y: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const targetScale = 5; // Zoom level to focus at

    // Calculate the center of the canvas
    const canvasCenterX = canvas.width / 2;
    const canvasCenterY = canvas.height / 2;

    // Calculate where the pixel should be in world coordinates
    const pixelWorldX = (x + 0.5) * INITIAL_PIXEL_SIZE; // Center of pixel
    const pixelWorldY = (y + 0.5) * INITIAL_PIXEL_SIZE;

    // Calculate target offset to center the pixel
    const targetOffsetX = canvasCenterX - pixelWorldX * targetScale;
    const targetOffsetY = canvasCenterY - pixelWorldY * targetScale;

    // Get current state
    const startOffsetX = stateRef.current.offsetX;
    const startOffsetY = stateRef.current.offsetY;
    const startScale = stateRef.current.scale;

    // Animation parameters
    const duration = 500; // milliseconds
    const startTime = performance.now();

    // Easing function (ease-in-out)
    const easeInOutCubic = (t: number): number => {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    };

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = easeInOutCubic(progress);

      // Interpolate values
      const currentScale = startScale + (targetScale - startScale) * easedProgress;
      const currentOffsetX = startOffsetX + (targetOffsetX - startOffsetX) * easedProgress;
      const currentOffsetY = startOffsetY + (targetOffsetY - startOffsetY) * easedProgress;

      setState((prev) => ({
        ...prev,
        scale: currentScale,
        offsetX: currentOffsetX,
        offsetY: currentOffsetY,
        selectedPixel: progress === 1 ? { x, y } : prev.selectedPixel,
      }));

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }, []);

  // Re-render when state changes
  useEffect(() => {
    renderCanvas();
  }, [state.offsetX, state.offsetY, state.scale, state.hoveredPixel, state.selectedPixel, renderCanvas]);

  // Initialize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Set canvas size to match container
    const resizeCanvas = () => {
      const newWidth = canvas.clientWidth;
      const newHeight = canvas.clientHeight;

      // Only resize if dimensions are valid and have changed
      if (newWidth > 0 && newHeight > 0 &&
        (canvas.width !== newWidth || canvas.height !== newHeight)) {
        canvas.width = newWidth;
        canvas.height = newHeight;
        renderCanvas();
      }
    };

    // Load initial data
    loadCanvasData();

    // Initial resize
    resizeCanvas();

    // Use ResizeObserver to detect when canvas element size actually changes
    // This handles both initial layout settling and window resizes
    const resizeObserver = new ResizeObserver(() => {
      resizeCanvas();
    });
    resizeObserver.observe(canvas);

    // Fallback for browsers without ResizeObserver
    window.addEventListener('resize', resizeCanvas);

    // Add wheel event listener with passive: false to allow preventDefault
    canvas.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', resizeCanvas);
      canvas.removeEventListener('wheel', handleWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicClient, loadCanvasData, handleWheel]);

  return {
    canvasRef,
    state,
    updatePixel,
    handlePixelPlaced,
    selectedPixel: state.selectedPixel,
    hoveredPixel: state.hoveredPixel,
    placedPixelCount,
    focusOnPixel,
    handlers: {
      onMouseDown: handleMouseDown,
      onMouseMove: handleMouseMove,
      onMouseUp: handleMouseUp,
      onMouseLeave: handleMouseLeave,
      onClick: handleClick,
    },
  };
}
