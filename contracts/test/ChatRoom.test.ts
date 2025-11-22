import { expect } from "chai";
import { ethers } from "hardhat";
import type { ChatRoom } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("ChatRoom", function () {
  let chatRoom: ChatRoom;
  let owner: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    const ChatRoom = await ethers.getContractFactory("ChatRoom");
    chatRoom = await ChatRoom.deploy() as unknown as ChatRoom;
    await chatRoom.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should start with zero messages", async function () {
      expect(await chatRoom.getMessageCount()).to.equal(0);
    });
  });

  describe("Sending Messages", function () {
    it("Should send a message successfully", async function () {
      const message = "Hello, world!";
      await chatRoom.sendMessage(message);

      expect(await chatRoom.getMessageCount()).to.equal(1);

      const [sender, content, timestamp] = await chatRoom.getMessage(0);
      expect(sender).to.equal(owner.address);
      expect(content).to.equal(message);
      expect(timestamp).to.be.gt(0);
    });

    it("Should emit MessageSent event", async function () {
      const message = "Test message";
      const tx = await chatRoom.sendMessage(message);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);

      await expect(tx)
        .to.emit(chatRoom, "MessageSent")
        .withArgs(owner.address, message, block!.timestamp, 0);
    });

    it("Should reject empty messages", async function () {
      await expect(chatRoom.sendMessage(""))
        .to.be.revertedWith("ChatRoom: message cannot be empty");
    });

    it("Should reject messages longer than 500 characters", async function () {
      const longMessage = "a".repeat(501);
      await expect(chatRoom.sendMessage(longMessage))
        .to.be.revertedWith("ChatRoom: message too long");
    });

    it("Should allow multiple users to send messages", async function () {
      await chatRoom.connect(user1).sendMessage("Message from user1");
      await chatRoom.connect(user2).sendMessage("Message from user2");
      await chatRoom.connect(owner).sendMessage("Message from owner");

      expect(await chatRoom.getMessageCount()).to.equal(3);

      const [sender1] = await chatRoom.getMessage(0);
      const [sender2] = await chatRoom.getMessage(1);
      const [sender3] = await chatRoom.getMessage(2);

      expect(sender1).to.equal(user1.address);
      expect(sender2).to.equal(user2.address);
      expect(sender3).to.equal(owner.address);
    });
  });

  describe("Retrieving Messages", function () {
    beforeEach(async function () {
      await chatRoom.connect(user1).sendMessage("First message");
      await chatRoom.connect(user2).sendMessage("Second message");
      await chatRoom.connect(user1).sendMessage("Third message");
    });

    it("Should get all messages", async function () {
      const messages = await chatRoom.getAllMessages();
      expect(messages.length).to.equal(3);
      expect(messages[0].content).to.equal("First message");
      expect(messages[1].content).to.equal("Second message");
      expect(messages[2].content).to.equal("Third message");
    });

    it("Should get message by index", async function () {
      const [sender, content] = await chatRoom.getMessage(1);
      expect(sender).to.equal(user2.address);
      expect(content).to.equal("Second message");
    });

    it("Should revert when getting message with invalid index", async function () {
      await expect(chatRoom.getMessage(10))
        .to.be.revertedWith("ChatRoom: message index out of bounds");
    });

    it("Should get recent messages", async function () {
      const recentMessages = await chatRoom.getRecentMessages(2);
      expect(recentMessages.length).to.equal(2);
      expect(recentMessages[0].content).to.equal("Second message");
      expect(recentMessages[1].content).to.equal("Third message");
    });

    it("Should get all messages if count exceeds total", async function () {
      const recentMessages = await chatRoom.getRecentMessages(100);
      expect(recentMessages.length).to.equal(3);
    });

    it("Should return empty array for recent messages when none exist", async function () {
      const ChatRoom = await ethers.getContractFactory("ChatRoom");
      const emptyChatRoom = await ChatRoom.deploy() as unknown as ChatRoom;
      await emptyChatRoom.waitForDeployment();

      const recentMessages = await emptyChatRoom.getRecentMessages(5);
      expect(recentMessages.length).to.equal(0);
    });

    it("Should get messages by sender", async function () {
      const user1Messages = await chatRoom.getMessagesBySender(user1.address);
      expect(user1Messages.length).to.equal(2);
      expect(user1Messages[0].content).to.equal("First message");
      expect(user1Messages[1].content).to.equal("Third message");

      const user2Messages = await chatRoom.getMessagesBySender(user2.address);
      expect(user2Messages.length).to.equal(1);
      expect(user2Messages[0].content).to.equal("Second message");
    });

    it("Should return empty array for sender with no messages", async function () {
      const messages = await chatRoom.getMessagesBySender(owner.address);
      expect(messages.length).to.equal(0);
    });
  });

  describe("Message Count", function () {
    it("Should correctly track message count", async function () {
      expect(await chatRoom.getMessageCount()).to.equal(0);

      await chatRoom.sendMessage("Message 1");
      expect(await chatRoom.getMessageCount()).to.equal(1);

      await chatRoom.sendMessage("Message 2");
      expect(await chatRoom.getMessageCount()).to.equal(2);

      await chatRoom.connect(user1).sendMessage("Message 3");
      expect(await chatRoom.getMessageCount()).to.equal(3);
    });
  });
});
