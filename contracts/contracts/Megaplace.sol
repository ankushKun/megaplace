// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "@openzeppelin/contracts/access/Ownable2Step.sol";

contract Megaplace is Ownable2Step {
    // Custom errors (saves ~50 gas per revert vs string messages)
    error InvalidCoordinates(uint256 px, uint256 py);
    error RateLimitExceeded(uint256 cooldownRemaining);
    error ArrayLengthMismatch();
    error InvalidBatchSize(uint256 size, uint256 min, uint256 max);
    error IncorrectPaymentAmount(uint256 sent, uint256 required);
    error WithdrawFailed();
    error RegionTooLarge(uint256 size, uint256 maxSize);
    error RegionOutOfBounds();
    error InvalidDimensions();

    // Optimized struct to fit in 1 storage slot (32 bytes)
    // This saves 1 SLOAD per pixel read = ~2100 gas saved per read
    struct Pixel {
        uint32 color; // RGB color (4 bytes)
        address placedBy; // Owner of the pixel (20 bytes)
        uint64 timestamp; // When placed (8 bytes) - valid until year 2554
    }

    // Web Mercator projected canvas with CANVAS_RES = 2^20 (~1 million pixels per dimension)
    // This gives us ~1 trillion total pixels mapped to Earth's surface
    // Coordinates are global pixel positions in mercator projection
    uint256 public constant CANVAS_RES = 1048576; // 2^20
    uint256 public constant TILE_SIZE = 512; // Standard tile size
    uint256 public constant MAX_REGION_SIZE = 10000; // Maximum pixels in a region query

    // Configurable rate limit (default 5 seconds cooldown after 15 pixels)
    uint64 public rateLimitSeconds = 5;
    uint64 public rateLimitPixels = 15;

    // Premium access cost (default 0.01 ETH)
    uint256 public premiumCost = 0.01 ether;

    // Premium access duration (default 2 hours)
    uint64 public premiumDuration = 2 hours;

    // use a mapping of uint256 to Pixel to save gas
    // index = px + py * CANVAS_RES
    mapping(uint256 => Pixel) public canvas;

    // addresses to timestamp of last cooldown start for rate limits
    mapping(address => uint64) public lastCooldownStart;

    // addresses to count of pixels placed since last cooldown
    mapping(address => uint64) public pixelsPlacedSinceCooldown;

    // mapping of address to timestamp for premium access
    mapping(address => uint64) public premiumAccess;

    // Events
    event PixelPlaced(
        address indexed user,
        uint256 x,
        uint256 y,
        uint32 color,
        uint256 timestamp
    );
    event PixelsBatchPlaced(
        address indexed user,
        uint256 count,
        uint256 timestamp
    );
    event PremiumAccessGranted(
        address indexed user,
        uint64 expiryTime,
        uint256 amountPaid
    );
    event RateLimitUpdated(uint64 oldLimit, uint64 newLimit);
    event RateLimitPixelsUpdated(uint64 oldLimit, uint64 newLimit);
    event PremiumCostUpdated(uint256 oldCost, uint256 newCost);
    event PremiumDurationUpdated(uint64 oldDuration, uint64 newDuration);

    constructor() Ownable(msg.sender) {}

    /**
     * @dev Place a pixel on the canvas using Web Mercator global coordinates
     * @param px The global x coordinate (0 to CANVAS_RES-1)
     * @param py The global y coordinate (0 to CANVAS_RES-1)
     * @param color The RGB color of the pixel
     */
    function placePixel(uint256 px, uint256 py, uint32 color) public {
        if (px >= CANVAS_RES || py >= CANVAS_RES) {
            revert InvalidCoordinates(px, py);
        }

        // Cache timestamp to avoid multiple block.timestamp calls
        uint64 currentTime = uint64(block.timestamp);

        // Cache premium expiry (1 SLOAD instead of checking in conditional)
        uint64 userPremiumExpiry = premiumAccess[msg.sender];

        // Rate limit for regular users: 5 seconds per 15 pixels
        if (currentTime > userPremiumExpiry) {
            uint64 lastCooldown = lastCooldownStart[msg.sender];
            uint64 pixelsPlaced = pixelsPlacedSinceCooldown[msg.sender];

            // Check if cooldown has expired (reset counter)
            if (currentTime >= lastCooldown + rateLimitSeconds) {
                pixelsPlaced = 0;
            }

            // Check if user has hit the pixel limit
            if (pixelsPlaced >= rateLimitPixels) {
                uint64 nextAvailable = lastCooldown + rateLimitSeconds;
                if (currentTime < nextAvailable) {
                    revert RateLimitExceeded(nextAvailable - currentTime);
                }
                // Cooldown expired, reset
                pixelsPlaced = 0;
            }

            // Update counter
            unchecked {
                pixelsPlacedSinceCooldown[msg.sender] = pixelsPlaced + 1;
            }

            // Start cooldown timer when first pixel is placed in a new period
            if (pixelsPlaced == 0) {
                lastCooldownStart[msg.sender] = currentTime;
            }
        }

        // Calculate index using unchecked (overflow check done above)
        uint256 index;
        unchecked {
            index = px + py * CANVAS_RES;
        }

        // If color is 0 (black), store as 0x010101 to distinguish from unplaced pixels
        uint32 storedColor = color == 0 ? 0x010101 : color;

        // Store pixel data
        canvas[index] = Pixel(storedColor, msg.sender, currentTime);

        emit PixelPlaced(msg.sender, px, py, storedColor, currentTime);
    }

    /**
     * @dev Place multiple pixels at once (batch operation)
     * @param px Array of x coordinates
     * @param py Array of y coordinates
     * @param colors Array of colors
     */
    function placePixelBatch(
        uint256[] calldata px,
        uint256[] calldata py,
        uint32[] calldata colors
    ) public {
        uint256 length = px.length;
        if (length != py.length || length != colors.length) {
            revert ArrayLengthMismatch();
        }
        if (length == 0 || length > 100) {
            revert InvalidBatchSize(length, 1, 100);
        }

        uint64 currentTime = uint64(block.timestamp);
        uint64 userPremiumExpiry = premiumAccess[msg.sender];

        // Rate limit for regular users: 5 seconds per 15 pixels
        if (currentTime > userPremiumExpiry) {
            uint64 lastCooldown = lastCooldownStart[msg.sender];
            uint64 pixelsPlaced = pixelsPlacedSinceCooldown[msg.sender];

            // Check if cooldown has expired (reset counter)
            if (currentTime >= lastCooldown + rateLimitSeconds) {
                pixelsPlaced = 0;
            }

            // Check if batch would exceed limit
            if (pixelsPlaced + uint64(length) > rateLimitPixels) {
                // If already at limit, check cooldown
                if (pixelsPlaced >= rateLimitPixels) {
                    uint64 nextAvailable = lastCooldown + rateLimitSeconds;
                    if (currentTime < nextAvailable) {
                        revert RateLimitExceeded(nextAvailable - currentTime);
                    }
                    pixelsPlaced = 0;
                } else {
                    // Can place some but not all - revert with remaining capacity
                    revert InvalidBatchSize(
                        length,
                        1,
                        rateLimitPixels - pixelsPlaced
                    );
                }
            }

            // Update counter
            unchecked {
                pixelsPlacedSinceCooldown[msg.sender] =
                    pixelsPlaced +
                    uint64(length);
            }

            // Start cooldown timer when first pixel is placed in a new period
            if (pixelsPlaced == 0) {
                lastCooldownStart[msg.sender] = currentTime;
            }
        }

        // Place all pixels
        for (uint256 i = 0; i < length; ) {
            if (px[i] >= CANVAS_RES || py[i] >= CANVAS_RES) {
                revert InvalidCoordinates(px[i], py[i]);
            }

            uint256 index;
            unchecked {
                index = px[i] + py[i] * CANVAS_RES;
                i++;
            }

            // If color is 0 (black), store as 0x010101 to distinguish from unplaced pixels
            uint32 storedColor = colors[i - 1] == 0 ? 0x010101 : colors[i - 1];

            canvas[index] = Pixel(storedColor, msg.sender, currentTime);
            emit PixelPlaced(
                msg.sender,
                px[i - 1],
                py[i - 1],
                storedColor,
                currentTime
            );
        }

        emit PixelsBatchPlaced(msg.sender, length, currentTime);
    }

    /**
     * @dev Grant premium access to caller
     * Costs premiumCost ETH for premiumDuration
     */
    function grantPremiumAccess() external payable {
        if (msg.value != premiumCost) {
            revert IncorrectPaymentAmount(msg.value, premiumCost);
        }

        uint64 expiryTime;
        unchecked {
            expiryTime = uint64(block.timestamp + premiumDuration);
        }
        premiumAccess[msg.sender] = expiryTime;

        emit PremiumAccessGranted(msg.sender, expiryTime, msg.value);
    }

    /**
     * @dev Owner-only function to grant free premium access
     * @param user Address to grant premium access to
     */
    function adminGrantPremiumAccess(address user) external onlyOwner {
        uint64 expiryTime;
        unchecked {
            expiryTime = uint64(block.timestamp + premiumDuration);
        }
        premiumAccess[user] = expiryTime;

        emit PremiumAccessGranted(user, expiryTime, 0);
    }

    /**
     * @dev Owner-only function to grant premium access to multiple users at once
     * @param users Array of addresses to grant premium access to
     */
    function adminGrantPremiumAccessBatch(
        address[] calldata users
    ) external onlyOwner {
        uint64 expiryTime = uint64(block.timestamp + premiumDuration);
        uint256 length = users.length;

        for (uint256 i = 0; i < length; ) {
            premiumAccess[users[i]] = expiryTime;
            emit PremiumAccessGranted(users[i], expiryTime, 0);
            unchecked {
                i++;
            }
        }
    }

    /**
     * @dev Owner-only function to update the rate limit cooldown
     * @param newLimit New rate limit in seconds
     */
    function setRateLimitSeconds(uint64 newLimit) external onlyOwner {
        uint64 oldLimit = rateLimitSeconds;
        rateLimitSeconds = newLimit;
        emit RateLimitUpdated(oldLimit, newLimit);
    }

    /**
     * @dev Owner-only function to update the rate limit pixel count
     * @param newLimit New rate limit pixel count
     */
    function setRateLimitPixels(uint64 newLimit) external onlyOwner {
        uint64 oldLimit = rateLimitPixels;
        rateLimitPixels = newLimit;
        emit RateLimitPixelsUpdated(oldLimit, newLimit);
    }

    /**
     * @dev Owner-only function to update the premium cost
     * @param newCost New premium cost in wei
     */
    function setPremiumCost(uint256 newCost) external onlyOwner {
        uint256 oldCost = premiumCost;
        premiumCost = newCost;
        emit PremiumCostUpdated(oldCost, newCost);
    }

    /**
     * @dev Owner-only function to update the premium duration
     * @param newDuration New premium duration in seconds
     */
    function setPremiumDuration(uint64 newDuration) external onlyOwner {
        uint64 oldDuration = premiumDuration;
        premiumDuration = newDuration;
        emit PremiumDurationUpdated(oldDuration, newDuration);
    }

    /**
     * @dev Owner-only function to withdraw ETH from contract
     */
    function withdraw() external onlyOwner {
        // Use call instead of transfer for better gas handling
        (bool success, ) = payable(owner()).call{value: address(this).balance}(
            ""
        );
        if (!success) {
            revert WithdrawFailed();
        }
    }

    // Fallback function to accept ETH
    receive() external payable {}

    /**
     * @dev Get pixel data at coordinates (px, py)
     * @param px The global x coordinate
     * @param py The global y coordinate
     * @return color The RGB color of the pixel
     * @return placedBy The address that placed the pixel
     * @return timestamp When the pixel was placed
     */
    function getPixel(
        uint256 px,
        uint256 py
    )
        external
        view
        returns (uint32 color, address placedBy, uint256 timestamp)
    {
        if (px >= CANVAS_RES || py >= CANVAS_RES) {
            revert InvalidCoordinates(px, py);
        }

        uint256 index;
        unchecked {
            index = px + py * CANVAS_RES;
        }

        Pixel memory p = canvas[index];
        return (p.color, p.placedBy, p.timestamp);
    }

    /**
     * @dev Get multiple pixels at once (batch read)
     * @param px Array of x coordinates
     * @param py Array of y coordinates
     * @return colors Array of colors
     * @return placedByAddresses Array of addresses that placed each pixel
     * @return timestamps Array of timestamps when pixels were placed
     */
    function getPixelBatch(
        uint256[] calldata px,
        uint256[] calldata py
    )
        external
        view
        returns (
            uint32[] memory colors,
            address[] memory placedByAddresses,
            uint64[] memory timestamps
        )
    {
        uint256 length = px.length;
        if (length != py.length) {
            revert ArrayLengthMismatch();
        }
        if (length == 0 || length > 1000) {
            revert InvalidBatchSize(length, 1, 1000);
        }

        colors = new uint32[](length);
        placedByAddresses = new address[](length);
        timestamps = new uint64[](length);

        for (uint256 i = 0; i < length; ) {
            if (px[i] >= CANVAS_RES || py[i] >= CANVAS_RES) {
                revert InvalidCoordinates(px[i], py[i]);
            }

            uint256 index;
            unchecked {
                index = px[i] + py[i] * CANVAS_RES;
            }

            Pixel memory p = canvas[index];
            colors[i] = p.color;
            placedByAddresses[i] = p.placedBy;
            timestamps[i] = p.timestamp;

            unchecked {
                i++;
            }
        }

        return (colors, placedByAddresses, timestamps);
    }

    /**
     * @dev Get a rectangular region of pixels (tile)
     * @param startPx Starting x coordinate
     * @param startPy Starting y coordinate
     * @param width Width of the region
     * @param height Height of the region
     * @return colors Array of colors in row-major order
     */
    function getRegion(
        uint256 startPx,
        uint256 startPy,
        uint256 width,
        uint256 height
    ) external view returns (uint32[] memory colors) {
        if (startPx >= CANVAS_RES || startPy >= CANVAS_RES) {
            revert InvalidCoordinates(startPx, startPy);
        }
        if (startPx + width > CANVAS_RES || startPy + height > CANVAS_RES) {
            revert RegionOutOfBounds();
        }
        if (width == 0 || height == 0) {
            revert InvalidDimensions();
        }

        uint256 totalPixels = width * height;
        if (totalPixels > MAX_REGION_SIZE) {
            revert RegionTooLarge(totalPixels, MAX_REGION_SIZE);
        }

        colors = new uint32[](totalPixels);

        uint256 arrayIndex = 0;
        for (uint256 dy = 0; dy < height; ) {
            for (uint256 dx = 0; dx < width; ) {
                uint256 canvasIndex;
                unchecked {
                    canvasIndex = (startPx + dx) + (startPy + dy) * CANVAS_RES;
                }

                colors[arrayIndex] = canvas[canvasIndex].color;

                unchecked {
                    dx++;
                    arrayIndex++;
                }
            }
            unchecked {
                dy++;
            }
        }

        return colors;
    }

    /**
     * @dev Check if a user has premium access
     * @param user The address to check
     * @return hasAccess Whether the user currently has premium access
     * @return expiryTime When the premium access expires (0 if no access)
     */
    function hasPremiumAccess(
        address user
    ) external view returns (bool hasAccess, uint256 expiryTime) {
        uint64 expiry = premiumAccess[user];
        return (block.timestamp <= expiry, expiry);
    }

    /**
     * @dev Get time until user can place next pixel
     * @param user The address to check
     * @return canPlace Whether the user can place a pixel now
     * @return cooldownRemaining Seconds remaining until user can place (0 if can place now)
     * @return pixelsRemaining How many more pixels can be placed before cooldown
     */
    function getCooldown(
        address user
    )
        external
        view
        returns (
            bool canPlace,
            uint256 cooldownRemaining,
            uint256 pixelsRemaining
        )
    {
        uint64 currentTime = uint64(block.timestamp);
        uint64 userPremiumExpiry = premiumAccess[user];

        // Premium users have no cooldown
        if (currentTime <= userPremiumExpiry) {
            return (true, 0, rateLimitPixels);
        }

        uint64 lastCooldown = lastCooldownStart[user];
        uint64 pixelsPlaced = pixelsPlacedSinceCooldown[user];

        // Check if cooldown has expired (reset counter)
        if (currentTime >= lastCooldown + rateLimitSeconds) {
            return (true, 0, rateLimitPixels);
        }

        // Check if user has hit the pixel limit
        if (pixelsPlaced >= rateLimitPixels) {
            uint64 nextAvailable = lastCooldown + rateLimitSeconds;
            return (false, nextAvailable - currentTime, 0);
        }

        // User can still place pixels
        return (true, 0, rateLimitPixels - pixelsPlaced);
    }

    /**
     * @dev Get current configuration
     * @return _rateLimitSeconds Current rate limit cooldown in seconds
     * @return _rateLimitPixels Current rate limit pixels per cooldown period
     * @return _premiumCost Current premium cost in wei
     * @return _premiumDuration Current premium duration in seconds
     */
    function getConfig()
        external
        view
        returns (
            uint64 _rateLimitSeconds,
            uint64 _rateLimitPixels,
            uint256 _premiumCost,
            uint64 _premiumDuration
        )
    {
        return (
            rateLimitSeconds,
            rateLimitPixels,
            premiumCost,
            premiumDuration
        );
    }
}
