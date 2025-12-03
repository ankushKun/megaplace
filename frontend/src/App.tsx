import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import { useMap } from './hooks/useMap';
import {
  useCooldown,
  usePremiumAccess,
  usePlacePixelWithSessionKey,
  useGrantPremiumAccess,
  useWatchPixelPlaced,
  hexToUint32,
  uint32ToHex
} from './hooks/useMegaplace';
import { useSessionKey } from './hooks/useSessionKey';
import { MapContainer, TileLayer, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { Map as LeafletMap } from 'leaflet';
import { toast } from 'sonner';
import {
  PRESET_COLORS,
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
  MIN_MAP_ZOOM,
  MAX_MAP_ZOOM,
  MAP_MOVE_THROTTLE_MS,
  DEFAULT_PREMIUM_COST_ETH,
  DEFAULT_COOLDOWN_SECONDS,
  DEFAULT_COOLDOWN_PIXELS,
  PIXEL_SELECT_ZOOM,
} from './constants';
import { latLonToGlobalPx } from './lib/projection';

// Icons as inline SVGs for cleaner look
const PaintBrushIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" />
    <path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z" />
  </svg>
);

const GridIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="7" height="7" x="3" y="3" rx="1" />
    <rect width="7" height="7" x="14" y="3" rx="1" />
    <rect width="7" height="7" x="14" y="14" rx="1" />
    <rect width="7" height="7" x="3" y="14" rx="1" />
  </svg>
);

const ShareIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
    <polyline points="16,6 12,2 8,6" />
    <line x1="12" x2="12" y1="2" y2="15" />
  </svg>
);

const ZapIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const ChevronIcon = ({ direction = 'down' }: { direction?: 'up' | 'down' }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`transition-transform ${direction === 'up' ? 'rotate-180' : ''}`}
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const KeyIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
  </svg>
);

const WalletIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
    <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
  </svg>
);

