// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title ChatRoom
 * @dev A simple on-chain chat room where anyone can send messages
 */
contract ChatRoom {
    struct Message {
        address sender;
        string content;
        uint256 timestamp;
    }

    Message[] private messages;

    event MessageSent(
        address indexed sender,
        string content,
        uint256 timestamp,
        uint256 messageIndex
    );

    /**
     * @dev Send a message to the chat room
     * @param content The message content
     */
    function sendMessage(string memory content) public {
        require(bytes(content).length > 0, "ChatRoom: message cannot be empty");
        require(bytes(content).length <= 500, "ChatRoom: message too long");

        Message memory newMessage = Message({
            sender: msg.sender,
            content: content,
            timestamp: block.timestamp
        });

        messages.push(newMessage);

        emit MessageSent(
            msg.sender,
            content,
            block.timestamp,
            messages.length - 1
        );
    }

    /**
     * @dev Get a specific message by index
     * @param index The message index
     */
    function getMessage(uint256 index) public view returns (
        address sender,
        string memory content,
        uint256 timestamp
    ) {
        require(index < messages.length, "ChatRoom: message index out of bounds");
        Message memory message = messages[index];
        return (message.sender, message.content, message.timestamp);
    }

    /**
     * @dev Get all messages
     */
    function getAllMessages() public view returns (Message[] memory) {
        return messages;
    }

    /**
     * @dev Get the total number of messages
     */
    function getMessageCount() public view returns (uint256) {
        return messages.length;
    }

    /**
     * @dev Get the latest N messages
     * @param count Number of recent messages to retrieve
     */
    function getRecentMessages(uint256 count) public view returns (Message[] memory) {
        uint256 totalMessages = messages.length;

        if (totalMessages == 0) {
            return new Message[](0);
        }

        uint256 actualCount = count > totalMessages ? totalMessages : count;
        Message[] memory recentMessages = new Message[](actualCount);

        for (uint256 i = 0; i < actualCount; i++) {
            recentMessages[i] = messages[totalMessages - actualCount + i];
        }

        return recentMessages;
    }

    /**
     * @dev Get messages from a specific sender
     * @param sender The address to filter messages by
     */
    function getMessagesBySender(address sender) public view returns (Message[] memory) {
        uint256 count = 0;

        // Count messages from sender
        for (uint256 i = 0; i < messages.length; i++) {
            if (messages[i].sender == sender) {
                count++;
            }
        }

        // Create array of correct size
        Message[] memory senderMessages = new Message[](count);
        uint256 index = 0;

        // Fill array with sender's messages
        for (uint256 i = 0; i < messages.length; i++) {
            if (messages[i].sender == sender) {
                senderMessages[index] = messages[i];
                index++;
            }
        }

        return senderMessages;
    }
}
