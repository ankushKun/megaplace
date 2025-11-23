// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

contract Megaplace {
    address public owner;

    // Optimized struct to fit in 1 storage slot (32 bytes)
    // This saves 1 SLOAD per pixel read = ~2100 gas saved per read
    struct pixel {
        uint32 color;        // RGB color (4 bytes)
        address placedBy;    // Owner of the pixel (20 bytes)
        uint64 timestamp;    // When placed (8 bytes) - valid until year 2554
    }

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Ownable: caller is not the owner");
        _;
    }

    // 1000x1000 2D canvas
    // use a mapping of uint256 to pixel to save gas
    mapping(uint256 => pixel) public canvas;

    // addresses to timestamp of last pixel placed for rate limits
    mapping(address => uint64) public lastPlaced;

    // mapping of address to timestamp for premium access
    // premium access = 0.01 ETH for 2 hours of no rate limits
    mapping(address => uint64) public premiumAccess;

    // Events
    event PixelPlaced(address indexed user, uint256 x, uint256 y, uint32 color, uint256 timestamp);
    event PixelsBatchPlaced(address indexed user, uint256 count, uint256 timestamp);

    /**
     * @dev Place a pixel on the canvas
     * @param x The x coordinate (0-999)
     * @param y The y coordinate (0-999)
     * @param color The RGB color of the pixel
     */
    function placePixel(uint256 x, uint256 y, uint32 color) public {
        require(x < 1000 && y < 1000, "Megaplace: invalid coordinates");

        // Cache timestamp to avoid multiple block.timestamp calls
        uint64 currentTime = uint64(block.timestamp);

        // Cache premium expiry (1 SLOAD instead of checking in conditional)
        uint64 userPremiumExpiry = premiumAccess[msg.sender];

        // Rate limit: 1 pixel per 15 seconds for regular users
        if (currentTime > userPremiumExpiry) {
            uint64 lastTime = lastPlaced[msg.sender];
            require(currentTime >= lastTime + 15, "Megaplace: rate limit exceeded");
        }

        // Calculate index using unchecked (x and y are < 1000, so no overflow possible)
        uint256 index;
        unchecked {
            index = x + y * 1000;
        }

        // If color is 0 (black), store as 0x010101 to distinguish from unplaced pixels
        uint32 storedColor = color == 0 ? 0x010101 : color;

        // Store pixel data
        canvas[index] = pixel(storedColor, msg.sender, currentTime);
        lastPlaced[msg.sender] = currentTime;

        emit PixelPlaced(msg.sender, x, y, storedColor, currentTime);
    }

    /**
     * @dev Place multiple pixels at once (batch operation)
     * @param x Array of x coordinates
     * @param y Array of y coordinates
     * @param colors Array of colors
     */
    function placePixelBatch(
        uint256[] calldata x,
        uint256[] calldata y,
        uint32[] calldata colors
    ) public {
        uint256 length = x.length;
        require(length == y.length && length == colors.length, "Megaplace: array length mismatch");
        require(length > 0 && length <= 100, "Megaplace: batch size must be 1-100");

        uint64 currentTime = uint64(block.timestamp);
        uint64 userPremiumExpiry = premiumAccess[msg.sender];

        // Check rate limit once for the batch
        if (currentTime > userPremiumExpiry) {
            uint64 lastTime = lastPlaced[msg.sender];
            require(currentTime >= lastTime + 15, "Megaplace: rate limit exceeded");
        }

        // Place all pixels
        for (uint256 i = 0; i < length;) {
            require(x[i] < 1000 && y[i] < 1000, "Megaplace: invalid coordinates");

            uint256 index;
            unchecked {
                index = x[i] + y[i] * 1000;
                i++;
            }

            // If color is 0 (black), store as 0x010101 to distinguish from unplaced pixels
            uint32 storedColor = colors[i - 1] == 0 ? 0x010101 : colors[i - 1];

            canvas[index] = pixel(storedColor, msg.sender, currentTime);
            emit PixelPlaced(msg.sender, x[i - 1], y[i - 1], storedColor, currentTime);
        }

        lastPlaced[msg.sender] = currentTime;
        emit PixelsBatchPlaced(msg.sender, length, currentTime);
    }

    /**
     * @dev Grant premium access to caller for 2 hours
     * Costs 0.01 ETH
     */
    function grantPremiumAccess() external payable {
        require(msg.value == 0.01 ether, "Megaplace: incorrect payment amount");

        unchecked {
            premiumAccess[msg.sender] = uint64(block.timestamp + 2 hours);
        }
    }

    /**
     * @dev Owner-only function to grant free premium access
     * @param user Address to grant premium access to
     */
    function adminGrantPremiumAccess(address user) external onlyOwner {
        unchecked {
            premiumAccess[user] = uint64(block.timestamp + 2 hours);
        }
    }

    /**
     * @dev Owner-only function to grant premium access to multiple users at once
     * @param users Array of addresses to grant premium access to
     */
    function adminGrantPremiumAccessBatch(address[] calldata users) external onlyOwner {
        uint64 expiryTime = uint64(block.timestamp + 2 hours);
        uint256 length = users.length;

        for (uint256 i = 0; i < length;) {
            premiumAccess[users[i]] = expiryTime;
            unchecked {
                i++;
            }
        }
    }

    /**
     * @dev Owner-only function to withdraw ETH from contract
     */
    function withdraw() external onlyOwner {
        // Use call instead of transfer for better gas handling
        (bool success, ) = payable(owner).call{value: address(this).balance}("");
        require(success, "Megaplace: withdraw failed");
    }

    // Fallback function to accept ETH
    receive() external payable {}

    /**
     * @dev Get pixel data at coordinates (x, y)
     * @param x The x coordinate (0-999)
     * @param y The y coordinate (0-999)
     * @return color The RGB color of the pixel
     * @return placedBy The address that placed the pixel
     * @return timestamp When the pixel was placed
     */
    function getPixel(uint256 x, uint256 y)
        external
        view
        returns (uint32 color, address placedBy, uint256 timestamp)
    {
        require(x < 1000 && y < 1000, "Megaplace: invalid coordinates");

        uint256 index;
        unchecked {
            index = x + y * 1000;
        }

        pixel memory p = canvas[index];
        return (p.color, p.placedBy, p.timestamp);
    }

    /**
     * @dev Get multiple pixels at once (batch read)
     * @param x Array of x coordinates
     * @param y Array of y coordinates
     * @return colors Array of colors
     * @return placedByAddresses Array of addresses that placed each pixel
     * @return timestamps Array of timestamps when pixels were placed
     */
    function getPixelBatch(uint256[] calldata x, uint256[] calldata y)
        external
        view
        returns (
            uint32[] memory colors,
            address[] memory placedByAddresses,
            uint64[] memory timestamps
        )
    {
        uint256 length = x.length;
        require(length == y.length, "Megaplace: array length mismatch");
        require(length > 0 && length <= 1000, "Megaplace: batch size must be 1-1000");

        colors = new uint32[](length);
        placedByAddresses = new address[](length);
        timestamps = new uint64[](length);

        for (uint256 i = 0; i < length;) {
            require(x[i] < 1000 && y[i] < 1000, "Megaplace: invalid coordinates");

            uint256 index;
            unchecked {
                index = x[i] + y[i] * 1000;
            }

            pixel memory p = canvas[index];
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
     * @dev Get a rectangular region of pixels
     * @param startX Starting x coordinate
     * @param startY Starting y coordinate
     * @param width Width of the region
     * @param height Height of the region
     * @return colors Array of colors in row-major order
     */
    function getRegion(
        uint256 startX,
        uint256 startY,
        uint256 width,
        uint256 height
    ) external view returns (uint32[] memory colors) {
        require(startX < 1000 && startY < 1000, "Megaplace: invalid start coordinates");
        require(startX + width <= 1000 && startY + height <= 1000, "Megaplace: region out of bounds");
        require(width > 0 && height > 0 && width * height <= 10000, "Megaplace: region too large");

        uint256 totalPixels = width * height;
        colors = new uint32[](totalPixels);

        uint256 arrayIndex = 0;
        for (uint256 dy = 0; dy < height;) {
            for (uint256 dx = 0; dx < width;) {
                uint256 canvasIndex;
                unchecked {
                    canvasIndex = (startX + dx) + (startY + dy) * 1000;
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
    function hasPremiumAccess(address user)
        external
        view
        returns (bool hasAccess, uint256 expiryTime)
    {
        uint64 expiry = premiumAccess[user];
        return (block.timestamp <= expiry, expiry);
    }

    /**
     * @dev Get time until user can place next pixel
     * @param user The address to check
     * @return canPlace Whether the user can place a pixel now
     * @return cooldownRemaining Seconds remaining until user can place (0 if can place now)
     */
    function getCooldown(address user)
        external
        view
        returns (bool canPlace, uint256 cooldownRemaining)
    {
        uint64 currentTime = uint64(block.timestamp);
        uint64 userPremiumExpiry = premiumAccess[user];

        // Premium users have no cooldown
        if (currentTime <= userPremiumExpiry) {
            return (true, 0);
        }

        uint64 lastTime = lastPlaced[user];
        uint64 nextAvailable = lastTime + 15;

        if (currentTime >= nextAvailable) {
            return (true, 0);
        } else {
            return (false, nextAvailable - currentTime);
        }
    }
}