import { FC, ReactNode, useMemo } from "react"
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base"
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react"
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui"
import { clusterApiUrl } from "@solana/web3.js"
require("@solana/wallet-adapter-react-ui/styles.css")

const WalletContextProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const network = WalletAdapterNetwork.Devnet
  // Prefer a custom RPC endpoint from the environment to avoid the public
  // endpoint's aggressive rate limits (HTTP 429). Falls back to the public
  // devnet cluster when NEXT_PUBLIC_RPC is not set. Uses the same env var as
  // utils/anchor.ts so the whole app shares one RPC configuration.
  const endpoint = useMemo(
    () => process.env.NEXT_PUBLIC_RPC || clusterApiUrl(network),
    [network]
  )

  // Phantom, Solflare, and other modern wallets are discovered automatically
  // via the Wallet Standard, so no explicit adapters are required. This also
  // avoids pulling in the `@solana/wallet-adapter-wallets` bundle, whose legacy
  // adapters (Ledger/Trezor/WalletConnect) ship broken ESM that breaks SSR.
  const wallets = useMemo(() => [], [])

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}

export default WalletContextProvider
