import dynamic from "next/dynamic"

export const WalletMultiButtonDynamic = dynamic(
  async () =>
    (await import("@solana/wallet-adapter")).WalletMultiButton,
  { ssr: false }
)

const WalletMultiButton = () => {
  return <WalletMultiButtonDynamic />
}

export default WalletMultiButton
