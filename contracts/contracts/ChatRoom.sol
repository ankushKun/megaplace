// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title ChatRoom
 * @dev A simple on-chain chat room where anyone can send messages
 * Supports session keys for gasless UX
 */
contract ChatRoom {
    struct Message {
        address sender;
        string content;
        uint256 timestamp;
    }

    Message[] private messages;

    // Session key mapping: user address => session key address => expiry timestamp
    mapping(address => mapping(address => uint256)) public sessionKeys;

    event MessageSent(
        address indexed sender,
        string content,
        uint256 timestamp,
        uint256 messageIndex
    );

    event SessionKeyRegistered(
        address indexed user,
        address indexed sessionKey,
        uint256 expiryTime
    );

    event SessionKeyRevoked(
        address indexed user,
        address indexed sessionKey
    );

    /**
     * @dev Register a session key for the caller
     * @param sessionKey The session key address
     * @param duration How long the session key is valid (in seconds)
     */
    function registerSessionKey(address sessionKey, uint256 duration) public {
        require(sessionKey != address(0), "ChatRoom: invalid session key");
        require(duration > 0 && duration <= 30 days, "ChatRoom: invalid duration");

        uint256 expiryTime = block.timestamp + duration;
        sessionKeys[msg.sender][sessionKey] = expiryTime;

        emit SessionKeyRegistered(msg.sender, sessionKey, expiryTime);
    }

    /**
     * @dev Revoke a session key
     * @param sessionKey The session key address to revoke
     */
    function revokeSessionKey(address sessionKey) public {
        delete sessionKeys[msg.sender][sessionKey];
        emit SessionKeyRevoked(msg.sender, sessionKey);
    }

    /**
     * @dev Check if a session key is valid for a user
     * @param user The user address
     * @param sessionKey The session key address
     */
    function isValidSessionKey(address user, address sessionKey) public view returns (bool) {
        uint256 expiryTime = sessionKeys[user][sessionKey];
        return expiryTime > 0 && block.timestamp < expiryTime;
    }

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
     * @dev Send a message on behalf of another user using a session key
     * @param user The user address on whose behalf the message is sent
     * @param content The message content
     */
    function sendMessageWithSessionKey(address user, string memory content) public {
        require(isValidSessionKey(user, msg.sender), "ChatRoom: invalid or expired session key");
        require(bytes(content).length > 0, "ChatRoom: message cannot be empty");
        require(bytes(content).length <= 500, "ChatRoom: message too long");

        Message memory newMessage = Message({
            sender: user,
            content: content,
            timestamp: block.timestamp
        });

        messages.push(newMessage);

        emit MessageSent(
            user,
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
