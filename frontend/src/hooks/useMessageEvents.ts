import { useEffect } from "react";
import { useWatchContractEvent } from "wagmi";
import { CHATROOM_ADDRESS } from "../contracts/config";
import ChatRoomABI from "../contracts/ChatRoomABI.json";
import type { Abi } from "viem";

export function useMessageEvents(onNewMessage: () => void) {
  useWatchContractEvent({
    address: CHATROOM_ADDRESS,
    abi: ChatRoomABI as Abi,
    eventName: "MessageSent",
    onLogs(logs) {
      console.log("New message event received:", logs);
      onNewMessage();
    },
    onError(error) {
      console.error("Error watching contract events:", error);
    },
  });
}
