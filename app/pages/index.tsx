import {
  Box,
  Flex,
  Heading,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react"
import { useWallet } from "@solana/wallet-adapter-react"
import WalletMultiButton from "@/components/WalletMultiButton"
import SessionKeyButton from "@/components/SessionKeyButton"
import TowerDefenseBoard, { BOARD_SIZE } from "@/components/TowerDefenseBoard"
import TowerDefenseHud from "@/components/TowerDefenseHud"
import TowerDefensePanel from "@/components/TowerDefensePanel"
import TowerDefenseHowToPlay from "@/components/TowerDefenseHowToPlay"
import TowerDefenseLeaderboard from "@/components/TowerDefenseLeaderboard"
import TowerDefenseGameOverModal from "@/components/TowerDefenseGameOverModal"
import SpectatorBanner from "@/components/SpectatorBanner"
import { useTowerDefense } from "@/contexts/TowerDefenseProvider"

export default function Home() {
  const { publicKey } = useWallet()
  const { spectateKey, readOnly } = useTowerDefense()
  // Show the game view when connected OR when watching a shared link (a
  // spectator doesn't need a wallet to watch a public board).
  const showGame = !!publicKey || !!spectateKey

  return (
    <Box
      minH="100vh"
      bg="#0f1117"
      color="gray.100"
      fontFamily='"Comicoro", "Comic Sans MS", cursive, system-ui'
    >
      <Flex px={4} py={3} align="center">
        <Heading
          size="lg"
          fontFamily='"Comicoro", "Comic Sans MS", cursive, system-ui'
        >
          Sol-TD
        </Heading>
        <Spacer />
        <HStack>
          <SessionKeyButton />
          <WalletMultiButton />
        </HStack>
      </Flex>

      <VStack spacing={4} py={2}>
        {!showGame && <Text>Connect a devnet wallet to play.</Text>}
        {showGame && (
          <Flex
            gap={4}
            align="flex-start"
            justify="center"
            wrap="wrap"
            px={4}
          >
            {/* Left column: stats above the board; how-to below it. */}
            <VStack spacing={3} align="stretch" w={`${BOARD_SIZE}px`}>
              <SpectatorBanner />
              <TowerDefenseHud />
              <TowerDefenseBoard />
              <TowerDefenseHowToPlay />
            </VStack>
            {/* Right column: daily highscore + jackpot, then game controls. */}
            <VStack spacing={4} align="stretch">
              <TowerDefenseLeaderboard />
              {/* Own game controls only make sense for the connected player,
                  never while watching someone else's read-only board. */}
              {publicKey && !readOnly && <TowerDefensePanel />}
            </VStack>
          </Flex>
        )}
      </VStack>

      {/* Game-over popup (translucent, board still visible behind). Suppressed
          while spectating - it's not your game to restart. */}
      {publicKey && !readOnly && <TowerDefenseGameOverModal />}
    </Box>
  )
}
