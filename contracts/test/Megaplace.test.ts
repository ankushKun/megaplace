import { expect } from "chai";
import { ethers, network } from "hardhat";
import { Megaplace } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

// Helper functions for time manipulation
async function getCurrentTime(): Promise<number> {
  const block = await ethers.provider.getBlock('latest');
  return block!.timestamp;
}

async function increaseTime(seconds: number): Promise<void> {
  await network.provider.send("evm_increaseTime", [seconds]);
  await network.provider.send("evm_mine");
}

describe("Megaplace", function () {
  let megaplace: Megaplace;
  let owner: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let user3: HardhatEthersSigner;

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();

    const MegaplaceFactory = await ethers.getContractFactory("Megaplace");
    megaplace = await MegaplaceFactory.deploy();
    await megaplace.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      expect(await megaplace.owner()).to.equal(owner.address);
    });

    it("Should accept ETH via receive function", async function () {
      const amount = ethers.parseEther("1.0");
      await owner.sendTransaction({
        to: await megaplace.getAddress(),
        value: amount,
      });

      expect(await ethers.provider.getBalance(await megaplace.getAddress())).to.equal(amount);
    });
  });

  describe("placePixel", function () {
    it("Should place a pixel successfully", async function () {
      const x = 100;
      const y = 200;
      const color = 0xff0000; // Red

      const tx = await megaplace.connect(user1).placePixel(x, y, color);
      const receipt = await tx.wait();

      // Check event was emitted
      expect(receipt).to.not.be.null;

      const pixel = await megaplace.getPixel(x, y);
      expect(pixel.color).to.equal(color);
      expect(pixel.placedBy).to.equal(user1.address);
      expect(pixel.timestamp).to.be.gt(0);
    });

    it("Should reject invalid x coordinate (>= 1000)", async function () {
      await expect(megaplace.connect(user1).placePixel(1000, 0, 0xff0000))
        .to.be.revertedWith("Megaplace: invalid coordinates");

      await expect(megaplace.connect(user1).placePixel(1001, 0, 0xff0000))
        .to.be.revertedWith("Megaplace: invalid coordinates");
    });

    it("Should reject invalid y coordinate (>= 1000)", async function () {
      await expect(megaplace.connect(user1).placePixel(0, 1000, 0xff0000))
        .to.be.revertedWith("Megaplace: invalid coordinates");

      await expect(megaplace.connect(user1).placePixel(0, 1001, 0xff0000))
        .to.be.revertedWith("Megaplace: invalid coordinates");
    });

    it("Should enforce 15-second rate limit for regular users", async function () {
      await megaplace.connect(user1).placePixel(0, 0, 0xff0000);

      // Try to place another pixel immediately
      await expect(megaplace.connect(user1).placePixel(1, 1, 0x00ff00))
        .to.be.revertedWith("Megaplace: rate limit exceeded");

      // Advance time by 10 seconds (still too early)
      await increaseTime(10);

      // Still should fail because only 10 seconds have passed
      await expect(megaplace.connect(user1).placePixel(1, 1, 0x00ff00))
        .to.be.revertedWith("Megaplace: rate limit exceeded");

      // Advance time by 5 more seconds (total 15 seconds)
      await increaseTime(5);

      // Now should succeed (15 seconds have passed)
      await expect(megaplace.connect(user1).placePixel(1, 1, 0x00ff00))
        .to.not.be.reverted;
    });

    it("Should allow different users to place pixels without rate limit conflicts", async function () {
      await megaplace.connect(user1).placePixel(0, 0, 0xff0000);
      await expect(megaplace.connect(user2).placePixel(1, 1, 0x00ff00))
        .to.not.be.reverted;
    });

    it("Should allow premium users to bypass rate limit", async function () {
      // Grant premium access
      await megaplace.connect(user1).grantPremiumAccess({ value: ethers.parseEther("0.01") });

      // Place multiple pixels without waiting
      await megaplace.connect(user1).placePixel(0, 0, 0xff0000);
      await megaplace.connect(user1).placePixel(1, 1, 0x00ff00);
      await megaplace.connect(user1).placePixel(2, 2, 0x0000ff);

      const pixel1 = await megaplace.getPixel(0, 0);
      const pixel2 = await megaplace.getPixel(1, 1);
      const pixel3 = await megaplace.getPixel(2, 2);

      expect(pixel1.color).to.equal(0xff0000);
      expect(pixel2.color).to.equal(0x00ff00);
      expect(pixel3.color).to.equal(0x0000ff);
    });

    it("Should allow overwriting pixels", async function () {
      await megaplace.connect(user1).placePixel(5, 5, 0xff0000);
      await increaseTime(15);
      await megaplace.connect(user2).placePixel(5, 5, 0x00ff00);

      const pixel = await megaplace.getPixel(5, 5);
      expect(pixel.color).to.equal(0x00ff00);
      expect(pixel.placedBy).to.equal(user2.address);
    });

    it("Should convert black pixels (0x000000) to 0x010101 for storage", async function () {
      await megaplace.connect(user1).placePixel(10, 10, 0x000000);

      const pixel = await megaplace.getPixel(10, 10);
      expect(pixel.color).to.equal(0x010101); // Black stored as 0x010101
      expect(pixel.placedBy).to.equal(user1.address);
      expect(pixel.timestamp).to.be.gt(0);
    });

    it("Should update lastPlaced timestamp", async function () {
      const tx = await megaplace.connect(user1).placePixel(0, 0, 0xff0000);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);

      const lastPlaced = await megaplace.lastPlaced(user1.address);
      expect(lastPlaced).to.equal(block!.timestamp);
    });
  });

  describe("placePixelBatch", function () {
    it("Should place multiple pixels in batch", async function () {
      const x = [0, 1, 2];
      const y = [0, 1, 2];
      const colors = [0xff0000, 0x00ff00, 0x0000ff];

      await expect(megaplace.connect(user1).placePixelBatch(x, y, colors))
        .to.emit(megaplace, "PixelsBatchPlaced")
        .withArgs(user1.address, 3, await getCurrentTime() + 1);

      const pixel1 = await megaplace.getPixel(0, 0);
      const pixel2 = await megaplace.getPixel(1, 1);
      const pixel3 = await megaplace.getPixel(2, 2);

      expect(pixel1.color).to.equal(0xff0000);
      expect(pixel2.color).to.equal(0x00ff00);
      expect(pixel3.color).to.equal(0x0000ff);
    });

    it("Should emit PixelPlaced event for each pixel in batch", async function () {
      const x = [10, 11];
      const y = [20, 21];
      const colors = [0xff0000, 0x00ff00];

      const tx = await megaplace.connect(user1).placePixelBatch(x, y, colors);
      const receipt = await tx.wait();

      const pixelPlacedEvents = receipt!.logs.filter(
        (log: any) => log.fragment?.name === "PixelPlaced"
      );

      expect(pixelPlacedEvents.length).to.equal(2);
    });

    it("Should convert black pixels to 0x010101 in batch", async function () {
      const x = [30, 31];
      const y = [40, 41];
      const colors = [0x000000, 0xff0000]; // Black and red

      await megaplace.connect(user1).placePixelBatch(x, y, colors);

      const pixel1 = await megaplace.getPixel(30, 40);
      const pixel2 = await megaplace.getPixel(31, 41);

      expect(pixel1.color).to.equal(0x010101); // Black stored as 0x010101
      expect(pixel2.color).to.equal(0xff0000);
    });

    it("Should reject array length mismatch", async function () {
      await expect(
        megaplace.connect(user1).placePixelBatch([0, 1], [0], [0xff0000, 0x00ff00])
      ).to.be.revertedWith("Megaplace: array length mismatch");

      await expect(
        megaplace.connect(user1).placePixelBatch([0], [0, 1], [0xff0000])
      ).to.be.revertedWith("Megaplace: array length mismatch");
    });

    it("Should reject empty batch", async function () {
      await expect(
        megaplace.connect(user1).placePixelBatch([], [], [])
      ).to.be.revertedWith("Megaplace: batch size must be 1-100");
    });

    it("Should reject batch larger than 100 pixels", async function () {
      const x = Array(101).fill(0).map((_, i) => i % 1000);
      const y = Array(101).fill(0);
      const colors = Array(101).fill(0xff0000);

      await expect(
        megaplace.connect(user1).placePixelBatch(x, y, colors)
      ).to.be.revertedWith("Megaplace: batch size must be 1-100");
    });

    it("Should reject batch with invalid coordinates", async function () {
      await expect(
        megaplace.connect(user1).placePixelBatch([1000], [0], [0xff0000])
      ).to.be.revertedWith("Megaplace: invalid coordinates");

      await expect(
        megaplace.connect(user1).placePixelBatch([0, 1, 1000], [0, 1, 0], [0xff0000, 0x00ff00, 0x0000ff])
      ).to.be.revertedWith("Megaplace: invalid coordinates");
    });

    it("Should enforce rate limit for batch placement", async function () {
      const x = [0, 1];
      const y = [0, 1];
      const colors = [0xff0000, 0x00ff00];

      await megaplace.connect(user1).placePixelBatch(x, y, colors);

      // Try to place another batch immediately
      await expect(
        megaplace.connect(user1).placePixelBatch([2], [2], [0x0000ff])
      ).to.be.revertedWith("Megaplace: rate limit exceeded");

      // Advance time by 15 seconds
      await increaseTime(15);
      await expect(
        megaplace.connect(user1).placePixelBatch([2], [2], [0x0000ff])
      ).to.not.be.reverted;
    });

    it("Should allow premium users to place batches without rate limit", async function () {
      await megaplace.connect(user1).grantPremiumAccess({ value: ethers.parseEther("0.01") });

      const x1 = [0, 1];
      const y1 = [0, 1];
      const colors1 = [0xff0000, 0x00ff00];

      const x2 = [2, 3];
      const y2 = [2, 3];
      const colors2 = [0x0000ff, 0xffff00];

      await megaplace.connect(user1).placePixelBatch(x1, y1, colors1);
      await megaplace.connect(user1).placePixelBatch(x2, y2, colors2);

      const pixel3 = await megaplace.getPixel(2, 2);
      expect(pixel3.color).to.equal(0x0000ff);
    });

    it("Should accept batch of 100 pixels", async function () {
      const x = Array(100).fill(0).map((_, i) => i % 100);
      const y = Array(100).fill(0);
      const colors = Array(100).fill(0xff0000);

      await expect(
        megaplace.connect(user1).placePixelBatch(x, y, colors)
      ).to.not.be.reverted;
    });
  });

  describe("Premium Access", function () {
    it("Should grant premium access for 2 hours with correct payment", async function () {
      const tx = await megaplace.connect(user1).grantPremiumAccess({ value: ethers.parseEther("0.01") });
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);
      const expectedExpiry = BigInt(block!.timestamp) + BigInt(2 * 60 * 60); // 2 hours

      const premiumExpiry = await megaplace.premiumAccess(user1.address);
      expect(premiumExpiry).to.equal(expectedExpiry);

      const [hasAccess, expiryTime] = await megaplace.hasPremiumAccess(user1.address);
      expect(hasAccess).to.be.true;
      expect(expiryTime).to.equal(expectedExpiry);
    });

    it("Should reject incorrect payment amount", async function () {
      await expect(
        megaplace.connect(user1).grantPremiumAccess({ value: ethers.parseEther("0.005") })
      ).to.be.revertedWith("Megaplace: incorrect payment amount");

      await expect(
        megaplace.connect(user1).grantPremiumAccess({ value: ethers.parseEther("0.02") })
      ).to.be.revertedWith("Megaplace: incorrect payment amount");

      await expect(
        megaplace.connect(user1).grantPremiumAccess({ value: 0 })
      ).to.be.revertedWith("Megaplace: incorrect payment amount");
    });

    it("Should expire premium access after 2 hours", async function () {
      await megaplace.connect(user1).grantPremiumAccess({ value: ethers.parseEther("0.01") });

      let [hasAccess] = await megaplace.hasPremiumAccess(user1.address);
      expect(hasAccess).to.be.true;

      // Advance time by 2 hours + 1 second to ensure expiry
      await increaseTime(2 * 60 * 60 + 1);

      [hasAccess] = await megaplace.hasPremiumAccess(user1.address);
      expect(hasAccess).to.be.false;
    });

    it("Should allow owner to grant free premium access", async function () {
      await megaplace.connect(owner).adminGrantPremiumAccess(user1.address);

      const [hasAccess, expiryTime] = await megaplace.hasPremiumAccess(user1.address);
      expect(hasAccess).to.be.true;
      expect(expiryTime).to.be.gt(0);
    });

    it("Should reject non-owner calling adminGrantPremiumAccess", async function () {
      await expect(
        megaplace.connect(user1).adminGrantPremiumAccess(user2.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should allow owner to grant premium access to multiple users", async function () {
      await megaplace.connect(owner).adminGrantPremiumAccessBatch([user1.address, user2.address, user3.address]);

      const [hasAccess1] = await megaplace.hasPremiumAccess(user1.address);
      const [hasAccess2] = await megaplace.hasPremiumAccess(user2.address);
      const [hasAccess3] = await megaplace.hasPremiumAccess(user3.address);

      expect(hasAccess1).to.be.true;
      expect(hasAccess2).to.be.true;
      expect(hasAccess3).to.be.true;
    });

    it("Should reject non-owner calling adminGrantPremiumAccessBatch", async function () {
      await expect(
        megaplace.connect(user1).adminGrantPremiumAccessBatch([user2.address, user3.address])
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should add premium payment to contract balance", async function () {
      const initialBalance = await ethers.provider.getBalance(await megaplace.getAddress());

      await megaplace.connect(user1).grantPremiumAccess({ value: ethers.parseEther("0.01") });

      const finalBalance = await ethers.provider.getBalance(await megaplace.getAddress());
      expect(finalBalance - initialBalance).to.equal(ethers.parseEther("0.01"));
    });
  });

  describe("Withdraw", function () {
    it("Should allow owner to withdraw ETH", async function () {
      // Send ETH to contract
      await user1.sendTransaction({
        to: await megaplace.getAddress(),
        value: ethers.parseEther("1.0"),
      });

      const initialOwnerBalance = await ethers.provider.getBalance(owner.address);
      const contractBalance = await ethers.provider.getBalance(await megaplace.getAddress());

      const tx = await megaplace.connect(owner).withdraw();
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const finalOwnerBalance = await ethers.provider.getBalance(owner.address);
      const finalContractBalance = await ethers.provider.getBalance(await megaplace.getAddress());

      expect(finalContractBalance).to.equal(0);
      expect(finalOwnerBalance).to.equal(initialOwnerBalance + contractBalance - gasUsed);
    });

    it("Should reject non-owner calling withdraw", async function () {
      await expect(
        megaplace.connect(user1).withdraw()
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should handle withdrawing when balance is zero", async function () {
      await expect(megaplace.connect(owner).withdraw()).to.not.be.reverted;
    });
  });

  describe("View Functions", function () {
    describe("getPixel", function () {
      it("Should return correct pixel data", async function () {
        const x = 50;
        const y = 75;
        const color = 0xaabbcc;

        await megaplace.connect(user1).placePixel(x, y, color);

        const pixel = await megaplace.getPixel(x, y);
        expect(pixel.color).to.equal(color);
        expect(pixel.placedBy).to.equal(user1.address);
        expect(pixel.timestamp).to.be.gt(0);
      });

      it("Should return zero values for unplaced pixels", async function () {
        const pixel = await megaplace.getPixel(100, 100);
        expect(pixel.color).to.equal(0);
        expect(pixel.placedBy).to.equal(ethers.ZeroAddress);
        expect(pixel.timestamp).to.equal(0);
      });

      it("Should reject invalid coordinates", async function () {
        await expect(megaplace.getPixel(1000, 0))
          .to.be.revertedWith("Megaplace: invalid coordinates");

        await expect(megaplace.getPixel(0, 1000))
          .to.be.revertedWith("Megaplace: invalid coordinates");
      });
    });

    describe("getPixelBatch", function () {
      it("Should return multiple pixels correctly", async function () {
        await megaplace.connect(user1).placePixel(0, 0, 0xff0000);
        await increaseTime(15);
        await megaplace.connect(user2).placePixel(1, 1, 0x00ff00);

        const [colors, placedBy, timestamps] = await megaplace.getPixelBatch([0, 1], [0, 1]);

        expect(colors[0]).to.equal(0xff0000);
        expect(colors[1]).to.equal(0x00ff00);
        expect(placedBy[0]).to.equal(user1.address);
        expect(placedBy[1]).to.equal(user2.address);
        expect(timestamps[0]).to.be.gt(0);
        expect(timestamps[1]).to.be.gt(0);
      });

      it("Should reject array length mismatch", async function () {
        await expect(megaplace.getPixelBatch([0, 1], [0]))
          .to.be.revertedWith("Megaplace: array length mismatch");
      });

      it("Should reject empty batch", async function () {
        await expect(megaplace.getPixelBatch([], []))
          .to.be.revertedWith("Megaplace: batch size must be 1-1000");
      });

      it("Should reject batch larger than 1000", async function () {
        const x = Array(1001).fill(0).map((_, i) => i % 1000);
        const y = Array(1001).fill(0);

        await expect(megaplace.getPixelBatch(x, y))
          .to.be.revertedWith("Megaplace: batch size must be 1-1000");
      });

      it("Should accept batch of 1000 pixels", async function () {
        const x = Array(1000).fill(0).map((_, i) => i % 1000);
        const y = Array(1000).fill(0);

        const [colors, placedBy, timestamps] = await megaplace.getPixelBatch(x, y);
        expect(colors.length).to.equal(1000);
        expect(placedBy.length).to.equal(1000);
        expect(timestamps.length).to.equal(1000);
      });

      it("Should reject invalid coordinates in batch", async function () {
        await expect(megaplace.getPixelBatch([0, 1000], [0, 0]))
          .to.be.revertedWith("Megaplace: invalid coordinates");
      });
    });

    describe("getRegion", function () {
      it("Should return a region of pixels", async function () {
        await megaplace.connect(user1).placePixel(0, 0, 0xff0000);
        await increaseTime(15);
        await megaplace.connect(user1).placePixel(1, 0, 0x00ff00);
        await increaseTime(15);
        await megaplace.connect(user1).placePixel(0, 1, 0x0000ff);

        const colors = await megaplace.getRegion(0, 0, 2, 2);

        expect(colors.length).to.equal(4);
        expect(colors[0]).to.equal(0xff0000); // (0,0)
        expect(colors[1]).to.equal(0x00ff00); // (1,0)
        expect(colors[2]).to.equal(0x0000ff); // (0,1)
        expect(colors[3]).to.equal(0);        // (1,1) - unplaced
      });

      it("Should reject invalid start coordinates", async function () {
        await expect(megaplace.getRegion(1000, 0, 1, 1))
          .to.be.revertedWith("Megaplace: invalid start coordinates");

        await expect(megaplace.getRegion(0, 1000, 1, 1))
          .to.be.revertedWith("Megaplace: invalid start coordinates");
      });

      it("Should reject region out of bounds", async function () {
        await expect(megaplace.getRegion(999, 0, 2, 1))
          .to.be.revertedWith("Megaplace: region out of bounds");

        await expect(megaplace.getRegion(0, 999, 1, 2))
          .to.be.revertedWith("Megaplace: region out of bounds");
      });

      it("Should reject region too large (> 10000 pixels)", async function () {
        await expect(megaplace.getRegion(0, 0, 101, 100))
          .to.be.revertedWith("Megaplace: region too large");
      });

      it("Should accept maximum region size (10000 pixels)", async function () {
        const colors = await megaplace.getRegion(0, 0, 100, 100);
        expect(colors.length).to.equal(10000);
      });

      it("Should reject zero width or height", async function () {
        await expect(megaplace.getRegion(0, 0, 0, 10))
          .to.be.revertedWith("Megaplace: region too large");

        await expect(megaplace.getRegion(0, 0, 10, 0))
          .to.be.revertedWith("Megaplace: region too large");
      });
    });

    describe("hasPremiumAccess", function () {
      it("Should return false for users without premium", async function () {
        const [hasAccess, expiryTime] = await megaplace.hasPremiumAccess(user1.address);
        expect(hasAccess).to.be.false;
        expect(expiryTime).to.equal(0);
      });

      it("Should return true for users with active premium", async function () {
        await megaplace.connect(user1).grantPremiumAccess({ value: ethers.parseEther("0.01") });

        const [hasAccess, expiryTime] = await megaplace.hasPremiumAccess(user1.address);
        expect(hasAccess).to.be.true;
        expect(expiryTime).to.be.gt(0);
      });

      it("Should return false after premium expires", async function () {
        await megaplace.connect(user1).grantPremiumAccess({ value: ethers.parseEther("0.01") });

        await increaseTime(2 * 60 * 60 + 1); // 2 hours + 1 second

        const [hasAccess] = await megaplace.hasPremiumAccess(user1.address);
        expect(hasAccess).to.be.false;
      });
    });

    describe("getCooldown", function () {
      it("Should return can place for new users", async function () {
        const [canPlace, cooldownRemaining] = await megaplace.getCooldown(user1.address);
        expect(canPlace).to.be.true;
        expect(cooldownRemaining).to.equal(0);
      });

      it("Should return cannot place immediately after placing pixel", async function () {
        await megaplace.connect(user1).placePixel(0, 0, 0xff0000);

        const [canPlace, cooldownRemaining] = await megaplace.getCooldown(user1.address);
        expect(canPlace).to.be.false;
        expect(cooldownRemaining).to.be.gte(1);
        expect(cooldownRemaining).to.be.lte(15);
      });

      it("Should return can place after 15 seconds", async function () {
        await megaplace.connect(user1).placePixel(0, 0, 0xff0000);
        await increaseTime(15);

        const [canPlace, cooldownRemaining] = await megaplace.getCooldown(user1.address);
        expect(canPlace).to.be.true;
        expect(cooldownRemaining).to.equal(0);
      });

      it("Should return can place for premium users", async function () {
        await megaplace.connect(user1).grantPremiumAccess({ value: ethers.parseEther("0.01") });
        await megaplace.connect(user1).placePixel(0, 0, 0xff0000);

        const [canPlace, cooldownRemaining] = await megaplace.getCooldown(user1.address);
        expect(canPlace).to.be.true;
        expect(cooldownRemaining).to.equal(0);
      });

      it("Should enforce cooldown after premium expires", async function () {
        await megaplace.connect(user1).grantPremiumAccess({ value: ethers.parseEther("0.01") });

        // Advance time to just after premium expires
        await increaseTime(2 * 60 * 60 + 1);

        // Place a pixel after premium has expired
        await megaplace.connect(user1).placePixel(0, 0, 0xff0000);

        // Should now have cooldown enforced
        const [canPlace, cooldownRemaining] = await megaplace.getCooldown(user1.address);
        expect(canPlace).to.be.false;
        expect(cooldownRemaining).to.be.gte(1);
        expect(cooldownRemaining).to.be.lte(15);
      });
    });
  });

  describe("Edge Cases and Gas Optimization", function () {
    it("Should handle corner coordinates (0,0) and (999,999)", async function () {
      await megaplace.connect(user1).placePixel(0, 0, 0xff0000);
      await increaseTime(15);
      await megaplace.connect(user1).placePixel(999, 999, 0x00ff00);

      const pixel1 = await megaplace.getPixel(0, 0);
      const pixel2 = await megaplace.getPixel(999, 999);

      expect(pixel1.color).to.equal(0xff0000);
      expect(pixel2.color).to.equal(0x00ff00);
    });

    it("Should handle maximum color value (0xFFFFFFFF)", async function () {
      const maxColor = 0xffffffff;
      await megaplace.connect(user1).placePixel(0, 0, maxColor);

      const pixel = await megaplace.getPixel(0, 0);
      expect(pixel.color).to.equal(maxColor);
    });

    it("Should handle zero color value (convert black to 0x010101)", async function () {
      await megaplace.connect(user1).placePixel(0, 0, 0);

      const pixel = await megaplace.getPixel(0, 0);
      expect(pixel.color).to.equal(0x010101); // Black is stored as 0x010101
      expect(pixel.placedBy).to.equal(user1.address); // Still should record placer
    });

    it("Should properly track multiple premium purchases", async function () {
      await megaplace.connect(user1).grantPremiumAccess({ value: ethers.parseEther("0.01") });

      // Advance time by 1 hour
      await increaseTime(60 * 60);

      // Purchase again (should extend from current time)
      await megaplace.connect(user1).grantPremiumAccess({ value: ethers.parseEther("0.01") });

      const [hasAccess, expiryTime] = await megaplace.hasPremiumAccess(user1.address);
      expect(hasAccess).to.be.true;

      // Should have ~2 hours from now (not 3 hours total)
      const expectedExpiry = BigInt(await getCurrentTime()) + BigInt(2 * 60 * 60);
      expect(expiryTime).to.be.closeTo(expectedExpiry, 10n);
    });
  });

  describe("Gas Optimization Tests", function () {
    it("Should use optimized storage for pixels (single slot)", async function () {
      // This is a conceptual test - the struct fits in one slot
      // We verify by checking successful operations
      await megaplace.connect(user1).placePixel(0, 0, 0xff0000);
      const pixel = await megaplace.getPixel(0, 0);

      expect(pixel.color).to.equal(0xff0000);
      expect(pixel.placedBy).to.not.equal(ethers.ZeroAddress);
      expect(pixel.timestamp).to.be.gt(0);
    });

    it("Should handle unchecked arithmetic correctly", async function () {
      // Test that unchecked blocks don't cause issues with valid inputs
      const x = 999;
      const y = 999;

      await megaplace.connect(user1).placePixel(x, y, 0xff0000);
      const pixel = await megaplace.getPixel(x, y);

      expect(pixel.color).to.equal(0xff0000);
    });
  });
});
