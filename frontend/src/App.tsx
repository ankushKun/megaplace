import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { Button } from './components/ui/button';
import { useCanvas } from './hooks/useCanvas';
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

const PRESET_COLORS = [
  '#FF0000', // Red
  '#00FF00', // Green
  '#0000FF', // Blue
  '#FFFF00', // Yellow
  '#FF00FF', // Magenta
  '#00FFFF', // Cyan
  '#FFFFFF', // White
  '#000000', // Black
  '#FFA500', // Orange
  '#800080', // Purple
  '#FFC0CB', // Pink
  '#A52A2A', // Brown
];

export default function App() {
  const account = useAccount();
  const { canvasRef, selectedPixel, hoveredPixel, handlePixelPlaced, handlers, placedPixelCount, focusOnPixel } = useCanvas();
  const { canPlace, cooldownRemaining, refetch: refetchCooldown } = useCooldown();
  const { hasAccess, expiryTime } = usePremiumAccess();
  const { placePixel, isPending: isPlacingPixel } = usePlacePixel();
  const { grantPremiumAccess, isPending: isPurchasingPremium } = useGrantPremiumAccess();
  const { recentPixels } = useWatchPixelPlaced(handlePixelPlaced);

  const [selectedColor, setSelectedColor] = useState('#FF0000');
  const [customColor, setCustomColor] = useState('#FF0000');
  const [cooldownDisplay, setCooldownDisplay] = useState('');
  const [premiumTimeRemaining, setPremiumTimeRemaining] = useState('');

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

  const handlePlacePixel = async () => {
    if (!selectedPixel || !account.address) return;

    try {
      const color = hexToUint32(selectedColor);
      await placePixel(selectedPixel.x, selectedPixel.y, color);
    } catch (error) {
      console.error('Failed to place pixel:', error);
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
    <div className='flex h-screen overflow-hidden bg-black'>
      {/* Left Sidebar */}
      <div className="w-80 border-r border-white/10 flex flex-col bg-white/5 backdrop-blur-xl">
        <div className="p-4 border-b border-white/10">
          <h2 className="text-xl font-bold text-white mb-4 tracking-wide">MegaPlace</h2>

          {/* Cooldown Timer */}
          <div className="bg-white/10 backdrop-blur-md rounded-xl p-4 mb-4 border border-white/20 shadow-lg">
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
          <div className="bg-white/10 backdrop-blur-md rounded-xl p-4 border border-white/20 shadow-lg">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-semibold text-white">Premium</span>
              {hasAccess && (
                <span className="text-xs bg-white/30 px-2 py-1 rounded-full backdrop-blur-sm">Active</span>
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
                  className="w-full inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 h-9 px-4 py-2 bg-white/90 hover:bg-white text-black backdrop-blur-sm"
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
                No recent pixels
              </div>
            ) : (
              <div className="divide-y divide-white/10">
                {recentPixels.map((pixel, index) => (
                  <div
                    key={index}
                    className="p-3 hover:bg-white/5 transition-colors cursor-pointer"
                    onClick={() => focusOnPixel(Number(pixel.x), Number(pixel.y))}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-8 h-8 rounded-lg border border-white/20 shadow-md"
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

      {/* Canvas Area */}
      <div className="grow relative">
        <canvas
          ref={canvasRef}
          id="mega-canvas"
          className="w-full h-full"
          {...handlers}
        />

        {/* Pixel Info Overlay */}
        {hoveredPixel && (
          <div className="absolute top-4 left-4 bg-black/80 backdrop-blur-md text-white px-4 py-2 rounded-xl text-sm border border-white/20 shadow-lg">
            Pixel: ({hoveredPixel.x}, {hoveredPixel.y})
          </div>
        )}

        {/* Color Picker and Place Button */}
        <div className='absolute bottom-0 left-0 right-0 p-4 flex items-center justify-center'>
          <div className='bg-black/80 backdrop-blur-xl rounded-2xl p-4 shadow-2xl border border-white/20 max-w-4xl w-full'>
            <div className="flex items-center gap-4">
              {/* Preset Colors */}
              <div className="flex gap-2 flex-wrap">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    onClick={() => setSelectedColor(color)}
                    className={`w-10 h-10 rounded-lg border-2 transition-all hover:scale-110 ${selectedColor === color ? 'border-white shadow-xl shadow-white/20' : 'border-white/20'
                      }`}
                    style={{ backgroundColor: color }}
                    title={color}
                  />
                ))}
              </div>

              {/* Custom Color Picker */}
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={customColor}
                  onChange={(e) => {
                    setCustomColor(e.target.value);
                    setSelectedColor(e.target.value);
                  }}
                  className="w-10 h-10 rounded-lg cursor-pointer border border-white/20"
                />
                <span className="text-xs text-white/60">Custom</span>
              </div>

              {/* Divider */}
              <div className="h-10 w-px bg-white/20" />

              {/* Selected Pixel Info */}
              <div className="flex-1 text-sm text-white/90">
                {selectedPixel ? (
                  <div>
                    Selected: <span className="font-mono text-white">({selectedPixel.x}, {selectedPixel.y})</span>
                  </div>
                ) : (
                  <div className="text-white/40">Click a pixel to select</div>
                )}
              </div>

              {/* Place Button */}
              <button
                type="button"
                onClick={handlePlacePixel}
                disabled={!selectedPixel || !account.address || !canPlace || isPlacingPixel}
                className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-all disabled:pointer-events-none disabled:opacity-50 h-10 px-6 bg-white hover:bg-white/90 text-black backdrop-blur-sm shadow-lg"
              >
                {isPlacingPixel ? 'Placing...' : 'Place Pixel'}
              </button>
            </div>

            {/* Help Text */}
            <div className="text-xs text-white/40 mt-3 text-center">
              Use mouse wheel to zoom, drag to pan, click to select a pixel
            </div>
          </div>
        </div>
      </div>

      {/* Right Sidebar */}
      <div className="w-64 bg-white/5 backdrop-blur-xl border-l border-white/10 p-4 flex flex-col gap-4">
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
                        className="w-full inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 h-9 px-4 py-2 bg-white/90 hover:bg-white text-black backdrop-blur-sm shadow-lg border border-white/20"
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
                        className="w-full inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 h-9 px-4 py-2 bg-white/20 hover:bg-white/30 text-white backdrop-blur-sm border border-white/20"
                      >
                        Wrong network
                      </button>
                    );
                  }

                  return (
                    <button
                      type="button"
                      onClick={openAccountModal}
                      className="w-full inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 h-9 px-4 py-2 border bg-white/10 hover:bg-white/20 text-white border-white/20 backdrop-blur-sm"
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
        <div className="bg-white/10 backdrop-blur-md rounded-xl p-4 border border-white/20 shadow-lg">
          <h3 className="text-sm font-semibold text-white mb-3">How to Play</h3>
          <ul className="text-xs text-white/70 space-y-2">
            <li className="flex items-center gap-2">
              <span className="text-white/40">1.</span>
              <span>Connect your wallet</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-white/40">2.</span>
              <span>Click a pixel on the canvas</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-white/40">3.</span>
              <span>Choose a color</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-white/40">4.</span>
              <span>Place your pixel!</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-white/40">5.</span>
              <span>Wait 15s or buy premium</span>
            </li>
          </ul>
        </div>

        {/* Stats */}
        <div className="bg-white/10 backdrop-blur-md rounded-xl p-4 border border-white/20 shadow-lg">
          <h3 className="text-sm font-semibold text-white mb-3">Canvas Stats</h3>
          <div className="text-xs text-white/70 space-y-2">
            <div className="flex justify-between">
              <span className="text-white/50">Size</span>
              <span className="font-mono">1000 × 1000</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/50">Total Pixels</span>
              <span className="font-mono">1,000,000</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/50">Pixels Placed</span>
              <span className="font-mono">{placedPixelCount.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/50">Empty Pixels</span>
              <span className="font-mono">{(1000000 - placedPixelCount).toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/50">Network</span>
              <span>MegaETH</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}