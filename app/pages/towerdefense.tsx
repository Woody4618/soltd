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
import TowerDefenseBoard from "@/components/TowerDefenseBoard"
import TowerDefensePanel from "@/components/TowerDefensePanel"

export default function TowerDefensePage() {
  const { publicKey } = useWallet()

  return (
    <Box minH="100vh" bg="#0f1117" color="gray.100">
      <Flex px={4} py={3} align="center">
        <HStack spacing={4}>
          <Link as={NextLink} href="/">
            &larr; Lumberjack
          </Link>
          <Heading size="md">On-chain Tower Defense</Heading>
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
            <TowerDefenseBoard />
            <TowerDefensePanel />
          </Flex>
        )}
      </VStack>
    </Box>
  )
}
