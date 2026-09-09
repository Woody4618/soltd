import { FC, ReactNode, useMemo } from "react"
import {
  ConnectionProvider,
  WalletProvider,
  WalletModalProvider,
} from "@solana/wallet-adapter"
import { clusterApiUrl } from "@solana/web3.js-v1"
require("@solana/wallet-adapter/styles.css")

const WalletContextProvider: FC<{ children: ReactNode }> = ({ children }) => {
  // Prefer a custom RPC endpoint from the environment to avoid the public
  // endpoint's aggressive rate limits (HTTP 429). Falls back to the public
  // devnet cluster when NEXT_PUBLIC_RPC is not set. Uses the same env var as
  // utils/anchor.ts so the whole app shares one RPC configuration.
  const endpoint = useMemo(
    () => process.env.NEXT_PUBLIC_RPC || clusterApiUrl("devnet"),
    []
  )

  // Wallets are discovered via the Wallet Standard, so there is no `wallets`
  // prop any more. The provider is scoped to a single chain instead of a
  // WalletAdapterNetwork: one client per chain, per the plugin contract.
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider chain="solana:devnet" autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}

export default WalletContextProvider
