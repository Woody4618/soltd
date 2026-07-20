import { Button, HStack, Text } from "@chakra-ui/react"
import { useTowerDefense } from "@/contexts/TowerDefenseProvider"

const short = (pk: string) => `${pk.slice(0, 4)}…${pk.slice(-4)}`

// Shown above the board while spectating another player's game. Makes the
// read-only state obvious and offers a one-click way back to your own game.
const SpectatorBanner = () => {
  const { spectateKey, spectate, confirmed } = useTowerDefense()
  if (!spectateKey) return null

  const kills = confirmed?.kills ?? 0
  const gameOver = confirmed != null && confirmed.lives <= 0

  return (
    <HStack
      spacing={3}
      px={3}
      py={2}
      bg="#1d2a17"
      border="1px solid #4f7a2f"
      borderRadius="md"
      justify="space-between"
    >
      <HStack spacing={2} minW={0}>
        <Text fontSize="lg" flexShrink={0}>
          👁
        </Text>
        <Text fontSize="sm" isTruncated>
          Watching{" "}
          <Text as="span" fontFamily="mono" color="#b6e07a">
            {short(spectateKey.toBase58())}
          </Text>{" "}
          <Text as="span" color="gray.400">
            · {kills} kills{gameOver ? " · game over" : ""}
          </Text>
        </Text>
      </HStack>
      <Button
        size="xs"
        colorScheme="green"
        variant="outline"
        flexShrink={0}
        onClick={() => spectate(null)}
      >
        Back to my game
      </Button>
    </HStack>
  )
}

export default SpectatorBanner
