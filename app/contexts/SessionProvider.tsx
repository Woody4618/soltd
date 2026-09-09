import { SessionWalletProvider, useSessionKeyManager } from "@magicblock-labs/gum-react-sdk"

import {
  AnchorWallet,
  useAnchorWallet,
  useConnection,
} from "../utils/walletCompat"

interface SessionProviderProps {
  children: React.ReactNode
}

const SessionProvider: React.FC<SessionProviderProps> = ({ children }) => {
  const { connection } = useConnection()
  const anchorWallet = useAnchorWallet() as AnchorWallet
  const cluster = "devnet" // or "mainnet-beta", "testnet", "localnet"
  const sessionWallet = useSessionKeyManager(anchorWallet, connection, cluster)

  return (
    <SessionWalletProvider sessionWallet={sessionWallet}>
      {children}
    </SessionWalletProvider>
  )
}

export default SessionProvider
