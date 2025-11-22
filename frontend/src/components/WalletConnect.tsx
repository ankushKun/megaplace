import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { useEffect } from "react";
import { MEGAETH_CHAIN } from "../contracts/config";

export function WalletConnect() {
  const { address, isConnected, chain } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  const formatAddress = (addr: string) =>
    `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;

  // Check and switch to correct chain when wallet is connected
  useEffect(() => {
    if (isConnected && chain && chain.id !== MEGAETH_CHAIN.id) {
      console.log(`Wrong chain detected (${chain.id}). Switching to MegaETH (${MEGAETH_CHAIN.id})...`);
      switchChain({ chainId: MEGAETH_CHAIN.id });
    }
  }, [isConnected, chain, switchChain]);

  if (isConnected && address) {
    return (
      <div className="wallet-info">
        <span className="address">{formatAddress(address)}</span>
        <button onClick={() => disconnect()} className="disconnect-button">
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="wallet-connect">
      {connectors.map((connector) => (
        <button
          key={connector.id}
          onClick={() => connect({ connector, chainId: MEGAETH_CHAIN.id })}
          className="connect-button"
        >
          Connect {connector.name}
        </button>
      ))}
    </div>
  );
}