// Component to handle map events
function MapEventsHandler({ onMapClick, onMapReady, onMoveEnd, onZoomEnd, onMouseMove, onMouseOut }: {
  onMapClick: (lat: number, lng: number) => void;
  onMapReady: (map: LeafletMap) => void;
  onMoveEnd: () => void;
  onZoomEnd?: () => void;
  onMouseMove?: (lat: number, lng: number) => void;
  onMouseOut?: () => void;
}) {
  const map = useMapEvents({
    click: (e) => {
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
    mousemove: (e) => {
      onMouseMove?.(e.latlng.lat, e.latlng.lng);
    },
    mouseout: () => {
      onMouseOut?.();
    },
    moveend: () => {
      onMoveEnd();
    },
    zoomend: () => {
      onZoomEnd?.();
    },
  });

  useEffect(() => {
    onMapReady(map);
  }, [map, onMapReady]);

  return null;
}

export default function App() {
  const account = useAccount();
  const {
    mapRef,
    selectedPixel,
    hoveredPixel,
    handlePixelPlaced,
    placedPixelCount,
    focusOnPixel,
    loadVisibleTiles,
    handleMapClick,
    handleMapHover,
    handleMapHoverOut,
    loadInitialTiles,
    updateSelectedHighlightColor,
    isLoadingFromBackend,
    initializeMap,
    backendPixels,
    updateMarker,
    removeMarker,
  } = useMap();

  const lastMoveTimeRef = useRef<number>(0);
  const throttledLoadVisibleTiles = useCallback(() => {
    const now = Date.now();
    if (now - lastMoveTimeRef.current < MAP_MOVE_THROTTLE_MS) return;
    lastMoveTimeRef.current = now;
    loadVisibleTiles();
  }, [loadVisibleTiles]);

  // Session key for instant transactions
  const {
    sessionAddress,
    sessionBalance,
    sessionBalanceFormatted,
    isLoading: isSessionKeyLoading,
    isFunding,
    needsFunding,
    fundSessionKey,
    getSessionWalletClient,
  } = useSessionKey();

  // Use session key for cooldown tracking
  const { canPlace, cooldownRemaining, pixelsRemaining, refetch: refetchCooldown } = useCooldown(sessionAddress ?? undefined);
  const { hasAccess } = usePremiumAccess();
  const { placePixel, pendingCount, recentHashes } = usePlacePixelWithSessionKey(
    getSessionWalletClient,
    sessionAddress ?? undefined
  );
  const { grantPremiumAccess, isPending: isPurchasingPremium } = useGrantPremiumAccess();
  const { recentPixels } = useWatchPixelPlaced(handlePixelPlaced);

  // Check if session key is ready for instant placement
  const canInstantPlace = account.address && sessionAddress && !needsFunding;

  const allPixels = useMemo(() => {
    return [...backendPixels, ...recentPixels]
      .sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
  }, [backendPixels, recentPixels]);

  const [selectedColor, setSelectedColor] = useState<string>(PRESET_COLORS[0]);
  const [showRecentPixels, setShowRecentPixels] = useState(true);
  const [isToolbarExpanded, setIsToolbarExpanded] = useState(true);

  const hasNavigatedRef = useRef(false);

  // Track current zoom level for instant placement
  const [currentZoom, setCurrentZoom] = useState(DEFAULT_MAP_ZOOM);

  // Calculate cooldown progress - now based on pixels remaining
  const cooldownProgress = useMemo(() => {
    if (hasAccess) return 100;
    if (!canPlace) {
      // In cooldown - show time progress
      const remaining = Number(cooldownRemaining);
      return Math.max(0, ((DEFAULT_COOLDOWN_SECONDS - remaining) / DEFAULT_COOLDOWN_SECONDS) * 100);
    }
    // Not in cooldown - show pixels remaining
    return (Number(pixelsRemaining) / DEFAULT_COOLDOWN_PIXELS) * 100;
  }, [canPlace, cooldownRemaining, pixelsRemaining, hasAccess]);

  const cooldownDisplay = useMemo(() => {
    if (hasAccess) return '⚡';
    if (!canPlace) return `${Number(cooldownRemaining)}s`;
    return `${Number(pixelsRemaining)}/${DEFAULT_COOLDOWN_PIXELS}`;
  }, [canPlace, cooldownRemaining, pixelsRemaining, hasAccess]);

  useEffect(() => {
    if (hasNavigatedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const pxParam = params.get('px');
    const pyParam = params.get('py');

    if (pxParam && pyParam) {
      const px = parseInt(pxParam, 10);
      const py = parseInt(pyParam, 10);
      if (!isNaN(px) && !isNaN(py)) {
        setTimeout(() => {
          focusOnPixel(px, py);
          hasNavigatedRef.current = true;
        }, 500);
      }
    } else if (allPixels.length > 0) {
      const randomPixel = allPixels[Math.floor(Math.random() * allPixels.length)];
      setTimeout(() => {
        focusOnPixel(Number(randomPixel.x), Number(randomPixel.y));
        hasNavigatedRef.current = true;
      }, 500);
    }
  }, [focusOnPixel, allPixels]);

  useEffect(() => {
    if (selectedPixel) {
      updateSelectedHighlightColor(selectedColor);
    }
  }, [selectedColor, selectedPixel, updateSelectedHighlightColor]);

  useEffect(() => {
    if (cooldownRemaining > 0n) {
      const timeout = setTimeout(() => {
        refetchCooldown();
      }, Number(cooldownRemaining) * 1000);
      return () => clearTimeout(timeout);
    }
  }, [cooldownRemaining, refetchCooldown]);

  // Fire and forget pixel placement - no waiting, allows spam clicking
  const handlePlacePixelAt = useCallback((px: number, py: number) => {
    if (!account.address || !canInstantPlace) return;

    const color = hexToUint32(selectedColor);
    // Optimistic update - show immediately
    updateMarker(px, py, color);
    // Fire and forget - don't await
    placePixel(px, py, color);
    // Refetch cooldown
    refetchCooldown();
  }, [account.address, canInstantPlace, selectedColor, placePixel, updateMarker, refetchCooldown]);

  const handlePlacePixel = useCallback(() => {
    if (!selectedPixel) return;
    handlePlacePixelAt(selectedPixel.px, selectedPixel.py);
  }, [selectedPixel, handlePlacePixelAt]);

  // Instant place on map click when zoomed in and session key ready
  const handleInstantMapClick = useCallback((lat: number, lng: number) => {
    const { px, py } = latLonToGlobalPx(lat, lng);

    // Check if we should instant place or just select
    const isZoomedIn = currentZoom >= PIXEL_SELECT_ZOOM;

    if (isZoomedIn && canInstantPlace && canPlace) {
      // Instant place!
      handlePlacePixelAt(px, py);
    }

    // Always update selection (handleMapClick handles this)
    handleMapClick(lat, lng, selectedColor);
  }, [currentZoom, canInstantPlace, canPlace, handlePlacePixelAt, handleMapClick, selectedColor]);

  // Keyboard shortcuts - fire and forget allows rapid pressing
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'Enter' && selectedPixel && account.address && canInstantPlace) {
        e.preventDefault();
        handlePlacePixel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedPixel, account.address, canInstantPlace, handlePlacePixel]);

  return (
    <div className="h-screen w-screen overflow-hidden bg-slate-900 relative">
      {/* Full-screen Map */}
      <MapContainer
        center={DEFAULT_MAP_CENTER}
        zoom={DEFAULT_MAP_ZOOM}
        minZoom={MIN_MAP_ZOOM}
        maxZoom={MAX_MAP_ZOOM}
        className="w-full h-full"
        zoomControl={false}
        worldCopyJump={false}
        maxBounds={[[-90, -180], [90, 180]]}
        maxBoundsViscosity={1.0}
        attributionControl={false}
        scrollWheelZoom={true}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          noWrap={true}
        />
        <MapEventsHandler
          onMapClick={handleInstantMapClick}
          onMapReady={(map) => {
            initializeMap(map);
            loadInitialTiles();
            setCurrentZoom(map.getZoom());
          }}
          onMoveEnd={throttledLoadVisibleTiles}
          onZoomEnd={() => {
            throttledLoadVisibleTiles();
            if (mapRef.current) {
              setCurrentZoom(mapRef.current.getZoom());
            }
          }}
          onMouseMove={(lat, lng) => handleMapHover(lat, lng, selectedColor)}
          onMouseOut={handleMapHoverOut}
        />
      </MapContainer>

      {/* Top Left - Zoom Controls */}
      <div className="absolute top-4 left-4 flex flex-col gap-2 z-1000">
        <button
          onClick={() => mapRef.current?.zoomIn()}
          className="w-8 h-8 bg-white rounded-lg shadow-lg flex items-center justify-center text-slate-700 hover:bg-slate-50 transition-colors font-bold text-lg"
        >
          +
        </button>
        <button
          onClick={() => mapRef.current?.zoomOut()}
          className="w-8 h-8 bg-white rounded-lg shadow-lg flex items-center justify-center text-slate-700 hover:bg-slate-50 transition-colors font-bold text-lg"
        >
          −
        </button>
      </div>

      {/* Top Right - Wallet & Info */}
      <div className="absolute top-4 right-4 flex items-center gap-3 z-1000">
        {/* Coordinates Display */}
        {hoveredPixel && (
          <div className="bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-lg shadow-lg text-sm font-mono text-slate-700">
            {hoveredPixel.px}, {hoveredPixel.py}
          </div>
        )}

        {/* Session Key Status */}
        {account.address && sessionAddress && (
          <div className="bg-white/90 backdrop-blur-sm rounded-lg shadow-lg text-sm font-medium text-slate-700 flex items-center overflow-hidden">
            <div className="px-3 py-1.5 flex items-center gap-2 border-r border-slate-200">
              <KeyIcon />
              <span className="text-xs font-mono">{sessionAddress.slice(0, 6)}...{sessionAddress.slice(-4)}</span>
            </div>
            {needsFunding ? (
              <button
                onClick={fundSessionKey}
                disabled={isFunding}
                className="px-3 py-1.5 bg-amber-500 text-white hover:bg-amber-600 transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                {isFunding ? (
                  <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <WalletIcon />
                )}
                <span>Fund</span>
              </button>
            ) : (
              <div className="px-3 py-1.5 text-emerald-600 flex items-center gap-1">
                <span>{parseFloat(sessionBalanceFormatted).toFixed(4)}</span>
                <span className="text-slate-400">ETH</span>
              </div>
            )}
          </div>
        )}

        {/* Pixels Count - Toggle for Recent Pixels */}
        <button
          onClick={() => setShowRecentPixels(!showRecentPixels)}
          className={`backdrop-blur-sm px-3 py-1.5 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2 transition-colors ${showRecentPixels
            ? 'bg-blue-500 text-white hover:bg-blue-600'
            : 'bg-white/90 text-slate-700 hover:bg-white'
            }`}
          title="Toggle recent pixels"
        >
          <GridIcon />
          <span>{placedPixelCount.toLocaleString()}</span>
        </button>

        {/* Wallet Connect */}
        <ConnectButton.Custom>
          {({ account: walletAccount, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
            const ready = mounted;
            const connected = ready && walletAccount && chain;

            return (
              <div {...(!ready && { 'aria-hidden': true, style: { opacity: 0, pointerEvents: 'none' } })}>
                {!connected ? (
                  <button
                    onClick={openConnectModal}
                    className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-1.5 rounded-lg shadow-lg font-medium text-sm transition-colors"
                  >
                    Connect
                  </button>
                ) : chain.unsupported ? (
                  <button
                    onClick={openChainModal}
                    className="bg-red-500 hover:bg-red-600 text-white px-4 py-1.5 rounded-lg shadow-lg font-medium text-sm transition-colors"
                  >
                    Wrong Network
                  </button>
                ) : (
                  <button
                    onClick={openAccountModal}
                    className="bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-lg shadow-lg text-sm font-medium text-slate-700 hover:bg-white transition-colors"
                  >
                    {walletAccount.address.slice(0, 6)}...{walletAccount.address.slice(-4)}
                  </button>
                )}
              </div>
            );
          }}
        </ConnectButton.Custom>
      </div>

      {/* Transaction Status - Show pending count for fire-and-forget */}
      {pendingCount > 0 && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-1000">
          <div className="bg-white/95 backdrop-blur-sm px-4 py-2 rounded-xl shadow-lg text-sm font-medium text-slate-700 flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span>Sending {pendingCount} tx{pendingCount > 1 ? 's' : ''}...</span>
            {recentHashes[0] && (
              <a
                href={`https://megaexplorer.xyz/tx/${recentHashes[0]}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:text-blue-600 text-xs"
              >
                View
              </a>
            )}
          </div>
        </div>
      )}

      {/* Recent Pixels Panel */}
      {showRecentPixels && (
        <div className="absolute top-16 right-4 w-72 bg-white/95 backdrop-blur-sm rounded-xl shadow-2xl z-1000 max-h-96 overflow-hidden">
          <div className="p-3 border-b border-slate-200 font-semibold text-slate-700 flex items-center justify-between">
            <span>Recent Pixels</span>
            <button onClick={() => setShowRecentPixels(false)} className="text-slate-400 hover:text-slate-600">✕</button>
          </div>
          <div className="overflow-y-auto max-h-80">
            {allPixels.slice(0, 20).map((pixel) => (
              <div
                key={`${pixel.x}-${pixel.y}-${pixel.timestamp}`}
                className="p-3 hover:bg-slate-50 cursor-pointer transition-colors flex items-center gap-3 border-b border-slate-100 last:border-0"
                onClick={() => {
                  focusOnPixel(Number(pixel.x), Number(pixel.y));
                  setShowRecentPixels(false);
                }}
              >
                <div
                  className="w-8 h-8 rounded-lg shadow-inner border border-slate-200"
                  style={{ backgroundColor: uint32ToHex(pixel.color) }}
                />
                <div>
                  <div className="text-sm font-medium text-slate-700">
                    ({Number(pixel.x)}, {Number(pixel.y)})
                  </div>
                  <div className="text-xs text-slate-400">
                    {pixel.user.slice(0, 6)}...{pixel.user.slice(-4)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bottom Toolbar */}
      <div className="absolute bottom-0 left-0 right-0 z-1000 p-4">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
            {/* Toolbar Header */}
            <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setIsToolbarExpanded(!isToolbarExpanded)}
                  className="flex items-center gap-2 text-slate-600 hover:text-slate-800 transition-colors"
                >
                  <ChevronIcon direction={isToolbarExpanded ? 'down' : 'up'} />
                </button>
                <div className="flex items-center gap-2 text-slate-700 font-medium">
                  <PaintBrushIcon />
                  <span>Paint pixel</span>
                  {selectedPixel && (
                    <span className="text-slate-400 text-sm">
                      ({selectedPixel.px}, {selectedPixel.py})
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Share Button */}
                <button
                  onClick={() => {
                    if (!selectedPixel) {
                      toast.error('Select a pixel first');
                      return;
                    }
                    const shareUrl = `${window.location.origin}?px=${selectedPixel.px}&py=${selectedPixel.py}`;
                    navigator.clipboard.writeText(shareUrl);
                    toast.success('Link copied!');
                  }}
                  className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                  title="Share location"
                >
                  <ShareIcon />
                </button>

                {/* Premium Button */}
                {!hasAccess && account.address && (
                  <button
                    onClick={() => grantPremiumAccess()}
                    disabled={isPurchasingPremium}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-linear-to-r from-amber-400 to-orange-500 text-white rounded-lg font-medium text-sm hover:from-amber-500 hover:to-orange-600 transition-all shadow-sm disabled:opacity-50"
                    title={`No cooldown for 2h - ${DEFAULT_PREMIUM_COST_ETH} ETH`}
                  >
                    <ZapIcon />
                    <span className="hidden sm:inline">Boost</span>
                  </button>
                )}
                {hasAccess && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 bg-linear-to-r from-amber-400 to-orange-500 text-white rounded-lg font-medium text-sm">
                    <ZapIcon />
                    <span className="hidden sm:inline">Boosted</span>
                  </div>
                )}
              </div>
            </div>

            {/* Color Palette */}
            {isToolbarExpanded && (
              <div className="p-4">
                {/* Two rows of 19 colors each */}
                <div className="grid grid-cols-19 gap-1.5 mb-4">
                  {PRESET_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => setSelectedColor(color)}
                      className={`aspect-square ring ring-black/50 rounded-lg transition-all hover:scale-110 relative ${selectedColor === color
                        ? 'ring-2 ring-offset-2 ring-blue-500 scale-110 z-10'
                        : 'hover:ring-2 hover:ring-slate-300'
                        }`}
                      style={{ backgroundColor: color }}
                      title={color}
                    >
                      {/* Selection checkmark */}
                      {selectedColor === color && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className={`w-3 h-3 rounded-full ${['#FFFFFF', '#C0C0C0', '#FFF8B8', '#7EED56', '#51E9F4', '#94B3FF', '#E4ABFF', '#FF99AA', '#FFB470', '#D4D7D9', '#FFCC99'].includes(color)
                            ? 'bg-slate-800'
                            : 'bg-white'
                            }`} />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Paint Button with Cooldown */}
            <div className="px-4 pb-4">
              <button
                onClick={handlePlacePixel}
                disabled={!selectedPixel || !account.address || needsFunding}
                className="w-full relative overflow-hidden bg-blue-500 hover:bg-blue-600 disabled:bg-slate-300 text-white font-semibold py-3 px-6 rounded-xl transition-all disabled:cursor-not-allowed shadow-lg hover:shadow-xl active:scale-[0.99]"
              >
                {/* Cooldown/Pixels progress bar */}
                {!hasAccess && (
                  <div
                    className="absolute inset-0 bg-blue-600 transition-all duration-300"
                    style={{ width: `${cooldownProgress}%` }}
                  />
                )}

                <div className="relative flex items-center justify-center gap-3">
                  <PaintBrushIcon />
                  <span>
                    {!account.address
                      ? 'Connect Wallet'
                      : needsFunding
                        ? 'Fund Session Key'
                        : !selectedPixel
                          ? 'Select a pixel'
                          : pendingCount > 0
                            ? `Painting (${pendingCount})...`
                            : 'Paint'
                    }
                  </span>
                  {account.address && selectedPixel && !needsFunding && (
                    <span className={`px-2 py-0.5 rounded-full text-sm ${canPlace || hasAccess ? 'bg-white/20' : 'bg-white/10'
                      }`}>
                      {cooldownDisplay}
                    </span>
                  )}
                </div>
              </button>

              {/* Help text */}
              <div className="mt-2 text-center text-xs text-slate-400">
                {needsFunding ? (
                  <span className="text-amber-500">Fund session key to paint instantly</span>
                ) : currentZoom >= PIXEL_SELECT_ZOOM ? (
                  <>
                    <span className="text-emerald-500">Click to paint instantly!</span>
                    {hasAccess && <span className="text-amber-500 ml-2">⚡ No cooldown!</span>}
                  </>
                ) : (
                  <>
                    Zoom in to paint on click • {DEFAULT_COOLDOWN_PIXELS} pixels per {DEFAULT_COOLDOWN_SECONDS}s
                    {hasAccess && <span className="text-amber-500 ml-2">⚡ No cooldown!</span>}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Faucet Link - Bottom Left */}
      <a
        href="https://docs.megaeth.com/faucet#timothy"
        target="_blank"
        rel="noopener noreferrer"
        className="absolute bottom-4 left-4 z-1000 text-white/60 hover:text-white/90 text-xs transition-colors"
      >
        Get testnet ETH →
      </a>
    </div>
  );
}
