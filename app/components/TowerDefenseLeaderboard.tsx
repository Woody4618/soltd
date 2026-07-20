import { useMemo } from "react"
import { Box, Button, Divider, HStack, Text, VStack } from "@chakra-ui/react"
import { PublicKey } from "@solana/web3.js"
import { useWallet } from "@solana/wallet-adapter-react"
import { useTowerDefense } from "@/contexts/TowerDefenseProvider"
import { HIGHSCORE_RESET_COOLDOWN_SECONDS } from "@/utils/anchor"

const short = (pk: string) => `${pk.slice(0, 4)}…${pk.slice(-4)}`
const MEDALS = ["🥇", "🥈", "🥉"]

const TowerDefenseLeaderboard = () => {
  const { publicKey } = useWallet()
  const { highscore, jackpotSol, payoutHighscore, busy, spectate, spectateKey } =
    useTowerDefense()
  const watching = spectateKey?.toBase58() ?? null

  // Seconds remaining before a payout is allowed again (0 = ready).
  const cooldownLeft = useMemo(() => {
    if (!highscore) return 0
    const last = Number(highscore.lastReset ?? 0)
    if (last === 0) return 0
    const nextAt = last + HIGHSCORE_RESET_COOLDOWN_SECONDS
    return Math.max(0, nextAt - Math.floor(Date.now() / 1000))
  }, [highscore])

  const entries = useMemo(() => {
    if (!highscore) return []
    const count = Number(highscore.count ?? 0)
    return highscore.entries
      .slice(0, count)
      .map((e: any) => ({ player: e.player.toBase58(), score: Number(e.score) }))
  }, [highscore])

  const me = publicKey?.toBase58()
  const canPayout = entries.length > 0 && cooldownLeft === 0

  return (
    <VStack
      spacing={2}
      align="stretch"
      w="240px"
      p={3}
      bg="#151822"
      border="1px solid #2b2f3a"
      borderRadius="md"
    >
      <HStack justify="space-between" align="baseline">
        <Text fontSize="sm" fontWeight="bold">
          Daily Highscore
        </Text>
        <Text fontSize="xs" color="gray.400">
          most kills
        </Text>
      </HStack>

      {/* Jackpot */}
      <Box
        bg="#1d2130"
        borderRadius="md"
        px={3}
        py={2}
        border="1px solid #2b2f3a"
      >
        <Text fontSize="xs" color="gray.400">
          Jackpot
        </Text>
        <Text fontSize="lg" fontWeight="bold" color="#ffd43b" lineHeight={1.1}>
          {jackpotSol.toFixed(3)} SOL
        </Text>
        <Text fontSize="10px" color="gray.500">
          Top 3 split 60/30/10. Fed by 0.095 SOL per game start/reset.
        </Text>
      </Box>

      <Divider borderColor="#2b2f3a" />

      {entries.length === 0 ? (
        <Text fontSize="xs" color="gray.500">
          No scores yet this period. Lose a game to land on the board!
        </Text>
      ) : (
        <VStack spacing={1} align="stretch">
          {entries.map((e, i) => {
            const mine = e.player === me
            const isWatching = e.player === watching
            // Own entry is a no-op to click (you stay on your live game);
            // everyone else's is clickable to spectate their board live.
            const clickable = !mine
            return (
              <HStack
                key={e.player + i}
                as={clickable ? "button" : "div"}
                onClick={
                  clickable
                    ? () => spectate(new PublicKey(e.player))
                    : undefined
                }
                spacing={2}
                fontSize="xs"
                px={2}
                py={1}
                borderRadius="sm"
                textAlign="left"
                w="100%"
                bg={
                  isWatching ? "#2f3a26" : mine ? "#26304a" : "transparent"
                }
                border={`1px solid ${isWatching ? "#4f7a2f" : "transparent"}`}
                cursor={clickable ? "pointer" : "default"}
                transition="background 0.12s"
                _hover={clickable ? { bg: isWatching ? "#37451f" : "#20242f" } : undefined}
                title={
                  clickable
                    ? "Watch this player's game live"
                    : "This is your game"
                }
              >
                <Text w="20px" flexShrink={0}>
                  {MEDALS[i] ?? `${i + 1}.`}
                </Text>
                <Text
                  flex={1}
                  fontFamily="mono"
                  color={mine ? "#8ab4ff" : "gray.300"}
                >
                  {short(e.player)}
                  {mine ? " (you)" : isWatching ? " 👁" : ""}
                </Text>
                <Text fontWeight="bold" color="#ff8787">
                  {e.score}
                </Text>
              </HStack>
            )
          })}
        </VStack>
      )}

      <Divider borderColor="#2b2f3a" />

      <Button
        size="xs"
        colorScheme="yellow"
        variant="outline"
        isDisabled={!canPayout || busy}
        isLoading={busy}
        onClick={() => payoutHighscore()}
      >
        {cooldownLeft > 0
          ? `Payout in ${formatCooldown(cooldownLeft)}`
          : "Pay out jackpot"}
      </Button>
      <Text fontSize="10px" color="gray.500">
        Anyone can trigger the payout once per day. It sends the whole jackpot to
        the current #1 and clears the board.
      </Text>
    </VStack>
  )
}

function formatCooldown(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${secs}s`
}

export default TowerDefenseLeaderboard
