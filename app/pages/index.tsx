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

export default function Home() {
  const { publicKey } = useWallet()

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
          Garden Picnic Defense
        </Heading>
        <Spacer />
        <HStack>
          <SessionKeyButton />
          <WalletMultiButton />
        </HStack>
      </Flex>

      <VStack spacing={4} py={2}>
        {!publicKey && <Text>Connect a devnet wallet to play.</Text>}
        {publicKey && (
          <Flex
            gap={4}
            align="flex-start"
            justify="center"
            wrap="wrap"
            px={4}
          >
            {/* Left column: stats above the board; how-to below it. */}
            <VStack spacing={3} align="stretch" w={`${BOARD_SIZE}px`}>
              <TowerDefenseHud />
              <TowerDefenseBoard />
              <TowerDefenseHowToPlay />
            </VStack>
            {/* Right column: daily highscore + jackpot, then game controls. */}
            <VStack spacing={4} align="stretch">
              <TowerDefenseLeaderboard />
              <TowerDefensePanel />
            </VStack>
          </Flex>
        )}
      </VStack>

      {/* Game-over popup (translucent, board still visible behind). */}
      {publicKey && <TowerDefenseGameOverModal />}
    </Box>
  )
}
