import NextLink from "next/link"
import {
  Box,
  Flex,
  Heading,
  HStack,
  Link,
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
import TowerDefenseGameOverModal from "@/components/TowerDefenseGameOverModal"

export default function TowerDefensePage() {
  const { publicKey } = useWallet()

  return (
    <Box
      minH="100vh"
      bg="#0f1117"
      color="gray.100"
      fontFamily='"Comicoro", "Comic Sans MS", cursive, system-ui'
    >
      <Flex px={4} py={3} align="center">
        <HStack spacing={4}>
          <Link as={NextLink} href="/">
            &larr; Lumberjack
          </Link>
          <Heading
            size="lg"
            fontFamily='"Comicoro", "Comic Sans MS", cursive, system-ui'
          >
            Garden Picnic Defense
          </Heading>
        </HStack>
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
            {/* Left column: game stats directly above the board. */}
            <VStack spacing={3} align="stretch" w={`${BOARD_SIZE}px`}>
              <TowerDefenseHud />
              <TowerDefenseBoard />
            </VStack>
            {/* Right column: build reference, controls, reset, how-to. */}
            <TowerDefensePanel />
          </Flex>
        )}
      </VStack>

      {/* Game-over popup (translucent, board still visible behind). */}
      {publicKey && <TowerDefenseGameOverModal />}
    </Box>
  )
}
