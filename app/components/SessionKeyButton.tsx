import { useState } from "react"
import { Button } from "@chakra-ui/react"
import { LAMPORTS_PER_SOL } from "@solana/web3.js"
import { useWallet } from "@solana/wallet-adapter-react"
import { useSessionWallet } from "@magicblock-labs/gum-react-sdk"
import { program } from "@/utils/anchor"

const SessionKeyButton = () => {
  const { publicKey } = useWallet()
  const sessionWallet = useSessionWallet()
  const [isLoading, setIsLoading] = useState(false)

  const handleCreateSession = async () => {
    setIsLoading(true)
    // gum-react-sdk v3 signature: createSession(targetProgram, topUpLamports, expiryInMinutes)
    // topUpLamports funds the ephemeral session key; expiryInMinutes must be <= 24h (1440).
    const topUpLamports = 0.02 * LAMPORTS_PER_SOL
    const expiryInMinutes = 600

    try {
      const session = await sessionWallet.createSession(
        program.programId,
        topUpLamports,
        expiryInMinutes
      )
      console.log("Session created:", session)
    } catch (error) {
      console.error("Failed to create session:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleRevokeSession = async () => {
    setIsLoading(true)
    try {
      await sessionWallet.revokeSession()
      console.log("Session revoked")
    } catch (error) {
      console.error("Failed to revoke session:", error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      {publicKey && (
        <Button
          isLoading={isLoading}
          onClick={
            sessionWallet && sessionWallet.sessionToken == null
              ? handleCreateSession
              : handleRevokeSession
          }
        >
          {sessionWallet && sessionWallet.sessionToken == null
            ? "Create session"
            : "Revoke Session"}
        </Button>
      )}
    </>
  )
}

export default SessionKeyButton
