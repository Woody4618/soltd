import {
  Box,
  Button,
  HStack,
  Switch,
  Text,
  VStack,
} from "@chakra-ui/react"
import { useWallet } from "@solana/wallet-adapter-react"
import { useSessionWallet } from "@magicblock-labs/gum-react-sdk"
import { useTowerDefense } from "@/contexts/TowerDefenseProvider"
import { ENTRY_FEE_SOL } from "@/utils/anchor"

const TowerDefensePanel = () => {
  const { publicKey } = useWallet()
  const sessionWallet = useSessionWallet()
  const {
    predicted,
    confirmed,
    hasBoard,
    boardExists,
    busy,
    autoAdvance,
    setAutoAdvance,
    initBoard,
    resetBoard,
  } = useTowerDefense()

  if (!publicKey) return null

  const hasSession = !!(sessionWallet && sessionWallet.sessionToken)
  // Game-over gates the auto-run switch. Follows the predicted playback board,
  // falling back to confirmed until the first predicted frame exists.
  const stats = predicted ?? confirmed
  const gameOver = stats != null && stats.lives <= 0

  if (!hasBoard) {
    // The account exists on-chain but our decoder can't read it - almost always
    // an older board layout from a previous program version. Reset migrates it
    // (via realloc) to the current layout instead of failing to re-init.
    if (boardExists) {
      return (
        <VStack spacing={3} maxW="280px">
          <Text textAlign="center" fontSize="sm">
            A board already exists for this wallet but is from an older version.
            Reset it to migrate to the latest layout and start fresh.
          </Text>
          <Button
            colorScheme="orange"
            isLoading={busy}
            onClick={() => resetBoard()}
          >
            Reset board
          </Button>
        </VStack>
      )
    }
    return (
      <VStack spacing={3} maxW="280px">
        <Text>No tower-defense board yet for this wallet.</Text>
        <Text fontSize="xs" color="gray.400" textAlign="center">
          Starting a game costs <b>{ENTRY_FEE_SOL} SOL</b> — 95% feeds the daily{" "}
          <b>jackpot</b>, split 60/30/10 among the top 3 killers. Play, top the
          leaderboard, take a share of the pot.
        </Text>
        <Button colorScheme="green" isLoading={busy} onClick={() => initBoard()}>
          Start game ({ENTRY_FEE_SOL} SOL)
        </Button>
        {!hasSession && (
          <Text fontSize="xs" color="gray.500" textAlign="center">
            {ENTRY_FEE_SOL} SOL to start + 0.02 SOL to fund a play session
            (refundable) — set up automatically in one approval so the game can
            run hands-free.
          </Text>
        )}
      </VStack>
    )
  }

  return (
    <VStack
      spacing={3}
      align="stretch"
      w="240px"
      p={3}
      bg="#151822"
      border="1px solid #2b2f3a"
      borderRadius="md"
    >
      {/* Auto-run control */}
      <Box>
        <HStack justify="space-between">
          <Text fontSize="sm">Auto-run</Text>
          <Switch
            size="sm"
            isChecked={autoAdvance}
            isDisabled={!hasSession || gameOver}
            onChange={(e) => setAutoAdvance(e.target.checked)}
          />
        </HStack>
        <Text fontSize="xs" color="gray.400" mt={0.5}>
          {hasSession
            ? "Hands-free play — the game advances itself."
            : "Your play session expired. Start a New game to renew it, or use the green Advance button in the stats bar to advance manually."}
        </Text>
      </Box>

      <Button
        size="sm"
        colorScheme={gameOver ? "green" : "red"}
        variant={gameOver ? "solid" : "outline"}
        fontWeight={gameOver ? "bold" : undefined}
        isLoading={busy}
        onClick={() => resetBoard()}
      >
        {gameOver ? "New game" : "Reset game"} ({ENTRY_FEE_SOL} SOL)
      </Button>
    </VStack>
  )
}

export default TowerDefensePanel
