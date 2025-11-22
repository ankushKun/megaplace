import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import {
  useGetAllMessages,
  useSendMessage,
  type Message,
} from "./hooks/useChatRoom";
import { useMessageEvents } from "./hooks/useMessageEvents";
import { WalletConnect } from "./components/WalletConnect";
import "./App.css";

function App() {
  const { address, isConnected } = useAccount();
  const [messageInput, setMessageInput] = useState("");

  const { data: messages, refetch } = useGetAllMessages();
  const {
    sendMessage,
    isPending,
    isConfirming,
    isConfirmed,
    hash,
    error,
  } = useSendMessage();

  // Listen for new messages via WebSocket
  useMessageEvents(() => {
    console.log("New message detected, refetching...");
    refetch();
  });

  // Refetch messages when transaction is confirmed
  useEffect(() => {
    if (isConfirmed) {
      refetch();
      setMessageInput("");
    }
  }, [isConfirmed, refetch]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (messageInput.trim() && isConnected) {
      sendMessage(messageInput);
    }
  };

  const formatAddress = (addr: string) =>
    `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;

  const formatTimestamp = (timestamp: bigint) => {
    const date = new Date(Number(timestamp) * 1000);
    return date.toLocaleString();
  };

  return (
    <div className="app">
      <header>
        <h1>MegaETH ChatRoom</h1>
        <WalletConnect />
      </header>

      <main>
        {!isConnected ? (
          <div className="connect-prompt">
            <p>Connect your wallet to start chatting</p>
          </div>
        ) : (
          <>
            <div className="messages-container">
              <div className="messages">
                {messages && (messages as Message[]).length > 0 ? (
                  (messages as Message[]).map((msg, index) => (
                    <div
                      key={index}
                      className={`message ${
                        msg.sender.toLowerCase() === address?.toLowerCase()
                          ? "own-message"
                          : ""
                      }`}
                    >
                      <div className="message-header">
                        <span className="sender">
                          {msg.sender.toLowerCase() === address?.toLowerCase()
                            ? "You"
                            : formatAddress(msg.sender)}
                        </span>
                        <span className="timestamp">
                          {formatTimestamp(msg.timestamp)}
                        </span>
                      </div>
                      <div className="message-content">{msg.content}</div>
                    </div>
                  ))
                ) : (
                  <div className="no-messages">
                    No messages yet. Be the first to send one!
                  </div>
                )}
              </div>
            </div>

            <form onSubmit={handleSendMessage} className="message-form">
              <input
                type="text"
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                placeholder="Type your message (max 500 characters)..."
                maxLength={500}
                disabled={isPending || isConfirming}
              />
              <button
                type="submit"
                disabled={
                  !messageInput.trim() || isPending || isConfirming
                }
              >
                {isPending || isConfirming ? "Sending..." : "Send"}
              </button>
            </form>

            {hash && (
              <div className="transaction-status">
                <p>
                  Transaction:{" "}
                  <a
                    href={`https://megaexplorer.xyz/tx/${hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {formatAddress(hash)}
                  </a>
                </p>
                {isConfirming && <p>Waiting for confirmation...</p>}
                {isConfirmed && <p>✅ Message sent!</p>}
              </div>
            )}

            {error && (
              <div className="error">
                Error: {error.message}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default App;
