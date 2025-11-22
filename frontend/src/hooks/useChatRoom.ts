import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { CHATROOM_ADDRESS } from "../contracts/config";
import ChatRoomABI from "../contracts/ChatRoomABI.json";
import type { Abi } from "viem";

export type Message = {
  sender: string;
  content: string;
  timestamp: bigint;
};

export function useGetMessageCount() {
  return useReadContract({
    address: CHATROOM_ADDRESS,
    abi: ChatRoomABI as Abi,
    functionName: "getMessageCount",
  });
}

export function useGetAllMessages() {
  return useReadContract({
    address: CHATROOM_ADDRESS,
    abi: ChatRoomABI as Abi,
    functionName: "getAllMessages",
  });
}

export function useGetRecentMessages(count: number) {
  return useReadContract({
    address: CHATROOM_ADDRESS,
    abi: ChatRoomABI as Abi,
    functionName: "getRecentMessages",
    args: [BigInt(count)],
  });
}

export function useSendMessage() {
  const { data: hash, writeContract, isPending, error } = useWriteContract();

  const sendMessage = (message: string) => {
    writeContract({
      address: CHATROOM_ADDRESS,
      abi: ChatRoomABI as Abi,
      functionName: "sendMessage",
      args: [message],
      gas: BigInt(600000000),
    });
  };

  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({
      hash,
    });

  return {
    sendMessage,
    hash,
    isPending,
    isConfirming,
    isConfirmed,
    error,
  };
}
