import { ChakraProvider } from "@chakra-ui/react"
import WalletContextProvider from "../contexts/WalletContextProvider"
import SessionProvider from "@/contexts/SessionProvider"
import { GameStateProvider } from "@/contexts/GameStateProvider"
import { TowerDefenseProvider } from "@/contexts/TowerDefenseProvider"
import type { AppProps } from "next/app"
import { NftProvider } from "@/contexts/NftProvider"

export default function App({ Component, pageProps }: AppProps) {
  return (
    <ChakraProvider>
      <WalletContextProvider>
        <SessionProvider>
          <GameStateProvider>
            <TowerDefenseProvider>
              <NftProvider>
                <Component {...pageProps} />
              </NftProvider>
            </TowerDefenseProvider>
          </GameStateProvider>
        </SessionProvider>
      </WalletContextProvider>
    </ChakraProvider>
  )
}
