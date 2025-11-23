import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { useRef, useCallback } from 'react';
import { Button } from './components/ui/button';
import { useMap } from './hooks/useMap';
import {
  useCooldown,
  usePremiumAccess,
  usePlacePixel,
  useGrantPremiumAccess,
  useWatchPixelPlaced,
  hexToUint32,
  uint32ToHex
} from './hooks/useMegaplace';
import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { Map as LeafletMap } from 'leaflet';
import { toast } from 'sonner';

const PRESET_COLORS = [
  '#000000', // Black
  '#FF0000', // Red
  '#00FF00', // Green
  '#0000FF', // Blue
  '#FFFF00', // Yellow
  '#FF00FF', // Magenta
  '#00FFFF', // Cyan
  '#FFFFFF', // White
  '#FFA500', // Orange
  '#800080', // Purple
  '#FFC0CB', // Pink
  '#A52A2A', // Brown
];

// Component to handle map events
function MapEventsHandler({ onMapClick, onMapReady, onMoveEnd, onMouseMove, onMouseOut }: {
  onMapClick: (lat: number, lng: number) => void;
  onMapReady: (map: LeafletMap) => void;
  onMoveEnd: () => void;
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
  });

  useEffect(() => {
    onMapReady(map);
  }, [map, onMapReady]);

  return null;
}

