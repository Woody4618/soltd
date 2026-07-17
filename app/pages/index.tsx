import NextLink from "next/link"
import { Box, Flex, Heading, Link, Spacer, VStack, Text } from "@chakra-ui/react"
import { useWallet } from "@solana/wallet-adapter-react"
import WalletMultiButton from "@/components/WalletMultiButton"
import DisplayGameState from "@/components/DisplayGameState"
import InitPlayerButton from "@/components/InitPlayerButton"
import SessionKeyButton from "@/components/SessionKeyButton"
import ChopTreeButton from "@/components/ChopTreeButton"
import RequestAirdrop from "@/components/RequestAirdrop"
import DisplayNfts from "@/components/DisplayNfts"

export default function Home() {
  const { publicKey } = useWallet()

  return (
    <Box>
      <Flex px={4} py={4}>
        <Spacer />
        <WalletMultiButton />
      </Flex>
      <VStack>
        <Heading>So Lumberjack</Heading>
        <Link as={NextLink} href="/towerdefense" color="blue.400">
          Play On-chain Tower Defense &rarr;
        </Link>
        {!publicKey && <Text>Connect to devnet wallet!</Text>}
        <DisplayGameState />
        <InitPlayerButton />
        <SessionKeyButton />
        <ChopTreeButton />
        <RequestAirdrop />
        <DisplayNfts />
      </VStack>
    </Box>
  )
}
