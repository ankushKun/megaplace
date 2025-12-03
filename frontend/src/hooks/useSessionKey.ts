import { useState, useEffect, useCallback, useRef } from 'react';
import {
  createWalletClient,
  http,
  parseEther,
  formatEther,
  type WalletClient,
  type Account,
  type Chain,
  type Transport,
} from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { megaethChain } from '../contracts/config';
import { SESSION_KEY_STORAGE_KEY, SESSION_KEY_FUNDING_AMOUNT } from '../constants';
import { toast } from 'sonner';

interface SessionKeyState {
  privateKey: `0x${string}` | null;
  address: `0x${string}` | null;
  balance: bigint;
  isLoading: boolean;
  isFunding: boolean;
  needsFunding: boolean;
}

export function useSessionKey() {
  const { address: mainWalletAddress } = useAccount();
  const publicClient = usePublicClient();
  const { data: mainWalletClient } = useWalletClient();

  const [state, setState] = useState<SessionKeyState>({
    privateKey: null,
    address: null,
    balance: 0n,
    isLoading: true,
    isFunding: false,
    needsFunding: false,
  });

  const sessionWalletClientRef = useRef<WalletClient<Transport, Chain, Account> | null>(null);
  const balancePollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Initialize session key from localStorage or generate new one
  useEffect(() => {
    const initSessionKey = () => {
      try {
        let privateKey = localStorage.getItem(SESSION_KEY_STORAGE_KEY) as `0x${string}` | null;

        if (!privateKey) {
          privateKey = generatePrivateKey();
          localStorage.setItem(SESSION_KEY_STORAGE_KEY, privateKey);
          console.log('[Session Key] Generated new session key');
        } else {
          console.log('[Session Key] Loaded existing session key');
        }

        const account = privateKeyToAccount(privateKey);

        // Create wallet client for session key
        const walletClient = createWalletClient({
          account,
          chain: megaethChain,
          transport: http('https://timothy.megaeth.com/rpc'),
        });

        sessionWalletClientRef.current = walletClient;

        setState(prev => ({
          ...prev,
          privateKey,
          address: account.address,
          isLoading: false,
        }));

        console.log('[Session Key] Address:', account.address);
      } catch (error) {
        console.error('[Session Key] Failed to initialize:', error);
        setState(prev => ({ ...prev, isLoading: false }));
      }
    };

    initSessionKey();
  }, []);

  // Poll balance
  useEffect(() => {
    if (!state.address || !publicClient) return;

    const checkBalance = async () => {
      try {
        const balance = await publicClient.getBalance({ address: state.address! });
        const minBalance = parseEther(SESSION_KEY_FUNDING_AMOUNT) / 2n; // Need at least half the funding amount

        setState(prev => ({
          ...prev,
          balance,
          needsFunding: balance < minBalance,
        }));
      } catch (error) {
        console.error('[Session Key] Failed to check balance:', error);
      }
    };

    // Initial check
    checkBalance();

    // Poll every 5 seconds
    balancePollingRef.current = setInterval(checkBalance, 5000);

    return () => {
      if (balancePollingRef.current) {
        clearInterval(balancePollingRef.current);
      }
    };
  }, [state.address, publicClient]);

  // Fund session key from main wallet
  const fundSessionKey = useCallback(async () => {
    if (!mainWalletClient || !state.address || !mainWalletAddress) {
      toast.error('Connect wallet first');
      return false;
    }

    setState(prev => ({ ...prev, isFunding: true }));

    try {
      const fundingAmount = parseEther(SESSION_KEY_FUNDING_AMOUNT);

      console.log(`[Session Key] Funding with ${SESSION_KEY_FUNDING_AMOUNT} ETH from ${mainWalletAddress}`);

      const hash = await mainWalletClient.sendTransaction({
        to: state.address,
        value: fundingAmount,
      } as any);

      console.log('[Session Key] Funding tx:', hash);
      toast.success('Session key funded!', {
        description: `${SESSION_KEY_FUNDING_AMOUNT} ETH sent`,
      });

      // Wait a bit for the balance to update
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Refresh balance
      if (publicClient) {
        const newBalance = await publicClient.getBalance({ address: state.address });
        const minBalance = parseEther(SESSION_KEY_FUNDING_AMOUNT) / 2n;
        setState(prev => ({
          ...prev,
          balance: newBalance,
          needsFunding: newBalance < minBalance,
          isFunding: false,
        }));
      }

      return true;
    } catch (error: any) {
      console.error('[Session Key] Failed to fund:', error);
      toast.error('Failed to fund session key', {
        description: error.message || 'Transaction failed',
      });
      setState(prev => ({ ...prev, isFunding: false }));
      return false;
    }
  }, [mainWalletClient, mainWalletAddress, state.address, publicClient]);

  // Get the session wallet client for sending transactions
  const getSessionWalletClient = useCallback(() => {
    return sessionWalletClientRef.current;
  }, []);

  // Reset session key (generate new one)
  const resetSessionKey = useCallback(() => {
    localStorage.removeItem(SESSION_KEY_STORAGE_KEY);
    const newPrivateKey = generatePrivateKey();
    localStorage.setItem(SESSION_KEY_STORAGE_KEY, newPrivateKey);

    const account = privateKeyToAccount(newPrivateKey);

    const walletClient = createWalletClient({
      account,
      chain: megaethChain,
      transport: http('https://timothy.megaeth.com/rpc'),
    });

    sessionWalletClientRef.current = walletClient;

    setState(prev => ({
      ...prev,
      privateKey: newPrivateKey,
      address: account.address,
      balance: 0n,
      needsFunding: true,
    }));

    toast.info('Session key reset', {
      description: 'A new session key has been generated',
    });
  }, []);

  return {
    sessionAddress: state.address,
    sessionBalance: state.balance,
    sessionBalanceFormatted: formatEther(state.balance),
    isLoading: state.isLoading,
    isFunding: state.isFunding,
    needsFunding: state.needsFunding,
    fundSessionKey,
    getSessionWalletClient,
    resetSessionKey,
  };
}