export default function App() {
  const account = useAccount();
  const { mapRef, selectedPixel, hoveredPixel, handlePixelPlaced, placedPixelCount, focusOnPixel, loadVisibleTiles, handleMapClick, handleMapHover, handleMapHoverOut, loadInitialTiles, getSelectedPixelColor, updateSelectedHighlightColor } = useMap();

  // Throttle map movement to prevent RPC spam
  const lastMoveTimeRef = useRef<number>(0);
  const throttledLoadVisibleTiles = useCallback(() => {
    const now = Date.now();
    if (now - lastMoveTimeRef.current < 500) return; // Throttle to max once per 500ms
    lastMoveTimeRef.current = now;
    loadVisibleTiles();
  }, [loadVisibleTiles]);
  const { canPlace, cooldownRemaining, refetch: refetchCooldown } = useCooldown();
  const { hasAccess, expiryTime } = usePremiumAccess();
  const { placePixel, isPending: isPlacingPixel, isConfirmed: isPixelPlaced, hash: pixelHash } = usePlacePixel();
  const { grantPremiumAccess, isPending: isPurchasingPremium } = useGrantPremiumAccess();
  const { recentPixels } = useWatchPixelPlaced(handlePixelPlaced);

  const [selectedColor, setSelectedColor] = useState('#000000');
  const [customColor, setCustomColor] = useState('#000000');
  const [lastPlacedPixel, setLastPlacedPixel] = useState<{ px: number; py: number } | null>(null);
  const [cooldownDisplay, setCooldownDisplay] = useState('');
  const [premiumTimeRemaining, setPremiumTimeRemaining] = useState('');

  // Navigate to pixel from URL parameters on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pxParam = params.get('px');
    const pyParam = params.get('py');

    if (pxParam && pyParam) {
      const px = parseInt(pxParam, 10);
      const py = parseInt(pyParam, 10);

      if (!isNaN(px) && !isNaN(py)) {
        // Wait a bit for map to initialize
        setTimeout(() => {
          focusOnPixel(px, py);
        }, 500);
      }
    }
  }, [focusOnPixel]);

  // Update selected pixel highlight when color changes
  useEffect(() => {
    if (selectedPixel) {
      updateSelectedHighlightColor(selectedColor);
    }
  }, [selectedColor, selectedPixel, updateSelectedHighlightColor]);

  // Update cooldown display every second
  useEffect(() => {
    const interval = setInterval(() => {
      if (cooldownRemaining > 0n) {
        const seconds = Number(cooldownRemaining);
        setCooldownDisplay(`${seconds}s`);
      } else {
        setCooldownDisplay('Ready!');
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [cooldownRemaining]);

  // Refetch cooldown when it expires
  useEffect(() => {
    if (cooldownRemaining > 0n) {
      const timeout = setTimeout(() => {
        refetchCooldown();
      }, Number(cooldownRemaining) * 1000);
      return () => clearTimeout(timeout);
    }
  }, [cooldownRemaining, refetchCooldown]);

  // Update premium time remaining display every second
  useEffect(() => {
    const updatePremiumDisplay = () => {
      if (hasAccess && expiryTime > 0n) {
        const now = Math.floor(Date.now() / 1000);
        const expiry = Number(expiryTime);
        const remaining = expiry - now;

        if (remaining > 0) {
          const hours = Math.floor(remaining / 3600);
          const minutes = Math.floor((remaining % 3600) / 60);
          const seconds = remaining % 60;

          if (hours > 0) {
            setPremiumTimeRemaining(`${hours}h ${minutes}m ${seconds}s remaining`);
          } else if (minutes > 0) {
            setPremiumTimeRemaining(`${minutes}m ${seconds}s remaining`);
          } else {
            setPremiumTimeRemaining(`${seconds}s remaining`);
          }
        } else {
          setPremiumTimeRemaining('Expired');
        }
      }
    };

    if (hasAccess) {
      updatePremiumDisplay();
      const interval = setInterval(updatePremiumDisplay, 1000);
      return () => clearInterval(interval);
    }
  }, [hasAccess, expiryTime]);

  // Show success toast when transaction is confirmed
  useEffect(() => {
    if (isPixelPlaced && lastPlacedPixel) {
      toast.success('Pixel placed successfully!', {
        description: `Placed at (${lastPlacedPixel.px}, ${lastPlacedPixel.py})`,
      });
      setLastPlacedPixel(null); // Reset to avoid showing toast again
    }
  }, [isPixelPlaced, lastPlacedPixel]);

  const handlePlacePixel = async () => {
    if (!selectedPixel || !account.address) return;

    try {
      const color = hexToUint32(selectedColor);
      console.log(`Placing pixel at (${selectedPixel.px}, ${selectedPixel.py}) with color ${color}`);

      // Store the pixel coordinates for the success toast
      setLastPlacedPixel({ px: selectedPixel.px, py: selectedPixel.py });

      // Optimistically update the UI immediately
      handlePixelPlaced({
        user: account.address,
        x: BigInt(selectedPixel.px),
        y: BigInt(selectedPixel.py),
        color: color,
        timestamp: BigInt(Math.floor(Date.now() / 1000)),
      });

      // Zoom to the pixel to make it visible (if not already zoomed in enough)
      if (mapRef.current) {
        const currentZoom = mapRef.current.getZoom();
        if (currentZoom < 18) {
          focusOnPixel(selectedPixel.px, selectedPixel.py, 18);
        }
      }

      await placePixel(selectedPixel.px, selectedPixel.py, color);
    } catch (error) {
      console.error('Failed to place pixel:', error);
      setLastPlacedPixel(null); // Reset on error
      toast.error('Failed to place pixel', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  const handlePurchasePremium = async () => {
    try {
      await grantPremiumAccess();
    } catch (error) {
      console.error('Failed to purchase premium:', error);
    }
  };

  const formatTime = (timestamp: bigint) => {
    const date = new Date(Number(timestamp) * 1000);
    return date.toLocaleTimeString();
  };

  return (
    <div className='flex h-screen overflow-hidden bg-linear-to-br from-black via-zinc-950 to-black'>
      {/* Left Sidebar */}
      <div className="w-80 border-r border-white/10 flex flex-col bg-white/3 backdrop-blur-sm">
        <div className="p-4 border-b border-white/10 bg-linear-to-b from-white/5 to-transparent">
          <h2 className="text-xl font-bold text-white mb-4 tracking-wide">MegaPlace</h2>

          {/* Cooldown Timer */}
          <div className="bg-linear-to-br from-white/15 to-white/5 backdrop-blur-sm rounded-2xl p-4 mb-4 border border-white/20 shadow-2xl shadow-black/50">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-white/70">Cooldown</span>
              <span className={`text-lg font-bold ${canPlace ? 'text-white' : 'text-white/50'}`}>
                {cooldownDisplay}
              </span>
            </div>
            {!hasAccess && (
              <div className="text-xs text-white/50">
                15s cooldown between pixels
              </div>
            )}
          </div>

          {/* Premium Access */}
          <div className="bg-linear-to-br from-white/15 to-white/5 backdrop-blur-sm rounded-2xl p-4 border border-white/20 shadow-2xl shadow-black/50">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-semibold text-white">Premium</span>
              {hasAccess && (
                <span className="text-xs bg-linear-to-r from-white/30 to-white/20 px-3 py-1 rounded-full backdrop-blur-sm border border-white/30 shadow-lg">Active</span>
              )}
            </div>
            {hasAccess ? (
              <div className="space-y-1">
                <div className="text-xs text-white/70">
                  No cooldown!
                </div>
                <div className="text-sm font-mono text-white">
                  {premiumTimeRemaining}
                </div>
              </div>
            ) : (
              <>
                <div className="text-xs text-white/70 mb-2">
                  No cooldown for 2 hours
                </div>
                <button
                  type="button"
                  onClick={handlePurchasePremium}
                  disabled={!account.address || isPurchasingPremium}
                  className="w-full inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 h-9 px-4 py-2 bg-linear-to-r from-white/95 to-white/90 hover:from-white hover:to-white/95 text-black backdrop-blur-sm shadow-xl shadow-white/10 border border-white/20"
                >
                  {isPurchasingPremium ? 'Purchasing...' : 'Buy for 0.01 ETH'}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Recent Pixels */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-white/10">
            <h3 className="text-sm font-semibold text-white/90">Recent Pixels</h3>
          </div>
          <div className="flex-1 overflow-y-auto">
            {recentPixels.length === 0 ? (
              <div className="p-4 text-center text-white/30 text-sm">
                No pixels placed recently.
              </div>
            ) : (
              <div className="divide-y divide-white/10">
                {recentPixels.map((pixel, index) => (
                  <div
                    key={index}
                    className="p-3 hover:bg-white/8 transition-all duration-200 cursor-pointer backdrop-blur-sm"
                    onClick={() => focusOnPixel(Number(pixel.x), Number(pixel.y))}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-8 h-8 rounded-lg border border-white/30 shadow-xl backdrop-blur-sm"
                        style={{ backgroundColor: uint32ToHex(pixel.color) }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-white/60">
                          ({Number(pixel.x)}, {Number(pixel.y)})
                        </div>
                        <div className="text-xs text-white/40 truncate">
                          {pixel.user.slice(0, 6)}...{pixel.user.slice(-4)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Map Area */}
      <div className="grow relative">
        <MapContainer
          center={[37.757, -122.4376]}
          zoom={7}
          minZoom={5}
          maxZoom={20}
          className="w-full h-full cursor-default"
          zoomControl={true}
          worldCopyJump={false}
          maxBounds={[[-90, -180], [90, 180]]}
          maxBoundsViscosity={1.0}
          attributionControl={false}
          scrollWheelZoom={true}
          easeLinearity={0.25}
        >
          <TileLayer
            attribution='<a href="https://www.openstreetmap.org">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            noWrap={true}
          />
          <MapEventsHandler
            onMapClick={(lat, lng) => handleMapClick(lat, lng, selectedColor)}
            onMapReady={(map) => {
              mapRef.current = map;
              loadInitialTiles();
            }}
            onMoveEnd={throttledLoadVisibleTiles}
            onMouseMove={(lat, lng) => handleMapHover(lat, lng, selectedColor)}
            onMouseOut={handleMapHoverOut}
          />
        </MapContainer>

        {/* Position Display - Top Right */}
        {hoveredPixel && (
          <div className="absolute top-4 right-4 bg-linear-to-br from-black/70 to-black/50 backdrop-blur-sm text-white px-4 py-2 rounded-2xl text-sm border border-white/30 shadow-2xl shadow-black/50">
            <div className="font-mono">
              <span className="text-white/70">X:</span> <span className="text-white font-semibold">{hoveredPixel.px}</span>
              <span className="text-white/40 mx-2">|</span>
              <span className="text-white/70">Y:</span> <span className="text-white font-semibold">{hoveredPixel.py}</span>
            </div>
          </div>
        )}

        {/* Color Picker and Place Button */}
        <div className='absolute bottom-0 left-0 right-0 p-4 flex items-center justify-center'>
          <div className='bg-linear-to-t from-black/80 via-black/70 to-black/60 backdrop-blur-sm rounded-3xl p-5 shadow-2xl border border-white/30 max-w-4xl w-full'>
            <div className="flex items-center gap-4">
              {/* Preset Colors */}
              <div className="flex gap-2 flex-wrap">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    onClick={() => setSelectedColor(color)}
                    className={`w-10 h-10 border-2 transition-all hover:scale-110 backdrop-blur-sm ${selectedColor === color ? 'border-white shadow-2xl shadow-white/30 ring-2 ring-white/20 ring-offset-2 ring-offset-black/50' : 'border-white/30 hover:border-white/50'
                      }`}
                    style={{ backgroundColor: color }}
                    title={color}
                  />
                ))}
              </div>

              {/* Custom Color Picker */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-white/60"> or custom</span>
                <input
                  type="color"
                  value={customColor}
                  onChange={(e) => {
                    setCustomColor(e.target.value);
                    setSelectedColor(e.target.value);
                  }}
                  className="w-10 h-10 cursor-pointer border-2 border-white/30 hover:border-white/50 transition-all shadow-lg backdrop-blur-sm"
                />
              </div>

              {/* Divider */}
              <div className="h-10 w-px bg-white/20" />

              {/* Place Button */}
              <button
                type="button"
                onClick={handlePlacePixel}
                disabled={!selectedPixel || !account.address || !canPlace || isPlacingPixel}
                className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-all disabled:pointer-events-none disabled:opacity-50 h-10 px-6 bg-linear-to-r from-white via-white to-white/95 hover:from-white hover:via-white/95 hover:to-white/90 text-black backdrop-blur-sm shadow-2xl shadow-white/20 border border-white/30"
              >
                {isPlacingPixel ? 'Placing...' : canPlace ? 'Place Pixel' : `Wait ${cooldownDisplay}`}
              </button>
            </div>

            {/* Help Text */}
            <div className="text-xs text-white/40 mt-3 text-center">
              Click anywhere on the map to select a location, zoom and pan to explore
            </div>
          </div>
        </div>
      </div>

      {/* Right Sidebar */}
      <div className="w-64 bg-white/3 backdrop-blur-sm border-l border-white/10 p-4 flex flex-col gap-4">
        {/* Connect Button */}
        <ConnectButton.Custom>
          {({ account: walletAccount, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
            const ready = mounted;
            const connected = ready && walletAccount && chain;

            return (
              <div
                {...(!ready && {
                  'aria-hidden': true,
                  style: {
                    opacity: 0,
                    pointerEvents: 'none',
                    userSelect: 'none',
                  },
                })}
              >
                {(() => {
                  if (!connected) {
                    return (
                      <button
                        type="button"
                        onClick={openConnectModal}
                        className="w-full inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 h-9 px-4 py-2 bg-linear-to-r from-white/95 to-white/90 hover:from-white hover:to-white/95 text-black backdrop-blur-sm shadow-xl shadow-white/10 border border-white/30"
                      >
                        Connect Wallet
                      </button>
                    );
                  }

                  if (chain.unsupported) {
                    return (
                      <button
                        type="button"
                        onClick={openChainModal}
                        className="w-full inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 h-9 px-4 py-2 bg-linear-to-r from-white/20 to-white/15 hover:from-white/30 hover:to-white/25 text-white backdrop-blur-sm border border-white/30 shadow-xl shadow-black/50"
                      >
                        Wrong network
                      </button>
                    );
                  }

                  return (
                    <button
                      type="button"
                      onClick={openAccountModal}
                      className="w-full inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 h-9 px-4 py-2 border bg-linear-to-r from-white/12 to-white/8 hover:from-white/18 hover:to-white/12 text-white border-white/30 backdrop-blur-sm shadow-lg"
                    >
                      {walletAccount.address.slice(0, 6)}...{walletAccount.address.slice(-4)}
                    </button>
                  );
                })()}
              </div>
            );
          }}
        </ConnectButton.Custom>

        {/* Instructions */}
        <div className="bg-linear-to-br from-white/15 to-white/5 backdrop-blur-sm rounded-2xl p-4 border border-white/20 shadow-2xl shadow-black/50">
          <h3 className="text-sm font-semibold text-white mb-3">How to Play</h3>
          <ul className="text-xs text-white/70 space-y-2">
            <li className="flex items-center gap-2">
              <span className="text-white/40">1.</span>
              <span>Click a pixel on the canvas</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-white/40">2.</span>
              <span>Choose a color</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-white/40">3.</span>
              <span>Place your pixel!</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-white/40">4.</span>
              <span>Wait 15s or buy premium</span>
            </li>
          </ul>
        </div>

        {/* Stats */}
        <div className="bg-linear-to-br from-white/15 to-white/5 backdrop-blur-sm rounded-2xl p-4 border border-white/20 shadow-2xl shadow-black/50">
          <h3 className="text-sm font-semibold text-white mb-3">Canvas Stats</h3>
          <div className="text-xs text-white/70 space-y-2">
            <div className="flex justify-between">
              <span className="text-white/50">Size</span>
              <span className="font-mono">1,048,576 × 1,048,576</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/50">Total Pixels</span>
              <span className="font-mono">~1.1 trillion</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/50">Pixels Placed</span>
              <span className="font-mono">{placedPixelCount.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/50">Network</span>
              <span>MegaETH</span>
            </div>
          </div>
        </div>
        <Button disabled={!selectedPixel} onClick={() => {
          if (!selectedPixel) return;
          const shareUrl = `${window.location.origin}?px=${selectedPixel.px}&py=${selectedPixel.py}`;
          navigator.clipboard.writeText(shareUrl);
          toast.success('Shareable link copied to clipboard!');
        }}>
          Share selected
        </Button>
      </div>
    </div>
  );
}