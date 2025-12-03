import { useState, useEffect, useCallback, useRef } from 'react';
import {
  createWalletClient,
  http,
  parseEther,
  formatEther,
  keccak256,
  toBytes,
  type WalletClient,
  type Account,
  type Chain,
  type Transport,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { megaethChain } from '../contracts/config';
import { SESSION_KEY_STORAGE_KEY, SESSION_KEY_FUNDING_AMOUNT } from '../constants';
import { toast } from 'sonner';

// Message to sign for deterministic session key generation
const SESSION_KEY_MESSAGE = 'Sign this message to generate your Megaplace session key.\n\nThis signature will be used to create a deterministic key that is unique to your wallet.';

// Get storage key for a specific wallet address
const getStorageKey = (walletAddress: string) => `${SESSION_KEY_STORAGE_KEY}_${walletAddress.toLowerCase()}`;

interface SessionKeyState {
  privateKey: `0x${string}` | null;
  address: `0x${string}` | null;
  balance: bigint;
  isLoading: boolean;
  isFunding: boolean;
  needsFunding: boolean;
  needsSignature: boolean;
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
    needsSignature: false,
  });

  const sessionWalletClientRef = useRef<WalletClient<Transport, Chain, Account> | null>(null);
  const balancePollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initializingRef = useRef(false);

  // Setup session key from private key
  const setupSessionKey = useCallback((privateKey: `0x${string}`) => {
    const account = privateKeyToAccount(privateKey);

    const walletClient = createWalletClient({
      account,
      chain: megaethChain,
      transport: http(import.meta.env.VITE_RPC_URL),
    });

    sessionWalletClientRef.current = walletClient;

    setState(prev => ({
      ...prev,
      privateKey,
      address: account.address,
      isLoading: false,
      needsSignature: false,
    }));

    console.log('[Session Key] Address:', account.address);
  }, []);

  // Generate deterministic private key from signature
  const generateFromSignature = useCallback(async () => {
    if (!mainWalletClient || !mainWalletAddress) {
      toast.error('Connect wallet first');
      return false;
    }

    setState(prev => ({ ...prev, isLoading: true }));

    try {
      console.log('[Session Key] Requesting signature for deterministic key generation...');

      // Sign the deterministic message
      const signature = await mainWalletClient.signMessage({
        account: mainWalletAddress,
        message: SESSION_KEY_MESSAGE,
      });

      // Hash the signature to create a valid 32-byte private key
      const privateKey = keccak256(toBytes(signature)) as `0x${string}`;

      // Store in localStorage for this specific wallet
      const storageKey = getStorageKey(mainWalletAddress);
      localStorage.setItem(storageKey, privateKey);

      console.log('[Session Key] Generated deterministic session key from signature');
      setupSessionKey(privateKey);

      toast.success('Session key created!', {
        description: 'Your session key is now ready',
      });

      return true;
    } catch (error: any) {
      console.error('[Session Key] Failed to generate from signature:', error);

      if (error.message?.includes('rejected') || error.message?.includes('denied')) {
        toast.error('Signature rejected', {
          description: 'Please sign the message to create your session key',
        });
      } else {
        toast.error('Failed to create session key', {
          description: error.message || 'Signature failed',
        });
      }

      setState(prev => ({ ...prev, isLoading: false, needsSignature: true }));
      return false;
    }
  }, [mainWalletClient, mainWalletAddress, setupSessionKey]);

  // Initialize session key from localStorage or prompt for signature
  useEffect(() => {
    if (!mainWalletAddress || initializingRef.current) return;

    const initSessionKey = async () => {
      initializingRef.current = true;

      try {
        const storageKey = getStorageKey(mainWalletAddress);
        const existingKey = localStorage.getItem(storageKey) as `0x${string}` | null;

        if (existingKey) {
          console.log('[Session Key] Loaded existing session key for wallet');
          setupSessionKey(existingKey);
        } else {
          console.log('[Session Key] No session key found, signature required');
          setState(prev => ({
            ...prev,
            isLoading: false,
            needsSignature: true,
          }));
        }
      } catch (error) {
        console.error('[Session Key] Failed to initialize:', error);
        setState(prev => ({ ...prev, isLoading: false, needsSignature: true }));
      }

      initializingRef.current = false;
    };

    initSessionKey();
  }, [mainWalletAddress, setupSessionKey]);

  // Reset state when wallet disconnects
  useEffect(() => {
    if (!mainWalletAddress) {
      sessionWalletClientRef.current = null;
      setState({
        privateKey: null,
        address: null,
        balance: 0n,
        isLoading: true,
        isFunding: false,
        needsFunding: false,
        needsSignature: false,
      });
      initializingRef.current = false;
    }
  }, [mainWalletAddress]);

  // Check balance function - can be called manually or on interval
  const checkBalance = useCallback(async () => {
    if (!state.address || !publicClient) return;

    try {
      const balance = await publicClient.getBalance({ address: state.address });
      const minBalance = parseEther(SESSION_KEY_FUNDING_AMOUNT) / 2n; // Need at least half the funding amount

      setState(prev => ({
        ...prev,
        balance,
        needsFunding: balance < minBalance,
      }));
    } catch (error) {
      console.error('[Session Key] Failed to check balance:', error);
    }
  }, [state.address, publicClient]);

  // Poll balance frequently
  useEffect(() => {
    if (!state.address || !publicClient) return;

    // Initial check
    checkBalance();

    // Poll every 2 seconds for responsive balance updates
    balancePollingRef.current = setInterval(checkBalance, 2000);

    return () => {
      if (balancePollingRef.current) {
        clearInterval(balancePollingRef.current);
      }
    };
  }, [state.address, publicClient, checkBalance]);

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

  // Reset session key (clear stored key and regenerate from signature)
  const resetSessionKey = useCallback(async () => {
    if (!mainWalletAddress) {
      toast.error('Connect wallet first');
      return;
    }

    // Clear the stored key for this wallet
    const storageKey = getStorageKey(mainWalletAddress);
    localStorage.removeItem(storageKey);

    // Clear current state
    sessionWalletClientRef.current = null;
    setState(prev => ({
      ...prev,
      privateKey: null,
      address: null,
      balance: 0n,
      needsFunding: false,
      needsSignature: true,
    }));

    toast.info('Session key cleared', {
      description: 'Sign again to regenerate your session key',
    });
  }, [mainWalletAddress]);

  return {
    sessionAddress: state.address,
    sessionBalance: state.balance,
    sessionBalanceFormatted: formatEther(state.balance),
    isLoading: state.isLoading,
    isFunding: state.isFunding,
    needsFunding: state.needsFunding,
    needsSignature: state.needsSignature,
    fundSessionKey,
    getSessionWalletClient,
    resetSessionKey,
    refreshBalance: checkBalance,
    generateFromSignature,
  };
}

