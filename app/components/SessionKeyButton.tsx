import { useCallback, useEffect, useRef, useState } from "react"
import { Button, HStack, Text, Tooltip, VStack } from "@chakra-ui/react"
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js"
import { useWallet } from "@solana/wallet-adapter-react"
import { useSessionWallet } from "@magicblock-labs/gum-react-sdk"
import { program, CONNECTION } from "@/utils/anchor"

// Gum session tokens are capped at 24h by the SDK (createSession rejects
// anything larger). Use the max so players rarely have to renew.
const SESSION_EXPIRY_MINUTES = 24 * 60
const SESSION_TOPUP_LAMPORTS = 0.02 * LAMPORTS_PER_SOL

// The on-chain SessionToken account layout (Gum gpl_session):
//   [8 discriminator][authority:32][targetProgram:32][sessionSigner:32][validUntil:i64]
// so `valid_until` (unix seconds) lives at byte offset 104. Reading it raw
// avoids constructing a second Anchor program (and a possibly-mismatched anchor
// version) just to decode one field.
const VALID_UNTIL_OFFSET = 8 + 32 * 3

// Warn the player once the session has under this long left so they can renew
// before it lapses mid-game.
const EXPIRY_WARN_SECONDS = 15 * 60

type SessionStatus =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "valid"; secondsLeft: number }
  | { kind: "expiring"; secondsLeft: number }
  | { kind: "expired" }

function formatDuration(secs: number): string {
  if (secs <= 0) return "0m"
  const h = Math.floor(secs / 3600)
  const m = Math.round((secs % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

const SessionKeyButton = () => {
  const { publicKey } = useWallet()
  const sessionWallet = useSessionWallet()
  const [isLoading, setIsLoading] = useState(false)
  const [status, setStatus] = useState<SessionStatus>({ kind: "none" })

  const sessionToken = sessionWallet?.sessionToken ?? null

  // Read the on-chain SessionToken's validUntil and derive a status. Runs
  // whenever the token changes and on a slow interval so an expiry that happens
  // mid-session is caught even without a page reload.
  const refreshStatus = useCallback(async () => {
    if (!sessionToken) {
      setStatus({ kind: "none" })
      return
    }
    try {
      const info = await CONNECTION.getAccountInfo(new PublicKey(sessionToken))
      if (!info || info.data.length < VALID_UNTIL_OFFSET + 8) {
        // Token string exists locally but the account is gone on-chain
        // (revoked/expired-and-closed) => treat as expired.
        setStatus({ kind: "expired" })
        return
      }
      const view = new DataView(
        info.data.buffer,
        info.data.byteOffset,
        info.data.byteLength
      )
      const validUntil = Number(view.getBigInt64(VALID_UNTIL_OFFSET, true))
      const now = Math.floor(Date.now() / 1000)
      const secondsLeft = validUntil - now
      if (secondsLeft <= 0) {
        setStatus({ kind: "expired" })
      } else if (secondsLeft <= EXPIRY_WARN_SECONDS) {
        setStatus({ kind: "expiring", secondsLeft })
      } else {
        setStatus({ kind: "valid", secondsLeft })
      }
    } catch (e) {
      console.warn("session status read failed:", e)
      // Don't hard-fail the UI on an RPC hiccup; leave the last status.
    }
  }, [sessionToken])

  useEffect(() => {
    if (!sessionToken) {
      setStatus({ kind: "none" })
      return
    }
    setStatus({ kind: "loading" })
    refreshStatus()
    const id = setInterval(refreshStatus, 30_000)
    return () => clearInterval(id)
  }, [sessionToken, refreshStatus])

  const createSession = useCallback(async () => {
    setIsLoading(true)
    try {
      // Revoke any stale/expired token first so renewing is a clean re-create.
      if (sessionWallet?.sessionToken && sessionWallet.revokeSession) {
        try {
          await sessionWallet.revokeSession()
        } catch {
          // A stale token may already be gone on-chain; ignore and re-create.
        }
      }
      const session = await sessionWallet.createSession(
        program.programId,
        SESSION_TOPUP_LAMPORTS,
        SESSION_EXPIRY_MINUTES
      )
      console.log("Session created:", session)
      await refreshStatus()
    } catch (error) {
      console.error("Failed to create session:", error)
    } finally {
      setIsLoading(false)
    }
  }, [sessionWallet, refreshStatus])

  const revokeSession = useCallback(async () => {
    setIsLoading(true)
    try {
      await sessionWallet.revokeSession()
      console.log("Session revoked")
      setStatus({ kind: "none" })
    } catch (error) {
      console.error("Failed to revoke session:", error)
    } finally {
      setIsLoading(false)
    }
  }, [sessionWallet])

  if (!publicKey) return null

  // No usable session: offer to create one.
  const noSession = !sessionToken || status.kind === "none"
  // Session exists locally but is no longer valid on-chain.
  const invalid = status.kind === "expired"

  if (noSession) {
    return (
      <Button colorScheme="purple" isLoading={isLoading} onClick={createSession}>
        Create session
      </Button>
    )
  }

  if (invalid) {
    return (
      <VStack spacing={1} align="stretch">
        <HStack
          spacing={2}
          px={3}
          py={1}
          bg="#3a1d1d"
          borderRadius="md"
          border="1px solid #7a2f2f"
        >
          <Text fontSize="sm" color="red.300" fontWeight="bold">
            Session invalid
          </Text>
          <Text fontSize="xs" color="red.200">
            It expired or was revoked.
          </Text>
        </HStack>
        <Button
          colorScheme="purple"
          size="sm"
          isLoading={isLoading}
          onClick={createSession}
        >
          Renew session
        </Button>
      </VStack>
    )
  }

  const expiring = status.kind === "expiring"
  const secondsLeft =
    status.kind === "valid" || status.kind === "expiring"
      ? status.secondsLeft
      : 0

  return (
    <VStack spacing={1} align="stretch">
      <HStack
        spacing={2}
        px={3}
        py={1}
        bg={expiring ? "#3a331d" : "#1d2a1d"}
        borderRadius="md"
        border={`1px solid ${expiring ? "#7a6f2f" : "#2f7a3f"}`}
      >
        <Text
          fontSize="sm"
          fontWeight="bold"
          color={expiring ? "yellow.300" : "green.300"}
        >
          Session {expiring ? "expiring" : "active"}
        </Text>
        {status.kind === "loading" ? (
          <Text fontSize="xs" color="gray.300">
            …
          </Text>
        ) : (
          <Tooltip label="Time until this session key expires">
            <Text fontSize="xs" color="gray.300">
              {formatDuration(secondsLeft)} left
            </Text>
          </Tooltip>
        )}
      </HStack>
      <HStack spacing={2}>
        {expiring && (
          <Button
            colorScheme="purple"
            size="sm"
            flex={1}
            isLoading={isLoading}
            onClick={createSession}
          >
            Renew
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          flex={1}
          isLoading={isLoading}
          onClick={revokeSession}
        >
          Revoke
        </Button>
      </HStack>
    </VStack>
  )
}

export default SessionKeyButton
